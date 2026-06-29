# 001-01: Create PingPay Plugin (`plugins/pingpay/`)

### Context

This is a child ticket of #001, not blocked by any other ticket. Copy `plugins/_template/` into `plugins/pingpay/` and implement the shared `PaymentContract` using existing implementations from `plugins/api/src/services/payment/pingpay/`. The PingPay plugin handles NEAR-based USDC payments, including checkout session creation, webhook signature verification, and session retrieval.

### Overview

Scaffold `plugins/pingpay/` from `plugins/_template/`. Copy the `PaymentContract` and schemas from `plugins/api/src/services/payment/contract.ts` and `plugins/api/src/services/payment/schema.ts`. Port the existing PingPay service, client, webhook handler, and error types from `plugins/api/src/services/payment/pingpay/`.

### Files to Create

| File | Source |
|------|--------|
| `plugins/pingpay/package.json` | New (name `"pingpay"`) |
| `plugins/pingpay/plugin.dev.ts` | Template pattern + PingPay config |
| `plugins/pingpay/rspack.config.js` | Copy from `plugins/_template/rspack.config.js` |
| `plugins/pingpay/tsconfig.json` | Copy from `plugins/_template/tsconfig.json` |
| `plugins/pingpay/vitest.config.ts` | Copy from `plugins/_template/vitest.config.ts` |
| `plugins/pingpay/src/contract.ts` | Copy from `plugins/api/src/services/payment/contract.ts` |
| `plugins/pingpay/src/schema.ts` | Copy from `plugins/api/src/services/payment/schema.ts` + merge in Ping webhook schemas |
| `plugins/pingpay/src/index.ts` | Port from `plugins/api/src/services/payment/pingpay/index.ts` |
| `plugins/pingpay/src/service.ts` | Port from `plugins/api/src/services/payment/pingpay/service.ts` |
| `plugins/pingpay/src/client.ts` | Port from `plugins/api/src/services/payment/pingpay/client.ts` |
| `plugins/pingpay/src/errors.ts` | Port from `plugins/api/src/services/payment/pingpay/errors.ts` |
| `plugins/pingpay/src/webhook.ts` | Port from `plugins/api/src/services/payment/pingpay/webhook.ts` |
| `plugins/pingpay/tests/setup.ts` | Template pattern + PingPay config |
| `plugins/pingpay/tests/types.d.ts` | Template pattern |
| `plugins/pingpay/tests/integration/plugin.test.ts` | Tests for all 4 contract procedures |
| `plugins/pingpay/tests/unit/service.test.ts` | Tests for PingPayService |

### Package Dependencies

```json
{
  "name": "pingpay",
  "dependencies": {
    "@orpc/contract": "catalog:",
    "@orpc/server": "catalog:",
    "effect": "catalog:"
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

The PingPay plugin implements the `PaymentContract` with 4 procedures:

| Procedure | Method | Path | Description |
|-----------|--------|------|-------------|
| `ping` | GET | `/ping` | Health check, returns provider name |
| `createCheckout` | POST | `/checkout` | Create a payment checkout session |
| `verifyWebhook` | POST | `/webhook` | Verify and parse an incoming webhook |
| `getSession` | GET | `/sessions/{sessionId}` | Retrieve session status and details |

### Implementation Details

#### `plugin.dev.ts`
- `pluginId`: `"pingpay"`
- `port`: `3015`
- `variables`: `baseUrl` (default `https://pay.pingpay.io`), `recipientAddress` (default `near-merch-store.near`)
- `secrets`: `PING_API_KEY`, `PING_WEBHOOK_SECRET` from `process.env`

#### `src/contract.ts`
Identical to `plugins/api/src/services/payment/contract.ts`. Exports `PaymentContract` and `PaymentContractType`. Imports schemas from local `./schema`.

#### `src/schema.ts`
Merge both:
- Shared payment schemas from `plugins/api/src/services/payment/schema.ts` (CheckoutSessionInput, WebhookInput, GetSessionInput, etc.)
- Ping-specific schemas from `plugins/api/src/services/payment/pingpay/schema.ts` (PingWebhookPayloadSchema, PingWebhookResultSchema)

#### `src/index.ts`
`createPlugin()` (NOT `withPlugins`, no inter-plugin deps needed):
- `variables`: `baseUrl`, `recipientAddress`
- `secrets`: `PING_API_KEY`, `PING_WEBHOOK_SECRET`
- `contract`: `PaymentContract`
- `initialize`: Creates `PingPayServiceLive` Effect layer, logs config status
- `createRouter`: Implements all 4 handlers via `Effect.runPromise` with `PingPayServiceLive`

#### `src/service.ts`
`PingPayService` Effect context tag class:
- `verifyPingPayWebhookSignature()` — HMAC-SHA256 timing-safe verification
- `createCheckout()` — converts amount to USDC (cents * 10000), creates session via `PingPayClient`, supports optional fees
- `verifyWebhook()` — verifies signature, parses JSON with `PingWebhookPayloadSchema`
- `getSession()` — retrieves session, normalizes status/amount/currency

#### `src/client.ts`
`PingPayClient` class — HTTP client for PingPay API:
- Auto-detects test mode (no API key or key starting with `test_`)
- `ping()`, `createCheckoutSession()`, `getCheckoutSession()` — each with test-mode mock responses
- All requests to `{baseUrl}/api/*` with `x-api-key` header

#### `src/errors.ts`
Effect Data tagged errors: `WebhookSignatureError`, `WebhookParseError`, `PingApiError`, `CheckoutCreationError`

### Acceptance Criteria
- [ ] `plugins/pingpay/` directory exists with all files listed above
- [ ] Plugin runs standalone via `bun run dev` in `plugins/pingpay/`
- [ ] `ping` handler returns `{ provider: "pingpay", status: "ok", timestamp }`
- [ ] `createCheckout` handler accepts `CheckoutSessionInput` with optional fees, returns `{ sessionId, url }`
- [ ] `verifyWebhook` handler validates HMAC-SHA256 signatures and returns `{ received, eventType?, orderId?, sessionId? }`
- [ ] `getSession` handler returns normalized session with id, status, paymentStatus, amountTotal, currency, metadata
- [ ] Unit tests pass: `bun run test` in `plugins/pingpay/`
- [ ] Integration tests pass covering all 4 procedures
- [ ] `bun typecheck` passes in `plugins/pingpay/`

### Notes
- [ ] Do NOT modify `plugins/api/src/services/payment/pingpay/` — this is a copy, not a move
- [ ] The `src/schema.ts` should include both the shared payment schemas and the Ping-specific webhook schemas (merged into one file)
- [ ] Follow the `_template` pattern for `plugin.dev.ts` (satisfies `PluginConfigInput<typeof Plugin>`)
- [ ] Test setup should mirror `plugins/_template/tests/setup.ts` using `createPluginRuntime` with the registry
