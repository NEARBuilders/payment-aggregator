---
"api": minor
"ui": minor
---

Credit/entitlement ledger and a dedicated Stake2Pay demo page that turns a confirmed NEAR stake into visible inference credits.

- api: `entitlements` / `entitlement_transactions` tables (NUMERIC balances, `NULLS NOT DISTINCT` personal-credit dedup, unique `source_ref` idempotency key) and an `EntitlementService` for atomic grant/balance tracking. New `creditList` (`GET /credits`) and `subscriptionCreditSync` (`POST /subscriptions/{provider}/credits/sync`) routes — the sync route re-reads the subscription from the provider plugin itself (never trusts a client-supplied amount), grants credits keyed on the on-chain lock id, and retries briefly when the chain shows a subscription but the lock hasn't propagated yet.
- ui: new `/subscriptions/stake2pay` page — NEAR wallet connect, single-plan stake flow, live credit counter with optimistic update reconciled against the server, and a guard that switches to a "sync only" action (no re-staking) when the wallet already has an active subscription. Shared `signWalletIntent` logic extracted out of `/subscriptions` into `lib/wallet-intent.ts` so both pages sign transactions identically.
