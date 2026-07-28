# api

## 2.7.0

### Minor Changes

- 365923d: Credit/entitlement ledger and a dedicated Stake2Pay demo page that turns a confirmed NEAR stake into visible inference credits.

  - api: `entitlements` / `entitlement_transactions` tables (NUMERIC balances, `NULLS NOT DISTINCT` personal-credit dedup, unique `source_ref` idempotency key) and an `EntitlementService` for atomic grant/balance tracking. New `creditList` (`GET /credits`) and `subscriptionCreditSync` (`POST /subscriptions/{provider}/credits/sync`) routes — the sync route re-reads the subscription from the provider plugin itself (never trusts a client-supplied amount), grants credits keyed on the on-chain lock id, and retries briefly when the chain shows a subscription but the lock hasn't propagated yet.
  - ui: new `/subscriptions/stake2pay` page — NEAR wallet connect, single-plan stake flow, live credit counter with optimistic update reconciled against the server, and a guard that switches to a "sync only" action (no re-staking) when the wallet already has an active subscription. Shared `signWalletIntent` logic extracted out of `/subscriptions` into `lib/wallet-intent.ts` so both pages sign transactions identically.

## 2.6.0

### Minor Changes

- 6bd43e7: Subscriptions (Epic 004): stake-to-pay and Stripe Billing behind one contract.

  - api: seven generic subscription routes (`/subscriptions/providers`, plans, create, status, cancel, resume, change) with dynamic provider discovery — adding a subscription provider is config-only. `payerRef` defaults server-side from the session NEAR account (`walletAddress`).
  - ui: new `/subscriptions` page — provider cards, demo plan tiers, in-page NEAR wallet signing of multi-action intents (storage_deposit + lock batched under the 1000 Tgas prepaid cap) with chain-state polling, Stripe Checkout redirect, and cancel/resume lifecycle. Login page gains a mainnet/testnet network toggle. New landing page linking the payments and subscriptions demos.
  - providers: `stake2pay` plugin (House of Stake NEAR staking, read-only RPC, no secrets) and Stripe Billing implementing the shared `SubscriptionContract` alongside `PaymentContract`.

### Patch Changes

- 4c332cf: Fix type errors: stale imports, missing effect deps, and context schema cleanup.

  - api: consolidated stale `./db/load-migrations` and `./db/migrator` imports to `./db/migrate`; replaced inline context schema with `ContextSchema` from `lib/context`; switched `resolvePayerRef`/`requirePayerRef` from non-existent `walletAddress` to `context.near?.primaryAccountId`.
  - pingpay, stake2pay, stripe: added missing `effect` dependency (peer of `every-plugin`); added `context: ContextSchema` from `lib/context`.

## 2.5.0

### Minor Changes

- b662086: Replace manual EventSource SSE with oRPC MemoryPublisher + eventIterator. Eliminates MaxListenersExceededWarning from Node EventTarget, stabilizes query keys to prevent refetch cascades, and adds typed streaming via VoteEventSchema contract.
