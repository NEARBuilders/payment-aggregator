# 002-04: E2E Stripe Implementation

### Context

This ticket depends on 002-01 (Aggregator API + Provider Discovery). With the generic API in place, verify that the full Stripe flow works correctly through the aggregator — from API endpoint through to the Stripe plugin's service layer. Write an integration test that exercises all 5 Stripe contract procedures (metadata + 4 payment procedures) through the generic API routes.

The Stripe plugin wraps the `stripe` npm SDK (`apiVersion: 2026-02-25.clover`). The E2E test must mock Stripe API calls (no real network calls in tests) while still verifying the full delegation chain through the aggregator.

### Overview

1. Verify Stripe flow works end-to-end through the generic API
2. Write integration test at `api/tests/integration/e2e-stripe.test.ts`
3. Reuse the `createE2ETestContext` pattern from 002-03
4. Cover all 5 procedures + error handling + Stripe-specific signature verification

### Files to Create

| File | Purpose |
|------|---------|
| `api/tests/integration/e2e-stripe.test.ts` | Full Stripe E2E test through aggregator |

### Files to Modify

(none — reuses test harness pattern from 002-03)

### Test Structure

Reuses the same `createE2ETestContext()` helper from 002-03 (both plugins registered in the same runtime). All test cases use `provider: 'stripe'`.

The Stripe plugin requires valid `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` secrets. For testing, these can be fake values — the Stripe service will fail to construct a real client if called without mocking. The test must mock the Stripe SDK at the module level or use `vi.mock('stripe', ...)` to replace the Stripe constructor.

#### Mock Setup

```typescript
import { vi } from 'vitest';

// Stripe mock must be a constructor function, not vi.fn(),
// because plugin code calls `new Stripe(key, config)`.
// Pattern copied from plugins/stripe/tests/unit/service.test.ts.

const mockStripeInstance = {
  checkout: {
    sessions: {
      create: vi.fn().mockResolvedValue({
        id: 'cs_test_e2e_123',
        url: 'https://checkout.stripe.com/c/pay/cs_test_e2e_123',
        status: 'open',
        payment_status: 'unpaid',
        amount_total: 1000,
        currency: 'usd',
        metadata: { orderId: 'e2e-order-001' },
      }),
      retrieve: vi.fn().mockResolvedValue({
        id: 'cs_test_e2e_123',
        status: 'complete',
        payment_status: 'paid',
        amount_total: 1000,
        currency: 'usd',
        metadata: { orderId: 'e2e-order-001' },
      }),
    },
  },
  webhooks: {
    constructEvent: vi.fn().mockImplementation((body: string, signature: string, secret: string) => {
      if (signature === 'invalid') throw new Error('Invalid signature');
      const event = JSON.parse(body);
      return {
        type: event.type || 'checkout.session.completed',
        data: { object: event.data?.object || {} },
      };
    }),
  },
};

vi.mock('stripe', () => ({
  default: function MockStripe() {
    return mockStripeInstance;
  },
}));
```

Alternatively, if the Stripe service constructor pattern is `new (Stripe as any)(key, config)`, the mock must be a regular function (not `vi.fn()`):

```typescript
const MockStripe = function (this: any, _key: string, _config?: any) {
  return mockStripeInstance;
} as any;
vi.mock('stripe', () => ({ default: MockStripe }));
```

### Test Cases

#### 1. Provider Discovery

```typescript
it('returns Stripe in provider list with metadata', async () => {
  const providers = await client.paymentProviders();

  const stripeEntry = providers.find((p: any) => p.key === 'stripe');
  expect(stripeEntry).toBeDefined();
  expect(stripeEntry.name).toBe('Stripe');
  expect(stripeEntry.logo).toContain('stripe');
  expect(stripeEntry.description).toBeTruthy();
});
```

#### 2. Create Checkout Session

```typescript
it('creates a Stripe checkout session through generic endpoint', async () => {
  const result = await client.paymentCheckout({
    provider: 'stripe',
    orderId: 'e2e-order-001',
    amount: 1000,
    currency: 'USD',
    items: [{ name: 'E2E Test Item', unitAmount: 1000, quantity: 1 }],
    customerEmail: 'stripe-test@example.com',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
  });

  expect(result.sessionId).toBe('cs_test_e2e_123');
  expect(result.url).toContain('https://checkout.stripe.com');
});
```

#### 3. Retrieve Session

```typescript
it('retrieves a Stripe session through generic endpoint', async () => {
  const result = await client.paymentSession({
    provider: 'stripe',
    sessionId: 'cs_test_e2e_123',
  });

  expect(result.session.id).toBe('cs_test_e2e_123');
  expect(result.session.status).toBe('complete');
  expect(result.session.paymentStatus).toBe('paid');
  expect(result.session.amountTotal).toBe(1000);
  expect(result.session.currency).toBe('usd');
});
```

#### 4. Verify Webhook (Stripe signature)

```typescript
it('verifies a Stripe webhook through generic endpoint', async () => {
  const payload = JSON.stringify({
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_e2e_123',
        metadata: { orderId: 'e2e-order-001' },
      },
    },
  });

  const result = await client.paymentWebhook({
    provider: 'stripe',
    body: payload,
    signature: 'valid_signature',
  });

  expect(result.received).toBe(true);
  expect(result.eventType).toBe('checkout.session.completed');
  expect(result.orderId).toBe('e2e-order-001');
});
```

#### 5. Webhook with Invalid Signature

```typescript
it('rejects Stripe webhook with invalid signature', async () => {
  const payload = JSON.stringify({ type: 'checkout.session.completed' });

  await expect(
    client.paymentWebhook({
      provider: 'stripe',
      body: payload,
      signature: 'invalid',
    })
  ).rejects.toThrow();
});
```

#### 6. Error Handling — Unknown Provider

```typescript
it('returns error for unknown provider in Stripe context', async () => {
  await expect(
    client.paymentCheckout({
      provider: 'nonexistent-provider',
      orderId: 'test',
      amount: 100,
      currency: 'USD',
      items: [{ name: 'Test', unitAmount: 100, quantity: 1 }],
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
    })
  ).rejects.toThrow(/Unknown payment provider|NOT_FOUND/);
});
```

#### 7. All Providers Present

```typescript
it('provider list includes both Stripe and PingPay', async () => {
  const providers = await client.paymentProviders();
  const keys = providers.map((p: any) => p.key);

  expect(keys).toContain('stripe');
  expect(keys).toContain('pingpay');
  expect(providers.length).toBeGreaterThanOrEqual(2);
});
```

### Stripe-Specific Behaviors Verified

| Behavior | How verified |
|----------|-------------|
| Stripe SDK usage | `mockStripeInstance.checkout.sessions.create` is called internally |
| Webhook signature | `constructEvent` in mock validates signature |
| Session normalization | `status` → `payment_status`, `amount_total` → `amountTotal`, currency lowercase |
| Metadata extraction | `orderId` extracted from Stripe session metadata |
| Constructor pattern | `new Stripe(key, config)` works with mock constructor function |

### Acceptance Criteria
- [ ] E2E test file exists at `api/tests/integration/e2e-stripe.test.ts`
- [ ] All 7 test cases pass
- [ ] Stripe SDK is mocked correctly (no real network calls)
- [ ] Provider discovery returns Stripe with correct metadata
- [ ] Checkout returns Stripe session ID and URL
- [ ] Session retrieval returns normalized session with correct typing
- [ ] Webhook verification succeeds with valid signature (mock)
- [ ] Invalid webhook signature is rejected
- [ ] Unknown provider returns error
- [ ] Both Stripe and PingPay appear together in provider list
- [ ] Test teardown cleans up server, runtime, and resets mocks
- [ ] `bun run test` passes in `api/`

### Notes
- [ ] The Stripe SDK mock must be a **constructor function** (not `vi.fn()`), because the service code calls `new (Stripe as any)(key, config)`. Pattern from `plugins/stripe/tests/unit/service.test.ts`.
- [ ] If the Stripe service changes to accept an injected client instead of constructing one internally, update the mock pattern accordingly
- [ ] Reusable test harness (`createE2ETestContext`) should be extracted to `api/tests/integration/setup.ts` if both 002-03 and 002-04 exist — avoid duplication
- [ ] Stripe mock values (`'cs_test_e2e_123'`, `'complete'`, `'paid'`) are arbitrary — they just need to exercise the normalization logic
- [ ] The `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` env vars must be set for the test (even with mock) since they're `z.string()` (required) in the Stripe plugin secrets schema
- [ ] Database initialization uses `pglite:.bos/api/:memory:` for in-memory test DB
