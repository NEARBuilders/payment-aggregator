# 004-05: E2E Against HoS Testnet + Docs

Part of Epic 004 (#27). Depends on 004-02, 004-03.

### Context

Epic 002 established per-provider E2E suites (002-03 PingPay, 002-04 Stripe) as the template for future providers. Stake2pay gets the same: an end-to-end suite proving the full chain — API discovery → plans → intent → (simulated) chain state → status — plus the docs that keep `docs/` mirroring GitHub issues.

### Overview

1. E2E suite in `api/tests/integration/` (or `plugins/stake2pay/tests/integration/` per harness fit):
   - live read-only path against `hos-e2e-0601144939.testnet`: providers → plans → `createSubscription` intent shape → `getSubscription` for a known/unknown account
   - mocked-RPC path for state transitions we can't create on demand (active → cancel_at_period_end → pending_unstake → ended)
2. Wallet-signing step stays manual (documented script) — no funded testnet key in CI.
3. Docs: `docs/004-0X-*.md` ticket specs mirroring these issues (repo convention), README provider table row for stake2pay, `.env.example` note that stake2pay needs no secrets.
4. CI: live-testnet tests tagged/skippable (`describe.skipIf(!process.env.HOS_TESTNET)`) so an ephemeral contract can't break the suite.

### Files Created

| File | Purpose |
|------|---------|
| `api/tests/integration/e2e-stake2pay.test.ts` | Full stake2pay E2E through the aggregator: mocked-RPC path (always) + live testnet path (opt-in) |
| `docs/004-01` … `docs/004-06` | Ticket specs mirroring GitHub issues #28–#33 |

### Test Structure

The suite registers the REAL stake2pay plugin next to the payment-only providers (pingpay + stripe), mirroring `bos.config.json`, and drives the generic `/subscriptions/*` routes over a real `node:http` server — same harness shape as `e2e-subscriptions.test.ts`, with `walletAddress` injected from an `x-test-wallet-address` header the way the host's session middleware injects the better-near-auth NEAR account.

**Mocked-RPC path (runs everywhere, no network):** the plugin's `rpcUrl` variable points at a local `node:http` server speaking the NEAR JSON-RPC `query`/`call_function` protocol (byte-array-of-JSON results, exactly what `plugins/stake2pay/src/client.ts` expects). Canned fixtures per `method_name` (`get_product`, `get_price`, `get_config`, `get_subscription_for_price`, `get_lock`, `storage_balance_of`) plus a mutable chain-state object drive the lifecycle transitions the live contract can't produce on demand:

`active` → `cancel_at_period_end` (chain flags `cancel_at_period_end: true`) → `pending_unstake` (chain status `Cancelled`, lock `UnlockRequested`, past period end) → `ended` (lock `Withdrawn`)

Also covered: provider discovery skips payment-only plugins, OpenAPI (REST) routes, `cancel_subscription` 1-yocto intent, unknown provider → NOT_FOUND, out-of-range stake amount → BAD_REQUEST.

**Live read-only path (opt-in):** runs the plugin with its default config against `hos-e2e-0601144939.testnet`; asserts the seeded tiers (≥3, currency NEAR, `minAmount` ≤ `maxAmount`), a signable `lock` intent (`{price_id, duration_ns: null}`, deposit == requested amount), and `status: "none"` for an account that never subscribed. Gated with `describe.skipIf(!process.env.HOS_TESTNET)` so the ephemeral testnet contract can never break CI:

```bash
cd api && HOS_TESTNET=1 bun run test tests/integration/e2e-stake2pay.test.ts
```

### Manual Wallet-Signing Checklist (one-time, testnet)

The E2E suites never sign transactions (no funded key in CI). A maintainer verifies the write half once per contract deployment:

1. Prerequisites: a funded testnet account (`<you>.testnet`) and `near` CLI logged in (`near login --networkId testnet`).
2. Get an intent from the running aggregator (or the live E2E output):
   ```bash
   curl -s -X POST "$API_URL/api/subscriptions/stake2pay" \
     -H 'content-type: application/json' \
     -d '{"planId":"<price_id>","amount":"<yocto>","payerRef":"<you>.testnet"}'
   ```
3. Sign each returned action in order with the intent's exact `args`, `deposit`, and `gas` (first `storage_deposit` if present, then `lock`):
   ```bash
   near call hos-e2e-0601144939.testnet storage_deposit \
     '{"account_id":"<you>.testnet"}' \
     --accountId <you>.testnet --depositYocto <deposit> --gas 30000000000000 --networkId testnet
   near call hos-e2e-0601144939.testnet lock \
     '{"price_id":"<price_id>","duration_ns":null}' \
     --accountId <you>.testnet --depositYocto <amount> --gas 250000000000000 --networkId testnet
   ```
4. Verify through the API:
   ```bash
   curl -s "$API_URL/api/subscriptions/stake2pay/status?planId=<price_id>&payerRef=<you>.testnet"
   # expect "status": "active"
   ```
5. Optionally round-trip cancel: `POST /api/subscriptions/stake2pay/cancel`, sign the returned 1-yocto `cancel_subscription` call, and confirm status flips to `cancel_at_period_end`.

### Acceptance Criteria
- [ ] Full-chain E2E passes locally against testnet; mocked suite passes in CI without network
- [ ] A future provider can copy the suite structure the way 002-03/002-04 are copied today
- [ ] `docs/` mirrors the Epic 004 issues; README lists stake2pay with its config
- [ ] `bun run test`, `bun typecheck`, `bun lint` pass

### Notes
- [ ] If the testnet contract disappears, redeploy via `scripts/deploy_testnet_staking_stack.sh` on the `feat/stake-dao` branch of nearai/house-of-stake-contracts and update the pinned id in test config.
- [ ] `pglite:.bos/api/:memory:` is not in-memory — it is an on-disk path shared across vitest forks. E2E contexts create an isolated throwaway pglite directory per run and remove it on teardown.
