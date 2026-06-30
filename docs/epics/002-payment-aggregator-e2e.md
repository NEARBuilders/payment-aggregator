# Epic 002: Payment Aggregator E2E Implementation

### Context

Epic 001 extracted Stripe and PingPay into standalone plugins under `plugins/stripe/` and `plugins/pingpay/`, then wired them into `api/src/index.ts` via provider-specific contract routes (`stripePing`, `pingpayCreateCheckout`, etc.) with hardcoded plugin destructuring. That works but is fragile — adding or removing a provider requires contract edits, creator updates, and new route wires.

This epic makes the aggregator **generic**. The API discovers available payment providers dynamically, routes to them via a single set of provider-agnostic endpoints, and exposes metadata (name, logo, description) so the UI can render provider cards without knowing which providers exist at build time. The UI gets a `/payments` page that queries provider metadata, displays interactive provider cards, and offers a full checkout → session → webhook testing flow.

Two E2E implementation tickets ensure the full chain works correctly for PingPay (NEAR USDC, HMAC-SHA256 webhooks) and Stripe (card payments, Stripe signature webhooks), each with integration tests that can be adapted for future providers.

### Tickets

| # | Ticket | Dependency |
|---|--------|------------|
| 002-01 | Aggregator API + Provider Discovery | — |
| 002-02 | Generic Payment UI | 002-01 |
| 002-03 | E2E PingPay Implementation | 002-01 |
| 002-04 | E2E Stripe Implementation | 002-01 |

### Acceptance Criteria
- [ ] Plugins expose `GET /metadata` returning `{ name, logo, description }`
- [ ] API contract has 4 generic payment routes (not 8 provider-specific ones)
- [ ] API `createRouter` dynamically resolves providers — zero hardcoded `stripe`/`pingpay` references
- [ ] Removing a plugin from `bos.config.json` removes it from `GET /payments/providers` with no code changes
- [ ] UI `/payments` page renders provider cards from metadata, offers checkout/session/webhook testing
- [ ] Full E2E flow works for PingPay (checkout → session → webhook)
- [ ] Full E2E flow works for Stripe (checkout → session → webhook)
- [ ] Integration tests pass for both providers through the aggregator
- [ ] `bun typecheck` passes for `api/` and `ui/` (temporary `as any` cast on dynamic lookup is acceptable until `bos types gen`)
- [ ] `bun lint` passes for all changed packages
