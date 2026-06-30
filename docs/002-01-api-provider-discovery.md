# 002-01: Aggregator API + Provider Discovery

### Context

This is the foundation ticket for Epic 002. It makes the API aggregator fully generic — zero provider-specific code in `api/src/index.ts`. The current approach has 8 provider-specific contract routes (`stripePing`, `pingpayCreateCheckout`, etc.) and hardcoded destructuring (`(restPlugins as any).stripe`, `(services as any).stripeClient`). Adding a new provider requires editing the contract, the `createRouter`, and the `initialize` block.

After this ticket, the API dynamically discovers payment providers from `services.plugins`, routes all payment operations through 4 generic endpoints, and returns provider metadata for UI rendering. Adding or removing a payment plugin from `bos.config.json` requires zero code changes to `api/`.

### Overview

1. Add `metadata` procedure to the `PaymentContract` in both `plugins/pingpay/` and `plugins/stripe/`
2. Replace all 8 provider-specific routes in `api/src/contract.ts` with 4 generic routes
3. Rewrite `api/src/index.ts` `createRouter` and `initialize` to be provider-agnostic
4. Plugins self-describe via `metadata` — API aggregates and exposes to UI

### Files to Create

(none — all changes are edits to existing files)

### Files to Modify

| File | Changes |
|------|---------|
| `plugins/pingpay/src/contract.ts` | Add `metadata` procedure to `PaymentContract` |
| `plugins/pingpay/src/index.ts` | Implement `metadata` handler in `createRouter` |
| `plugins/stripe/src/contract.ts` | Add `metadata` procedure to `PaymentContract` |
| `plugins/stripe/src/index.ts` | Implement `metadata` handler in `createRouter` |
| `api/src/contract.ts` | Delete 8 provider-specific routes, add 4 generic routes |
| `api/src/index.ts` | Delete all provider-specific code, rewrite with dynamic plugin lookup |

### Plugin Contract Changes

Both `plugins/pingpay/src/contract.ts` and `plugins/stripe/src/contract.ts` get a new procedure **at the top** of the router:

```typescript
export const PaymentContract = oc.router({
  metadata: oc
    .route({ method: 'GET', path: '/metadata' })
    .output(z.object({
      name: z.string(),
      logo: z.string(),
      description: z.string(),
    })),

  ping: oc.route({ method: 'GET', path: '/ping' })...,
  createCheckout: oc.route({ method: 'POST', path: '/checkout' })...,
  verifyWebhook: oc.route({ method: 'POST', path: '/webhook' })...,
  getSession: oc.route({ method: 'GET', path: '/sessions/{sessionId}' })...,
});
```

### Plugin Metadata Handlers

**`plugins/pingpay/src/index.ts`** — add to `createRouter` return:

```typescript
metadata: builder.metadata.handler(async () => ({
  name: 'PingPay',
  logo: 'https://pay.everything.dev/logos/pingpay.svg',
  description: 'NEAR-based USDC payments',
})),
```

**`plugins/stripe/src/index.ts`** — add to `createRouter` return:

```typescript
metadata: builder.metadata.handler(async () => ({
  name: 'Stripe',
  logo: 'https://pay.everything.dev/logos/stripe.svg',
  description: 'Card payments via Stripe Checkout',
})),
```

The logo is a URL to a hosted image. The API passes it through to the UI which renders it as an `<img>` tag.

### API Contract Changes (`api/src/contract.ts`)

Delete all 8 provider-specific routes:
- `stripePing`, `stripeCreateCheckout`, `stripeVerifyWebhook`, `stripeGetSession`
- `pingpayPing`, `pingpayCreateCheckout`, `pingpayVerifyWebhook`, `pingpayGetSession`

Add 4 generic routes. Keep the shared schemas (`PaymentLineItemSchema`, `CheckoutSessionInputSchema`, etc.) defined inline at the top of the file:

```typescript
export const contract = oc.router({
  ping: oc.route({ method: 'GET', path: '/ping' }).output(
    z.object({ status: z.literal('ok'), timestamp: z.iso.datetime() }),
  ),

  paymentProviders: oc
    .route({ method: 'GET', path: '/payments/providers' })
    .output(z.array(z.object({
      key: z.string(),
      name: z.string(),
      logo: z.string(),
      description: z.string(),
    }))),

  paymentCheckout: oc
    .route({ method: 'POST', path: '/payments/checkout' })
    .input(z.object({
      provider: z.string(),
      orderId: z.string(),
      amount: z.number().positive(),
      currency: z.string().default('USD'),
      items: z.array(PaymentLineItemSchema),
      customerEmail: z.string().email().optional(),
      successUrl: z.string().url(),
      cancelUrl: z.string().url(),
      metadata: z.record(z.string(), z.string()).optional(),
      fees: z.array(z.object({
        type: z.string(),
        label: z.string(),
        recipient: z.string(),
        bps: z.number(),
      })).optional(),
    }))
    .output(CheckoutSessionOutputSchema),

  paymentWebhook: oc
    .route({ method: 'POST', path: '/payments/webhook/{provider}' })
    .input(WebhookInputSchema)
    .output(WebhookOutputSchema),

  paymentSession: oc
    .route({ method: 'GET', path: '/payments/sessions/{provider}/{sessionId}' })
    .output(GetSessionOutputSchema),
});
```

The `provider` field in `paymentCheckout` body and the `{provider}` path param in `paymentWebhook`/`paymentSession` are how the aggregator knows which plugin to delegate to at runtime.

### API `createRouter` Changes (`api/src/index.ts`)

Delete all provider-specific code from both `initialize` and `createRouter`.

**`initialize`** — remove `stripeClient`/`pingpayClient` destructuring. Just return `{ plugins: restPlugins, db }`:

```typescript
initialize: (config, plugins) =>
  Effect.provide(
    Effect.gen(function* () {
      const db = yield* DatabaseTag;
      const migrations = yield* Effect.promise(() => loadMigrations());
      yield* Effect.promise(() => migrate(db, migrations));
      const { auth, ...restPlugins } = plugins;
      return { auth, plugins: restPlugins, db };
    }),
    DatabaseLive(config.secrets.API_DATABASE_URL),
  ),
```

**`createRouter`** — replace all 8 provider-specific handlers with 4 generic handlers plus the existing `ping`:

```typescript
createRouter: (services, builder) => {
  const { requireAuth } = createAuthMiddleware(builder);

  const getPaymentPlugin = (provider: string) => {
    const factory = (services.plugins as Record<string, any>)[provider];
    if (!factory || typeof factory !== 'function') {
      throw new ORPCError('NOT_FOUND', `Unknown payment provider: ${provider}`);
    }
    return factory;
  };

  return {
    ping: builder.ping.handler(async () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
    })),

    paymentProviders: builder.paymentProviders.handler(async () => {
      const providers: Array<{ key: string; name: string; logo: string; description: string }> = [];

      for (const [key, factory] of Object.entries(services.plugins)) {
        if (key === 'auth') continue;
        if (typeof factory !== 'function') continue;
        try {
          const client = factory();
          const metadata = await client.metadata();
          providers.push({ key, ...metadata });
        } catch {
          // skip plugins that don't implement metadata
        }
      }

      return providers;
    }),

    paymentCheckout: builder.paymentCheckout.handler(async ({ input }) => {
      const { provider, ...checkoutInput } = input;
      const factory = getPaymentPlugin(provider);
      const client = factory();
      return await client.createCheckout(checkoutInput) as any;
    }),

    paymentWebhook: builder.paymentWebhook.handler(async ({ input, context }) => {
      const { provider, ...webhookInput } = input as { provider: string; body: string; signature: string; timestamp?: string };
      const factory = getPaymentPlugin(provider);
      const client = factory({ headers: context.reqHeaders });
      return await client.verifyWebhook(webhookInput) as any;
    }),

    paymentSession: builder.paymentSession.handler(async ({ input }) => {
      const { provider, sessionId } = input as { provider: string; sessionId: string };
      const factory = getPaymentPlugin(provider);
      const client = factory();
      return await client.getSession({ sessionId }) as any;
    }),
  };
},
```

Key design decisions:
- The only `as any` cast is on `services.plugins[provider]` for dynamic key access. This is acceptable — it's validated at runtime via the `getPaymentPlugin` check.
- `paymentProviders` iterates all plugin keys, calls `metadata()`, catches errors from non-payment plugins. This means any plugin that implements the `metadata` procedure will appear.
- Webhook passes `context.reqHeaders` through to the plugin client for signature verification.
- Provider key comes from `bos.config.json` plugin registration key (e.g., `"stripe"`, `"pingpay"`).

### Deleted Code

| Location | What is removed |
|----------|----------------|
| `api/src/contract.ts` lines 70–114 | All 8 provider-specific route definitions |
| `api/src/index.ts` `initialize` | `stripeClient`/`pingpayClient` destructuring and return |
| `api/src/index.ts` `createRouter` lines 54–103 | All 8 provider-specific handler implementations |

### Acceptance Criteria
- [ ] Both plugins have `metadata` procedure in their `PaymentContract` and `createRouter`
- [ ] `GET /metadata` on each plugin returns `{ name, logo, description }`
- [ ] `api/src/contract.ts` has exactly 5 routes: `ping`, `paymentProviders`, `paymentCheckout`, `paymentWebhook`, `paymentSession`
- [ ] Zero provider-specific route names in the contract (`stripePing`, `pingpayCreateCheckout`, etc. are gone)
- [ ] `api/src/index.ts` has zero hardcoded references to `stripe` or `pingpay`
- [ ] `GET /api/payments/providers` returns an array with entries for each registered payment plugin
- [ ] `POST /api/payments/checkout` delegates to the provider specified in `input.provider`
- [ ] `POST /api/payments/webhook/{provider}` delegates to the correct plugin with headers
- [ ] `GET /api/payments/sessions/{provider}/{sessionId}` retrieves session from correct plugin
- [ ] Unknown provider returns a `NOT_FOUND` error
- [ ] `bun typecheck` passes in `api/`, `plugins/pingpay/`, and `plugins/stripe/`
- [ ] `bun lint` passes in all changed packages
- [ ] `api/src/lib/plugins-types.gen.ts` is NOT manually edited

### Notes
- [ ] The `as any` casts on `createCheckout`, `verifyWebhook`, and `getSession` return values are temporary — after `bos types gen` generates typed plugin factories, they can be removed
- [ ] `paymentProviders` uses try/catch to skip plugins that don't implement `metadata` — this is intentional so non-payment plugins (like `auth`) don't break discovery
- [ ] Plugin contract files for pingpay and stripe will temporarily diverge (they'll both have identical `metadata` + 4 procedures) — acceptable since contracts are per-plugin
- [ ] If `bos.config.json` has a payment plugin registered but that plugin's contract doesn't include `metadata`, it will be silently skipped in the providers list
- [ ] Existing integration tests in `plugins/pingpay/tests/` and `plugins/stripe/tests/` will need their `getPluginClient` usage updated to account for the new `metadata` procedure — it won't break existing test code but new procedure should be tested
- [ ] The `plugins/api` codebase is not affected — it imports `PaymentContract` directly from plugin source, not through the API aggregator
