<div align="center">

<h1 style="font-size: 4.25rem; font-weight: 800; line-height: 1; margin: 0;">pay.everything.dev</h1>

Payment aggregator — unified payment routing for Stripe, PingPay, and more.

</div>

## Overview

A payment aggregator that routes checkout sessions, webhooks, and session queries to the correct payment provider through a shared contract. Add a provider by implementing the `PaymentContract` — four typed endpoints — and registering it in config. The API layer composes them at runtime via `PluginsClient`.

Built on [everything-dev](https://everything.dev) runtime, [every-plugin](https://plugin.everything.dev/), [oRPC](https://orpc.dev/), and [Effect-TS](https://effect.website/).

## Payment Providers

| Plugin | Provider | Routes |
|--------|----------|--------|
| `stripe` | Stripe | `plugins/stripe/` |
| `pingpay` | PingPay (NEAR USDC) | `plugins/pingpay/` |
| `stake2pay` | Stake2Pay (NEAR staking subscriptions via House of Stake) | `plugins/stake2pay/` |

Each provider implements the same `PaymentContract`:

| Procedure | Method | Path | Description |
|-----------|--------|------|-------------|
| `ping` | GET | `/ping` | Health check, returns provider name |
| `createCheckout` | POST | `/checkout` | Create a payment checkout session |
| `verifyWebhook` | POST | `/webhook` | Verify signature and parse webhook event |
| `getSession` | GET | `/sessions/{id}` | Retrieve session status and details |

## API

The API layer aggregates provider routes:

| Endpoint | Delegates to |
|----------|-------------|
| `GET /api/ping` | API health check |
| `GET /api/payments/stripe/ping` | Stripe plugin |
| `POST /api/payments/stripe/checkout` | Stripe plugin |
| `POST /api/payments/stripe/webhook` | Stripe plugin |
| `GET /api/payments/stripe/sessions/{id}` | Stripe plugin |
| `GET /api/payments/pingpay/ping` | PingPay plugin |
| `POST /api/payments/pingpay/checkout` | PingPay plugin |
| `POST /api/payments/pingpay/webhook` | PingPay plugin |
| `GET /api/payments/pingpay/sessions/{id}` | PingPay plugin |

## Quick Start

```bash
cp .env.example .env
bun install
bun run dev
```

Secrets per provider:

| Variable | Provider |
|----------|----------|
| `STRIPE_SECRET_KEY` | Stripe |
| `STRIPE_WEBHOOK_SECRET` | Stripe |
| `PING_API_KEY` | PingPay |
| `PING_WEBHOOK_SECRET` | PingPay |
| `API_DATABASE_URL` | Core API |

`stake2pay` needs no secrets — it only performs read-only NEAR view calls and the user's wallet signs all writes. It is configured via `bos.config.json` variables:

| Variable | Default |
|----------|---------|
| `rpcUrl` | `https://test.rpc.fastnear.com` |
| `networkId` | `testnet` |
| `contractId` | `hos-e2e-0601144939.testnet` |
| `productId` | `prod_5lklj46roIwKZK` |

## Architecture

```
                          POST /api/payments/stripe/checkout
                                       │
┌──────────────────────────────────────┼───────────────────────────┐
│                          api/ (Aggregator)                       │
│                    createPlugin.withPlugins()                    │
│                                                                  │
│  ┌─────────────────────┐          ┌──────────────────────┐      │
│  │   PluginsClient     │          │  oRPC createRouter   │      │
│  │                     │          │                      │      │
│  │  stripe() ──────────┼──────────┼─► stripeCreateCheckout      │
│  │  pingpay() ─────────┼──────────┼─► pingpayCreateCheckout     │
│  └────────┬────────────┘          └──────────────────────┘      │
│           │                                                      │
└───────────┼──────────────────────────────────────────────────────┘
            │
    ┌───────┴────────┐
    │                │
    ▼                ▼
┌─────────┐    ┌──────────┐
│ stripe  │    │ pingpay  │    ← each implements PaymentContract
│ plugin  │    │ plugin   │
└────┬─────┘    └────┬─────┘
     │               │
     ▼               ▼
  Stripe API    PingPay API
```

## Use in Your Own App

```bash
npm install @pay.everything/client
```

```ts
import { createPayClient } from "@pay.everything/client";

const pay = createPayClient("https://your-api.com");

const checkout = await pay.paymentCheckout({
  provider: "stripe",
  orderId: "order_123",
  amount: 1999,
  currency: "USD",
  successUrl: "https://myapp.com/success",
  cancelUrl: "https://myapp.com/cancel",
  items: [{ name: "Widget", unitAmount: 1999, quantity: 1 }],
});
```

### Integration paths

| Path | Best for |
|------|----------|
| **`@pay.everything/client`** | TypeScript apps — fully typed oRPC client |
| **HTTP / REST** | Any stack — documented endpoints |
| **everything-dev bos.config.json** | BOS ecosystem apps — drop in |

### Deploy your own

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/everything-dev-template?referralCode=MuB_vg&utm_medium=integration&utm_source=template&utm_campaign=generic)

See **[docs/integration.md](./docs/integration.md)** for the full guide — curl examples, React snippets, subscription flows, and type reference.

## Development

```bash
bun run dev        # Start dev server (API + UI + plugins)
bun typecheck      # Type check all packages
bun run test       # Run all tests
```

Tests per plugin:
```bash
cd plugins/stripe && bun run test
cd plugins/pingpay && bun run test
```

## Docs

- **[docs/epics/001-payment-plugin-extraction.md](./docs/epics/001-payment-plugin-extraction.md)** — Extraction plan
- **[docs/001-01-pingpay-plugin.md](./docs/001-01-pingpay-plugin.md)** — PingPay plugin ticket
- **[docs/001-02-stripe-plugin.md](./docs/001-02-stripe-plugin.md)** — Stripe plugin ticket
- **[docs/001-03-api-aggregation.md](./docs/001-03-api-aggregation.md)** — API aggregation ticket
- **[AGENTS.md](./AGENTS.md)** — Agent instructions

## License

MIT
