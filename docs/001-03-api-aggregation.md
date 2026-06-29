# 001-03: Aggregate Payment Plugins via API createRouter

### Context

This is a child ticket of #001, blocked by #001-01 and #001-02. With both `pingpay` and `stripe` plugins available, add provider-specific payment routes to the API contract (`api/src/contract.ts`) and wire them in the API `createRouter` to delegate to the appropriate plugin client.

### Overview

Add 8 new routes to `api/src/contract.ts` (4 for Stripe, 4 for PingPay) under `/payments/{provider}/*`. In `api/src/index.ts`, destructure `stripe` and `pingpay` from `services.plugins` and wire each handler to call the plugin client. Do NOT edit `api/src/lib/plugins-types.gen.ts` — it will be regenerated later via `bos types gen`.

### Contract Additions (`api/src/contract.ts`)

Add these routes to the existing contract (which currently only has `ping`):

```typescript
// Stripe payment routes
stripePing: oc
  .route({ method: 'GET', path: '/payments/stripe/ping' })
  .output(z.object({
    provider: z.string(),
    status: z.literal('ok'),
    timestamp: z.string().datetime(),
  })),

stripeCreateCheckout: oc
  .route({ method: 'POST', path: '/payments/stripe/checkout' })
  .input(CheckoutSessionInputSchema)     // reuse from plugins/stripe
  .output(CheckoutSessionOutputSchema),  // reuse from plugins/stripe

stripeVerifyWebhook: oc
  .route({ method: 'POST', path: '/payments/stripe/webhook' })
  .input(WebhookInputSchema)
  .output(WebhookOutputSchema),

stripeGetSession: oc
  .route({ method: 'GET', path: '/payments/stripe/sessions/{sessionId}' })
  .input(GetSessionInputSchema)
  .output(GetSessionOutputSchema),

// PingPay payment routes
pingpayPing: oc
  .route({ method: 'GET', path: '/payments/pingpay/ping' })
  .output(z.object({
    provider: z.string(),
    status: z.literal('ok'),
    timestamp: z.string().datetime(),
  })),

pingpayCreateCheckout: oc
  .route({ method: 'POST', path: '/payments/pingpay/checkout' })
  .input(CheckoutSessionInputSchema)
  .output(CheckoutSessionOutputSchema),

pingpayVerifyWebhook: oc
  .route({ method: 'POST', path: '/payments/pingpay/webhook' })
  .input(WebhookInputSchema)
  .output(WebhookOutputSchema),

pingpayGetSession: oc
  .route({ method: 'GET', path: '/payments/pingpay/sessions/{sessionId}' })
  .input(GetSessionInputSchema)
  .output(GetSessionOutputSchema),
```

The schemas (`CheckoutSessionInputSchema`, `CheckoutSessionOutputSchema`, `WebhookInputSchema`, `WebhookOutputSchema`, `GetSessionInputSchema`, `GetSessionOutputSchema`) are either:
- Imported from the shared payment schemas (copy into `api/src/` or import from one of the plugins)
- Re-defined inline in the contract

**Prefer importing from one of the plugin contracts** to avoid duplication and stay in sync.

### API createRouter Changes (`api/src/index.ts`)

In the `createRouter` function, destructure the payment plugin clients from services:

```typescript
createRouter: (services, builder) => {
  const { requireAuth } = createAuthMiddleware(builder);
  const { stripe, pingpay } = services.plugins as Record<string, Function>;

  return {
    ping: builder.ping.handler(async () => ({
      status: "ok",
      timestamp: new Date().toISOString(),
    })),

    // Stripe routes — delegate to stripe plugin client
    stripePing: builder.stripePing.handler(async () => {
      const client = stripe();
      return await client.ping();
    }),

    stripeCreateCheckout: builder.stripeCreateCheckout.handler(async ({ input }) => {
      const client = stripe();
      return await client.createCheckout(input);
    }),

    stripeVerifyWebhook: builder.stripeVerifyWebhook.handler(async ({ input, context }) => {
      const client = stripe({ headers: context.reqHeaders });
      return await client.verifyWebhook(input);
    }),

    stripeGetSession: builder.stripeGetSession.handler(async ({ input }) => {
      const client = stripe();
      return await client.getSession(input);
    }),

    // PingPay routes — delegate to pingpay plugin client
    pingpayPing: builder.pingpayPing.handler(async () => {
      const client = pingpay();
      return await client.ping();
    }),

    pingpayCreateCheckout: builder.pingpayCreateCheckout.handler(async ({ input }) => {
      const client = pingpay();
      return await client.createCheckout(input);
    }),

    pingpayVerifyWebhook: builder.pingpayVerifyWebhook.handler(async ({ input, context }) => {
      const client = pingpay({ headers: context.reqHeaders });
      return await client.verifyWebhook(input);
    }),

    pingpayGetSession: builder.pingpayGetSession.handler(async ({ input }) => {
      const client = pingpay();
      return await client.getSession(input);
    }),
  };
},
```

### What is NOT done in this ticket

- `api/src/lib/plugins-types.gen.ts` is NOT edited — it will be regenerated later via `bos types gen` after the plugins are registered in `bos.config.json`
- The `PluginsClient` type will not yet include `pingpay` or `stripe` — `(services.plugins as Record<string, Function>)` cast is a temporary workaround until regeneration
- The plugins are NOT registered in `bos.config.json` — that happens at deploy time via the rspack build step, or manually for dev
- The existing `plugins/api/` code is NOT touched

### Acceptance Criteria
- [ ] `api/src/contract.ts` has 8 new payment routes under `/payments/stripe/` and `/payments/pingpay/`
- [ ] `api/src/index.ts` createRouter wires all 8 handlers to delegate to the correct plugin client
- [ ] `GET /api/payments/stripe/ping` returns `{ provider: "stripe", status: "ok", timestamp }`
- [ ] `GET /api/payments/pingpay/ping` returns `{ provider: "pingpay", status: "ok", timestamp }`
- [ ] `POST /api/payments/stripe/checkout` creates a Stripe session via the stripe plugin client
- [ ] `POST /api/payments/pingpay/checkout` creates a PingPay session via the pingpay plugin client
- [ ] `POST /api/payments/stripe/webhook` verifies signature and parses event via stripe plugin
- [ ] `POST /api/payments/pingpay/webhook` verifies signature and parses event via pingpay plugin
- [ ] `GET /api/payments/stripe/sessions/{id}` retrieves session via stripe plugin
- [ ] `GET /api/payments/pingpay/sessions/{id}` retrieves session via pingpay plugin
- [ ] `bun typecheck` passes in `api/` (temporary casts for untyped plugins are acceptable)
- [ ] `bun lint` passes in `api/`
- [ ] `plugins-types.gen.ts` is left untouched

### Notes
- [ ] The `CheckoutSessionInputSchema` etc. should be imported from one plugin or extracted into a shared location — do NOT redefine them inline in the contract
- [ ] Webhook endpoints need access to raw headers (`reqHeaders`) and raw body (`getRawBody`) for signature verification — ensure context passes these through
- [ ] Payment checkout routes SHOULD use `requireAuth` middleware to ensure the user is authenticated before creating a checkout session
- [ ] Plugin client factories accept optional context (`(context?) => ContractRouterClient`) — pass headers/webhook context through when needed
- [ ] Once `bos types gen` is run later, the `Record<string, Function>` cast can be replaced with typed plugin access
