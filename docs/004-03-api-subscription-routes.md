# 004-03: API Generic Subscription Routes + Provider Discovery

Part of Epic 004 (#27). Depends on 004-01.

### Context

Epic 002 gave one-time payments 4 generic routes with dynamic provider lookup. Subscriptions get the same treatment: a parallel set of provider-agnostic routes in `api/src/contract.ts` + `api/src/index.ts`, so adding a subscription provider is config-only (proven when 004-06 lands Stripe with zero api/ changes).

### Overview

1. New contract routes (mirroring the `payment*` set):
   - `subscriptionProviders` — `GET /subscriptions/providers` — discovery: probe each registered plugin for `SubscriptionContract` support (e.g. attempt `listPlans` capability the way `paymentProviders` probes `metadata`; skip non-implementers)
   - `subscriptionPlans` — `GET /subscriptions/{provider}/plans`
   - `subscriptionCreate` — `POST /subscriptions/{provider}` → `SubscriptionAction`
   - `subscriptionGet` — `GET /subscriptions/{provider}?planId=&payerRef=`
   - `subscriptionCancel` / `subscriptionResume` / `subscriptionChange` — `POST /subscriptions/{provider}/(cancel|resume|change)`
2. Implement in `createRouter` via the same `getPaymentPlugin`-style dynamic factory lookup — zero hardcoded provider names in `api/src/`.
3. When the caller is signed in with NEAR (better-near-auth), default `payerRef` to the session's NEAR account id; explicit input overrides.
4. Regenerate `plugins-types.gen.ts` / `api-types.gen.ts` (`bos types gen`) after contract changes.
5. API integration tests in `api/tests/`: discovery excludes one-time-only providers, route delegation, unknown-provider 404, payerRef defaulting.

### Acceptance Criteria
- [ ] `GET /subscriptions/providers` lists stake2pay (and later stripe) without api/ code changes per provider
- [ ] All 7 routes delegate to the right plugin; unknown provider → NOT_FOUND
- [ ] No `stake2pay`/`stripe` literals in `api/src/`
- [ ] Existing `payment*` routes untouched (Epic 002/003 tests still green)
- [ ] `bun run test`, `bun typecheck`, `bun lint` pass

### Notes
- [ ] Discovery must not hard-fail when a plugin implements only `PaymentContract` — catch and skip, same as the empty-catch pattern in `paymentProviders`.
