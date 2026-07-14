# 004-02: Stake2Pay Plugin (House of Stake NEAR Staking)

Part of Epic 004 (#27). Depends on 004-01.

### Context

The stake2pay provider is a TypeScript port of the chain-facing half of [nearai/chat-api PR #275](https://github.com/nearai/chat-api/pull/275) (`crates/services/src/subscription/near_staking.rs`): read-only JSON-RPC view calls against the House of Stake staking contract, mapped into the aggregator's subscription schemas. The wallet does all writes, so the plugin has **no secrets** — a first for this repo.

### Overview

1. Scaffold `plugins/stake2pay/` from `plugins/_template/`, implementing `SubscriptionContract` (004-01).
2. `variables` (no `secrets`): `rpcUrl` (default `https://rpc.testnet.near.org`), `networkId` (`testnet`), `contractId`, `productId`.
3. `client.ts` — minimal JSON-RPC view-call helper (`query` / `call_function`, base64 args, 15s timeout, typed errors). Plain `fetch`; no heavyweight SDK needed for views.
4. `service.ts` (Effect service) mapping chain JSON → contract schemas:
   - `listPlans` ← `get_product(product_id)` / `get_price(price_id)` — range prices (`min`/`max` yocto), `Recurring` vs `OneOff`, `Active` status filter
   - `getSubscription` ← `get_subscription_for_price(account_id, price_id)` — map chain status incl. pending unstake to the status enum
   - `createSubscription` → `wallet_intent` for the contract's `lock`/subscribe method (method name, JSON args, attached deposit from chosen amount + storage bounds via `storage_balance_bounds`, gas)
   - `cancelSubscription` / `resumeSubscription` / `changePlan` → `wallet_intent`s (unlock / re-lock / update)
5. Register in `bos.config.json` under `plugins.stake2pay` (`development: "local:plugins/stake2pay"`).
6. Tests in `plugins/stake2pay/tests/{unit,integration}/`:
   - unit: fixture chain-JSON → schema mapping (statuses, yocto string amounts, missing fields)
   - integration: live read-only views against `hos-e2e-0601144939.testnet` (product `prod_5lklj46roIwKZK`, prices `price_RjiajH4KEZ43w68DgY5xVaVU` etc.)

### Acceptance Criteria
- [ ] Plugin runs standalone via `bun run dev` and lists the three testnet tiers with correct NEAR ranges
- [ ] `getSubscription` returns `status: "none"` for a fresh account and maps an existing testnet subscription correctly
- [ ] `createSubscription` returns a `wallet_intent` whose args a NEAR wallet can sign as-is (verified manually once against testnet)
- [ ] RPC timeouts/failures surface as typed oRPC errors, not hangs
- [ ] `bun run test`, `bun typecheck`, `bun lint` pass

### Notes
- [ ] Reference for chain shapes: `staking-contract/docs/API.md` on the `feat/stake-dao` branch of nearai/house-of-stake-contracts, and the Rust mapping in chat-api's `near_staking.rs`.
- [ ] The testnet contract is an ephemeral e2e instance — pin its id in test config and expect to swap it.
- [ ] Cache catalog views in-memory (~60s TTL) to keep `listPlans` snappy; never cache `getSubscription`.
