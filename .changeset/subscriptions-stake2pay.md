---
"api": minor
"ui": minor
---

Subscriptions (Epic 004): stake-to-pay and Stripe Billing behind one contract.

- api: seven generic subscription routes (`/subscriptions/providers`, plans, create, status, cancel, resume, change) with dynamic provider discovery — adding a subscription provider is config-only. `payerRef` defaults server-side from the session NEAR account (`walletAddress`).
- ui: new `/subscriptions` page — provider cards, demo plan tiers, in-page NEAR wallet signing of multi-action intents (storage_deposit + lock batched under the 1000 Tgas prepaid cap) with chain-state polling, Stripe Checkout redirect, and cancel/resume lifecycle. Login page gains a mainnet/testnet network toggle. New landing page linking the payments and subscriptions demos.
- providers: `stake2pay` plugin (House of Stake NEAR staking, read-only RPC, no secrets) and Stripe Billing implementing the shared `SubscriptionContract` alongside `PaymentContract`.
