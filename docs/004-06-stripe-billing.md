# 004-06: Stripe Billing Implements SubscriptionContract

Part of Epic 004 (#27). Depends on 004-01, 004-03.

### Context

Stripe is the aggregator's existing card provider for one-time payments. Adding recurring billing through the same `SubscriptionContract` proves the contract is provider-agnostic (one wallet-intent provider, one hosted/API provider) and gives merchants card-paid subscriptions next to stake-paid ones. This is the classic Checkout-vs-Billing split: `plugins/stripe` will implement both contracts.

### Overview

1. Implement `SubscriptionContract` in `plugins/stripe/` alongside its `PaymentContract`:
   - `listPlans` ← Stripe Prices with `type: "recurring"` (+ product expand); `minAmount == maxAmount`, `currency: "USD"`, `period` from `recurring.interval`
   - `createSubscription` → Checkout Session with `mode: "subscription"` → `SubscriptionAction { kind: "redirect", url }`
   - `getSubscription` ← Subscriptions API (lookup by customer email or subscription id in `payerRef`), mapping Stripe status → shared enum (`active`, `cancel_at_period_end` via `cancel_at_period_end: true`, `ended` for canceled/expired)
   - `cancelSubscription` (`cancel_at_period_end: true`) / `resumeSubscription` (`cancel_at_period_end: false`) / `changePlan` (update subscription item price, standard proration) → `{ kind: "executed", subscription }`
2. Subscription webhooks (`customer.subscription.*`, `invoice.*`) flow through the existing `paymentWebhook` route and Epic 003 event persistence — extend the stripe plugin's `verifyWebhook` event mapping if these event types need `orderId`/`sessionId` extraction; no new webhook surface.
3. Tests follow `plugins/stripe/tests/` conventions (SDK mocked at module level with a plain constructor function; fake secrets required).

### Acceptance Criteria
- [ ] stake2pay and stripe both appear in `GET /subscriptions/providers` with **zero** `api/src/` changes for this ticket
- [ ] Test-mode flow: plan list → Checkout redirect → (after webhook/API confirm) `getSubscription` returns `active`
- [ ] Cancel/resume round-trip flips `cancel_at_period_end` and reflects in `getSubscription`
- [ ] One-time Stripe flow (`PaymentContract`) untouched and green
- [ ] `bun run test`, `bun typecheck`, `bun lint` pass

### Notes
- [ ] `payerRef` for Stripe is customer email (creation) / subscription id (management) — the contract's opaque-string design from 004-01 must absorb this without NEAR-specific assumptions.
