# 004-04: Subscriptions UI (Plans → Wallet Sign → Status)

Part of Epic 004 (#27). Depends on 004-02, 004-03.

### Context

The `/payments` page renders provider cards and a checkout → session → webhook test flow for one-time payments. Subscriptions need their own page with a fundamentally different completion path: instead of redirecting to a hosted checkout, the stake2pay flow signs a NEAR transaction in the browser (near-kit) and then polls subscription status until the chain reflects it. Stripe's path (004-06) redirects like the classic flow.

### Overview

1. New route `ui/src/routes/subscriptions.tsx` (TanStack file-based, auth-gated like `/payments`).
2. Provider cards from `subscriptionProviders`; per provider, plan cards from `subscriptionPlans` — showing period, NEAR range (or fixed price), and a stake-amount input for range plans (validated against min/max).
3. Subscribe flow by `SubscriptionAction.kind`:
   - `wallet_intent`: sign via near-kit with the intent's `contractId`/`methodName`/`args`/`deposit`/`gas`; then poll `subscriptionGet` (e.g. 3s interval, 2min cap) until status is `active`
   - `redirect`: `window.location` to the URL (Stripe Checkout)
4. Status panel: current subscription per plan (status, period end, locked amount) with cancel / resume / change-plan actions — each again dispatching on the returned action kind.
5. Semantic Tailwind only, kebab-case component filenames, patterns copied from `payments.tsx` (react-query + `useApiClient()`).

### Acceptance Criteria
- [ ] Signed-in user with a NEAR wallet completes: pick tier → enter stake amount → sign on testnet → status flips to `active` without a manual refresh
- [ ] `pending_unstake` / `cancel_at_period_end` states render distinctly after cancel
- [ ] Range validation blocks amounts outside the plan's min/max before the wallet opens
- [ ] Page works with zero subscription providers registered (empty state)
- [ ] `bun typecheck` and `bun lint` pass

### Notes
- [ ] better-near-auth session already exposes the NEAR account — use it as `payerRef` and for the wallet connection; no separate wallet-connect UI.
- [ ] Keep the polling helper generic; it becomes the pattern for any pull-verified provider.
