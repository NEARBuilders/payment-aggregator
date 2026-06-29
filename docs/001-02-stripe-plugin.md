# 001-02: Create Stripe Plugin (`plugins/stripe/`)

### Context

This is a child ticket of #001, not blocked by any other ticket (can be done in parallel with 001-01). Copy `plugins/_template/` into `plugins/stripe/` and implement the shared `PaymentContract` using existing implementations from `plugins/api/src/services/payment/stripe/`. The Stripe plugin handles card-based payments via Stripe Checkout Sessions, including webhook signature verification.

### Overview

Scaffold `plugins/stripe/` from `plugins/_template/`. Copy the `PaymentContract` and schemas from `plugins/api/src/services/payment/contract.ts` and `plugins/api/src/services/payment/schema.ts`. Port the existing Stripe service from `plugins/api/src/services/payment/stripe/`.

### Files to Create

| File | Source |
|------|--------|
| `plugins/stripe/package.json` | New (name `"stripe"`) |
| `plugins/stripe/plugin.dev.ts` | Template pattern + Stripe config |
| `plugins/stripe/rspack.config.js` | Copy from `plugins/_template/rspack.config.js` |
| `plugins/stripe/tsconfig.json` | Copy from `plugins/_template/tsconfig.json` |
| `plugins/stripe/vitest.config.ts` | Copy from `plugins/_template/vitest.config.ts` |
| `plugins/stripe/src/contract.ts` | Copy from `plugins/api/src/services/payment/contract.ts` |
| `plugins/stripe/src/schema.ts` | Copy from `plugins/api/src/services/payment/schema.ts` |
| `plugins/stripe/src/index.ts` | Port from `plugins/api/src/services/payment/stripe/index.ts` |
| `plugins/stripe/src/service.ts` | Port from `plugins/api/src/services/payment/stripe/service.ts` |
| `plugins/stripe/tests/setup.ts` | Template pattern + Stripe config |
| `plugins/stripe/tests/types.d.ts` | Template pattern |
| `plugins/stripe/tests/integration/plugin.test.ts` | Tests for all 4 contract procedures |
| `plugins/stripe/tests/unit/service.test.ts` | Tests for StripePaymentService |

### Package Dependencies

```json
{
  "name": "stripe",
  "dependencies": {
    "@orpc/contract": "catalog:",
    "@orpc/server": "catalog:",
    "effect": "catalog:",
    "stripe": "^20.0.0"
  },
  "devDependencies": {
    "everything-dev": "catalog:",
    "every-plugin": "catalog:",
    "vite-tsconfig-paths": "catalog:",
    "vitest": "catalog:",
    "@rspack/cli": "catalog:",
    "@rspack/core": "catalog:",
    "@module-federation/node": "catalog:",
    "zephyr-rspack-plugin": "catalog:",
    "dotenv": "^17.2.3"
  }
}
```

### Contract

The Stripe plugin implements the **same** `PaymentContract` as PingPay (they share the contract). 4 procedures:

| Procedure | Method | Path | Description |
|-----------|--------|------|-------------|
| `ping` | GET | `/ping` | Health check, returns provider name |
| `createCheckout` | POST | `/checkout` | Create a Stripe Checkout Session |
| `verifyWebhook` | POST | `/webhook` | Verify Stripe webhook signature and parse event |
| `getSession` | GET | `/sessions/{sessionId}` | Retrieve Stripe session status and details |

### Implementation Details

#### `plugin.dev.ts`
- `pluginId`: `"stripe"`
- `port`: `3016`
- `secrets`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` from `process.env`

#### `src/contract.ts`
Identical to `plugins/api/src/services/payment/contract.ts`. Exports `PaymentContract` and `PaymentContractType`.

#### `src/schema.ts`
Identical to `plugins/api/src/services/payment/schema.ts`. Shared schemas: `CheckoutSessionInputSchema`, `CheckoutSessionOutputSchema`, `WebhookInputSchema`, `WebhookOutputSchema`, `GetSessionInputSchema`, `GetSessionOutputSchema`, `FeeConfigSchema`, `PaymentLineItemSchema`.

#### `src/index.ts`
`createPlugin()` (NOT `withPlugins`, no inter-plugin deps needed):
- `variables`: `baseUrl` (optional)
- `secrets`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (both required)
- `contract`: `PaymentContract`
- `initialize`: Creates `StripePaymentService` instance with secret key + webhook secret
- `createRouter`: Implements all 4 handlers using the service instance

#### `src/service.ts`
`StripePaymentService` class wrapping the Stripe SDK (`apiVersion: 2026-02-25.clover`):
- `createCheckout()` — creates Stripe Checkout Session with line items, metadata, success/cancel URLs
- `verifyWebhook()` — verifies webhook signature via `stripe.webhooks.constructEvent`, extracts orderId from session metadata
- `getSession()` — retrieves checkout session by ID via `stripe.checkout.sessions.retrieve`

### Acceptance Criteria
- [ ] `plugins/stripe/` directory exists with all files listed above
- [ ] Plugin runs standalone via `bun run dev` in `plugins/stripe/`
- [ ] `ping` handler returns `{ provider: "stripe", status: "ok", timestamp }`
- [ ] `createCheckout` handler accepts `CheckoutSessionInput`, creates Stripe Checkout Session, returns `{ sessionId, url }`
- [ ] `verifyWebhook` handler validates Stripe signatures via `stripe.webhooks.constructEvent` and returns `{ received, eventType?, orderId? }`
- [ ] `getSession` handler returns normalized session with id, status, paymentStatus, amountTotal, currency, metadata
- [ ] Unit tests pass: `bun run test` in `plugins/stripe/`
- [ ] Integration tests pass covering all 4 procedures
- [ ] `bun typecheck` passes in `plugins/stripe/`

### Notes
- [ ] Do NOT modify `plugins/api/src/services/payment/stripe/` — this is a copy, not a move
- [ ] The `src/schema.ts` is shared between pingpay and stripe plugins — both contain the same file content
- [ ] Stripe plugin is simpler than PingPay (no separate client/webhook/errors files — it all lives in `service.ts`)
- [ ] `stripe@^20.0.0` is the library used. `apiVersion: 2026-02-25.clover` is the API version
- [ ] Test setup should mock Stripe API calls (avoid real network calls in unit tests)
