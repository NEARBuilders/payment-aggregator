# Epic 001: Extract Payment Plugins for Aggregation

### Context

The current `plugins/api` is a monolithic plugin containing Stripe and PingPay payment implementations as internal services. To build a payment aggregator, we extract these into standalone plugins under `plugins/pingpay/` and `plugins/stripe/` — each implementing a shared `PaymentContract` — then aggregate them in the API layer (`api/src/index.ts`) via `PluginsClient`. The extraction is a **copy** (old code stays intact). `PluginsClient` types will be regenerated later via `bos types gen`; type errors from missing generation are acceptable during development.

### Tickets

| # | Ticket | Dependency |
|---|--------|------------|
| 001-01 | Create PingPay Plugin (`plugins/pingpay/`) from template | — |
| 001-02 | Create Stripe Plugin (`plugins/stripe/`) from template | — |
| 001-03 | Aggregate payment plugins via API createRouter | 001-01, 001-02 |

### Acceptance Criteria
- [ ] Both payment plugins run standalone via `bun run dev`
- [ ] Both payment plugins pass `bun run test` with unit + integration coverage
- [ ] API aggregation correctly delegates to the correct plugin per provider route
- [ ] No changes to `plugins/api/` (extraction is a copy, not a move)
- [ ] `plugins-types.gen.ts` is left for later regeneration — type errors from missing entries are expected
- [ ] `bun typecheck` and `bun lint` pass for both plugins and the `api/` package
