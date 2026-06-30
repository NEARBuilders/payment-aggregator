# 002-03: E2E PingPay Implementation

### Context

This ticket depends on 002-01 (Aggregator API + Provider Discovery). With the generic API in place, verify that the full PingPay flow works correctly through the aggregator — from API endpoint through to the PingPay plugin's service layer. Write an integration test that exercises all 5 PingPay contract procedures (metadata + 4 payment procedures) through the generic API routes.

This is not just a test — it ensures the PingPay-specific behaviors (HMAC-SHA256 webhook signing, USDC amount conversion, fee handling) work correctly when reached through the generic `/payments/*` endpoints rather than the old provider-specific routes.

### Overview

1. Verify PingPay flow works end-to-end through the generic API
2. Write integration test at `api/tests/integration/e2e-pingpay.test.ts`
3. Test harness uses shared `createE2ETestContext(providerName)` helper for future reuse
4. Cover all 5 procedures + error handling

### Files to Create

| File | Purpose |
|------|---------|
| `api/tests/integration/e2e-pingpay.test.ts` | Full PingPay E2E test through aggregator |

### Files to Modify

| File | Change |
|------|--------|
| `api/tests/setup.ts` (or new `api/tests/integration/setup.ts`) | E2E test harness with plugin runtime, both plugins registered |

### Test Structure

The test spins up the API with `createPluginRuntime`, registers both `pingpay` and `stripe` plugins (matching `bos.config.json`), creates an oRPC client pointing at the API, and tests each generic endpoint with `provider = "pingpay"`.

#### Setup Pattern

```typescript
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { RPCHandler } from '@orpc/server/node';
import { createPluginRuntime } from 'every-plugin';
import type { ApiContract } from '@/lib/api-types.gen';
import PingPayPlugin from '../../../plugins/pingpay/src/index';
import StripePlugin from '../../../plugins/stripe/src/index';
import { contract } from '@/contract';

const TEST_REGISTRY = {
  pingpay: { module: PingPayPlugin, description: 'PingPay E2E test' },
  stripe: { module: StripePlugin, description: 'Stripe E2E test' },
} as const;

const createE2EContext = async () => {
  const runtime = createPluginRuntime({
    registry: TEST_REGISTRY,
    secrets: {
      API_DATABASE_URL: 'pglite:.bos/api/:memory:',
    },
  });

  // Spin up all plugins and create API router
  // (implementation follows 002-01 pattern)

  const server = createServer(async (req, res) => {
    const rpcHandler = new RPCHandler(router);
    // ... rpc handling
  });

  // Start server on random port
  // Return { client, server, runtime, port }

  return { client, server, runtime, teardown };
};
```

This setup helper is designed to be reused in 002-04 for Stripe — same registry, just different `provider` string in test cases.

### Test Cases

#### 1. Provider Discovery

```typescript
it('returns PingPay in provider list with metadata', async () => {
  const { client } = await createE2EContext();
  const providers = await client.paymentProviders();

  const pingpay = providers.find((p: any) => p.key === 'pingpay');
  expect(pingpay).toBeDefined();
  expect(pingpay.name).toBe('PingPay');
  expect(pingpay.logo).toContain('pingpay');
  expect(pingpay.description).toBeTruthy();
});
```

#### 2. Ping Health Check

Ping is not part of the generic aggregator routes (ping is per-plugin), but verify through plugin directly:

```typescript
it('PingPay plugin responds to ping via metadata endpoint proves plugin is alive', async () => {
  // PingPay should be in the provider list — proves plugin is loaded
  const providers = await client.paymentProviders();
  expect(providers.some((p: any) => p.key === 'pingpay')).toBe(true);
});
```

#### 3. Create Checkout Session

```typescript
it('creates a PingPay checkout session through generic endpoint', async () => {
  const result = await client.paymentCheckout({
    provider: 'pingpay',
    orderId: 'e2e-order-001',
    amount: 1000,           // $10.00
    currency: 'USD',
    items: [{ name: 'E2E Test Item', unitAmount: 1000, quantity: 1 }],
    customerEmail: 'test@example.com',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
  });

  expect(result.sessionId).toBeTruthy();
  expect(result.sessionId).toContain('test_session_');
  expect(result.url).toContain('https://');
});
```

#### 4. Retrieve Session

```typescript
it('retrieves a PingPay session through generic endpoint', async () => {
  const { sessionId } = await client.paymentCheckout({
    provider: 'pingpay',
    orderId: 'e2e-order-002',
    amount: 500,
    currency: 'USD',
    items: [{ name: 'Test', unitAmount: 500, quantity: 1 }],
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
  });

  const result = await client.paymentSession({
    provider: 'pingpay',
    sessionId,
  });

  expect(result.session.id).toBe(sessionId);
  expect(result.session.status).toBeTruthy();
  expect(result.session.paymentStatus).toBeTruthy();
  expect(result.session.amountTotal).toBeGreaterThan(0);
  expect(result.session.currency).toBe('USDC');
});
```

#### 5. Verify Webhook (HMAC-SHA256)

```typescript
it('verifies a PingPay webhook through generic endpoint', async () => {
  const payload = JSON.stringify({
    type: 'payment.success',
    sessionId: 'test_session_webhook_001',
    metadata: { orderId: 'e2e-order-003' },
  });

  const crypto = await import('crypto');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHmac('sha256', 'test_webhook_secret')
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  const result = await client.paymentWebhook({
    provider: 'pingpay',
    body: payload,
    signature,
    timestamp,
  });

  expect(result.received).toBe(true);
  expect(result.eventType).toBe('payment.success');
  expect(result.orderId).toBe('e2e-order-003');
  expect(result.sessionId).toBe('test_session_webhook_001');
});
```

#### 6. Error Handling

```typescript
it('returns error for unknown provider', async () => {
  await expect(
    client.paymentCheckout({
      provider: 'nonexistent',
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

#### 7. Webhook with Invalid Signature

```typescript
it('rejects webhook with invalid signature', async () => {
  const payload = JSON.stringify({
    type: 'payment.success',
    sessionId: 'test_session_bad',
  });

  await expect(
    client.paymentWebhook({
      provider: 'pingpay',
      body: payload,
      signature: 'invalid_signature',
      timestamp: String(Math.floor(Date.now() / 1000)),
    })
  ).rejects.toThrow();
});
```

### PingPay-Specific Behaviors Verified

| Behavior | How verified |
|----------|-------------|
| USDC amount conversion | Session amount is returned in correct units (USDC, 6 decimals) |
| Fee handling | Optional — test with `fees` array on checkout (if supported) |
| Test mode detection | Session ID prefixed with `test_session_` — confirms mock is used |
| HMAC-SHA256 webhook | Valid signature → accepted; invalid → rejected |
| Session normalization | Status/paymentStatus/currency formatted correctly |

### Acceptance Criteria
- [ ] E2E test file exists at `api/tests/integration/e2e-pingpay.test.ts`
- [ ] All 7 test cases pass
- [ ] Test spins up API with both payment plugins registered
- [ ] Provider discovery returns PingPay with correct metadata
- [ ] Checkout returns valid session ID (test mode)
- [ ] Session retrieval returns expected fields with correct types
- [ ] Webhook verification succeeds with valid HMAC-SHA256 signature
- [ ] Unknown provider returns error
- [ ] Invalid webhook signature is rejected
- [ ] Test teardown cleans up server and runtime
- [ ] `bun run test` passes in `api/`

### Notes
- [ ] The test harness (`createE2EContext`) should be reusable for 002-04 Stripe tests — extract to a shared helper if practical
- [ ] PingPay test mode uses mock responses (no real API calls) — the `PingPayClient` auto-detects test mode when no API key or key starts with `test_`
- [ ] The `test_webhook_secret` is hardcoded in PingPay's mock service — this is documented in `plugins/pingpay/src/service.ts`
- [ ] If `api-types.gen.ts` hasn't been regenerated with the new contract types, use `(client as any)` for the generic endpoints
- [ ] Database initialization (migrations) should work with `pglite:.bos/api/:memory:` for in-memory test DB
