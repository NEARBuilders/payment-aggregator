import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPIHandler } from "@orpc/openapi/node";
import { RPCHandler } from "@orpc/server/node";
import { createPluginRuntime, type PluginConfigInput } from "every-plugin";
import PingPayPlugin from "../../../plugins/pingpay/src/index";
import StripePlugin from "../../../plugins/stripe/src/index";
import type { contract } from "../../src/contract";
import ApiPlugin from "../../src/index";

/**
 * Shared E2E test harness for the payment aggregator API.
 *
 * Spins up the real aggregator API plugin with BOTH payment provider plugins
 * (pingpay + stripe) registered — matching `bos.config.json` — and serves the
 * router over a real `node:http` server, mirroring how the production host
 * mounts it:
 *
 *   - oRPC RPC protocol at    `{baseUrl}/api/rpc`
 *   - OpenAPI (REST) routes at `{baseUrl}/api` (e.g. POST /api/payments/webhook/{provider})
 *
 * Provider-specific test suites (e2e-pingpay, e2e-stripe) share this file
 * verbatim and only differ in the `provider` string and provider-specific
 * payloads/signatures in their test cases.
 */

/**
 * Webhook signing secret configured for every provider plugin in the harness.
 * Test cases compute their provider's signature scheme over this secret.
 */
export const TEST_WEBHOOK_SECRET = "test_webhook_secret";

/** RPC protocol endpoint prefix (oRPC client traffic). */
export const RPC_PREFIX = "/api/rpc";

/** OpenAPI (REST) endpoint prefix (raw HTTP traffic, e.g. provider webhooks). */
export const API_PREFIX = "/api";

const TEST_REGISTRY = {
  api: { module: ApiPlugin, description: "Aggregator API under test" },
  pingpay: { module: PingPayPlugin, description: "PingPay E2E test plugin" },
  stripe: { module: StripePlugin, description: "Stripe E2E test plugin" },
} as const;

const PINGPAY_CONFIG = {
  variables: {
    baseUrl: "https://pay.pingpay.io",
    recipientAddress: "test-recipient.near",
  },
  secrets: {
    // A `test_`-prefixed key keeps the PingPay client in mock/test mode.
    PING_API_KEY: "test_e2e_api_key",
    PING_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
  },
} satisfies PluginConfigInput<typeof PingPayPlugin>;

const STRIPE_CONFIG = {
  variables: {},
  secrets: {
    // Fake credentials — the Stripe SDK only hits the network when a call is made.
    STRIPE_SECRET_KEY: "sk_test_e2e_fake_key",
    STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
  },
} satisfies PluginConfigInput<typeof StripePlugin>;

// NOTE: `pglite:.bos/api/:memory:` is NOT in-memory — pglite treats it as an
// on-disk path, and parallel vitest forks race on a shared directory. Each
// context therefore gets its own throwaway directory, removed on teardown.
const apiConfig = (databaseDir: string) =>
  ({
    variables: {},
    secrets: {
      // Isolated pglite database; migrations run during plugin initialize.
      API_DATABASE_URL: `pglite:${databaseDir}/data`,
    },
  }) satisfies PluginConfigInput<typeof ApiPlugin>;

export type ApiClient = ContractRouterClient<typeof contract>;

function toWebHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") {
      headers.set(key, value);
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
    }
  }
  return headers;
}

/**
 * Creates a fully-wired E2E context:
 *
 *   - plugin runtime with pingpay, stripe and the aggregator api registered
 *   - real HTTP server on a random port (127.0.0.1)
 *   - typed oRPC client pointed at the RPC endpoint
 *
 * Callers must invoke `teardown()` when done (closes the server, shuts down
 * the plugin runtime, and removes the throwaway pglite directory).
 */
export async function createE2EContext() {
  const runtime = createPluginRuntime({
    registry: TEST_REGISTRY,
    secrets: {},
  });

  const pingpay = await runtime.usePlugin("pingpay", PINGPAY_CONFIG);
  const stripe = await runtime.usePlugin("stripe", STRIPE_CONFIG);

  const databaseDir = `.bos/api-e2e-test-${randomUUID()}`;

  // The aggregator API receives provider client factories, exactly like the
  // production host wires them from bos.config.json.
  const api = await runtime.usePlugin("api", apiConfig(databaseDir), {
    pingpay: pingpay.createClient,
    stripe: stripe.createClient,
  });

  const router = api.router as any;
  const rpcHandler = new RPCHandler(router);
  const openApiHandler = new OpenAPIHandler(router);

  const server = createServer(async (req, res) => {
    const context = { reqHeaders: toWebHeaders(req) };

    try {
      if (req.url?.startsWith(RPC_PREFIX)) {
        const { matched } = await rpcHandler.handle(req, res, {
          prefix: RPC_PREFIX,
          context,
        });
        if (matched) return;
      } else if (req.url?.startsWith(API_PREFIX)) {
        const { matched } = await openApiHandler.handle(req, res, {
          prefix: API_PREFIX,
          context,
        });
        if (matched) return;
      }

      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Route not found" }));
    } catch (error) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
      }
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  const link = new RPCLink({
    url: `${baseUrl}${RPC_PREFIX}`,
    fetch: globalThis.fetch,
  });
  const client: ApiClient = createORPCClient(link);

  const teardown = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await runtime.shutdown();
    await rm(databaseDir, { recursive: true, force: true });
  };

  return { client, baseUrl, runtime, teardown };
}

export type E2EContext = Awaited<ReturnType<typeof createE2EContext>>;
