# 004-01: SubscriptionContract Definition + Shared Schemas

Part of Epic 004 (#27). No dependencies — foundation ticket.

### Context

`PaymentContract` models one-time checkout: hosted URL out, webhook push in, one terminal session. Subscriptions break all three assumptions — stake2pay has no URL (the wallet signs a contract call built from intents) and no webhooks (state is pulled from chain), and both providers need lifecycle verbs (cancel / resume / change plan). Following the Epic 001 pattern where `PaymentContract` lives in plugin source and is imported directly by consumers, `SubscriptionContract` is defined once and implemented by `plugins/stake2pay` (004-02) and `plugins/stripe` (004-06).

### Overview

1. Define `SubscriptionContract` (oRPC) + shared Zod schemas in `plugins/stake2pay/src/contract.ts` / `schema.ts` (canonical source, mirroring how `PaymentContract` lives in `plugins/pingpay/src/`):
   - `metadata` — name, logo, description (same shape as `PaymentContract.metadata` so discovery can reuse it)
   - `ping`
   - `listPlans` — output `PlanSchema[]`
   - `createSubscription` — input: `planId`, `amount` (for range-priced plans), `payerRef` (NEAR account / customer email), `successUrl`/`cancelUrl` (hosted providers); output: `SubscriptionActionSchema`
   - `getSubscription` — input: `planId` + `payerRef`; output: `SubscriptionSchema`
   - `cancelSubscription` / `resumeSubscription` / `changePlan` — output: `SubscriptionActionSchema`
2. `PlanSchema`: `id`, `name`, `description`, `period` (`monthly` | ...), `currency` (`NEAR` | `USD`), `minAmount`, `maxAmount` (HoS plans are lock ranges; fixed-price providers set min == max), `metadata`.
3. `SubscriptionActionSchema` — discriminated union on `kind`:
   - `wallet_intent`: `networkId`, `contractId`, `methodName`, `args` (JSON), `deposit`, `gas`
   - `redirect`: `url`
   - `executed`: `subscription` (the resulting `SubscriptionSchema`)
4. `SubscriptionSchema`: `id`, `planId`, `status` (`active` | `cancel_at_period_end` | `pending_unstake` | `ended` | `none`), `currentPeriodEnd`, `amount`, `payerRef`, `metadata`.

### Acceptance Criteria
- [ ] Contract + schemas exported from plugin source and importable by `api/` the same way `PaymentContract` is
- [ ] Both a wallet-intent provider (stake2pay) and a hosted/API provider (Stripe) are expressible without provider-specific fields leaking into the contract
- [ ] Zod schemas round-trip the HoS testnet catalog shapes (range prices, yocto amounts as strings) and Stripe recurring prices
- [ ] `bun typecheck` and `bun lint` pass

### Notes
- [ ] Amounts cross the wire as strings (yoctoNEAR exceeds JS safe integers).
- [ ] Keep `metadata` shape identical to `PaymentContract.metadata` so a single discovery loop can probe both contracts.
