# pingpay

## 1.0.1

### Patch Changes

- 4c332cf: Fix type errors: stale imports, missing effect deps, and context schema cleanup.

  - api: consolidated stale `./db/load-migrations` and `./db/migrator` imports to `./db/migrate`; replaced inline context schema with `ContextSchema` from `lib/context`; switched `resolvePayerRef`/`requirePayerRef` from non-existent `walletAddress` to `context.near?.primaryAccountId`.
  - pingpay, stake2pay, stripe: added missing `effect` dependency (peer of `every-plugin`); added `context: ContextSchema` from `lib/context`.
