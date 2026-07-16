import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPIHandler } from "@orpc/openapi/node";
import { RPCHandler } from "@orpc/server/node";
import { createPluginRuntime, type PluginConfigInput } from "every-plugin";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import PingPayPlugin from "../../../plugins/pingpay/src/index";
import Stake2PayPlugin from "../../../plugins/stake2pay/src/index";
import StripePlugin from "../../../plugins/stripe/src/index";
import type { contract } from "../../src/contract";
import ApiPlugin from "../../src/index";

/**
 * E2E suite for the stake2pay provider through the aggregator API.
 *
 * Registers the REAL stake2pay plugin next to the payment-only providers
 * (pingpay + stripe), mirroring bos.config.json, and exercises the generic
 * subscription routes end to end. Two paths:
 *
 *   1. Mocked-RPC (always runs, no network): the plugin's `rpcUrl` points at a
 *      local node:http server speaking the NEAR JSON-RPC `query`/`call_function`
 *      protocol, serving canned chain fixtures per method_name. This drives the
 *      status transitions the live contract can't produce on demand
 *      (active → cancel_at_period_end → pending_unstake → ended).
 *
 *   2. Live read-only (opt-in): runs against the plugin's default config —
 *      `hos-e2e-0601144939.testnet` — and is gated behind HOS_TESTNET so an
 *      ephemeral testnet contract can never break CI:
 *
 *        HOS_TESTNET=1 bun run test tests/integration/e2e-stake2pay.test.ts
 *
 * The wallet-signing step (actually locking NEAR) stays manual — see
 * docs/004-05-e2e-hos-testnet-docs.md for the one-time checklist.
 */

const PROVIDER = "stake2pay";
const WALLET_HEADER = "x-test-wallet-address";
const SESSION_WALLET = "alice.testnet";

const RPC_PREFIX = "/api/rpc";
const API_PREFIX = "/api";

const CONTRACT_ID = "hos-e2e-0601144939.testnet";
const PRODUCT_ID = "prod_5lklj46roIwKZK";
const STARTER_PRICE_ID = "price_RjiajH4KEZ43w68DgY5xVaVU";
const BASIC_PRICE_ID = "price_h577VYQUEynPA3uQt1u1neGn";

const YOCTO_1_NEAR = "1000000000000000000000000";
const YOCTO_5_NEAR = "5000000000000000000000000";
const YOCTO_10_NEAR = "10000000000000000000000000";
const YOCTO_40_NEAR = "40000000000000000000000000";

const NOW_MS = Date.now();
const FUTURE_END_NS = String(BigInt(NOW_MS + 30 * 24 * 3600 * 1000) * 1_000_000n);
const PAST_END_NS = String(BigInt(NOW_MS - 24 * 3600 * 1000) * 1_000_000n);

// Chain fixtures — same shapes the House of Stake contract returns from view
// calls (see plugins/stake2pay/tests/unit/service.test.ts).
const starterPrice = {
  price_id: STARTER_PRICE_ID,
  product_id: PRODUCT_ID,
  name: "Starter",
  description: "1 agent; stake range [1, 10] NEAR",
  amount: YOCTO_1_NEAR,
  price_type: "Recurring",
  billing_period: "Monthly",
  lock_factor_near_months: YOCTO_1_NEAR,
  metadata: { max_amount: YOCTO_10_NEAR, farm_reward_rate: null },
  status: "Active",
  usage_count: 11,
};

const basicPrice = {
  ...starterPrice,
  price_id: BASIC_PRICE_ID,
  name: "Basic",
  amount: YOCTO_10_NEAR,
  metadata: { max_amount: YOCTO_40_NEAR, farm_reward_rate: null },
};

const oneOffPrice = {
  ...starterPrice,
  price_id: "price_oneoff",
  name: "Credits",
  price_type: "OneOff",
  billing_period: null,
  metadata: null,
};

const archivedPrice = {
  ...starterPrice,
  price_id: "price_archived",
  status: "Archived",
};

const priceTable: Record<string, unknown> = {
  [STARTER_PRICE_ID]: starterPrice,
  [BASIC_PRICE_ID]: basicPrice,
  price_oneoff: oneOffPrice,
  price_archived: archivedPrice,
};

const product = {
  product_id: PRODUCT_ID,
  validator_id: `mock-pool-0.${CONTRACT_ID}`,
  name: "NEAR AI Agents",
  description: "Monthly agent hosting subscription tiers",
  status: "Active",
  created_ns: "1780305858303142485",
  price_ids: [STARTER_PRICE_ID, BASIC_PRICE_ID, "price_oneoff", "price_archived"],
  default_price_id: STARTER_PRICE_ID,
  usage_count: 25,
};

const chainConfig = {
  owner_account_id: CONTRACT_ID,
  min_storage_deposit: "10000000000000000000000",
  per_lock_storage_stake: "0",
  per_purchase_storage_stake: "0",
  min_lock_amount: YOCTO_1_NEAR,
};

const activeSubscription = {
  subscription_id: "sub_abc",
  account_id: SESSION_WALLET,
  product_id: PRODUCT_ID,
  price_id: STARTER_PRICE_ID,
  start_ns: "1780305858303142485",
  end_ns: FUTURE_END_NS,
  anchor_day: 1,
  last_lock_id: "lock_1",
  status: "Active",
  cancel_at_period_end: false,
  pending_update: null,
};

const activeLock = {
  lock_id: "lock_1",
  account_id: SESSION_WALLET,
  validator_id: `mock-pool-0.${CONTRACT_ID}`,
  amount_near: YOCTO_5_NEAR,
  shares: "123",
  start_ns: "1780305858303142485",
  end_ns: FUTURE_END_NS,
  status: "Active",
};

// Mutable chain state — tests overwrite these between subscriptionGet calls to
// drive the lifecycle transitions the live testnet can't produce on demand.
const chainState: {
  subscription: Record<string, unknown> | null;
  lock: Record<string, unknown> | null;
} = { subscription: null, lock: null };

const rpcFixtures: Record<string, (args: Record<string, unknown>) => unknown> = {
  get_product: () => product,
  get_price: (args) => priceTable[args.price_id as string] ?? null,
  get_config: () => chainConfig,
  get_subscription_for_price: (args) =>
    args.account_id === SESSION_WALLET ? chainState.subscription : null,
  get_lock: () => chainState.lock,
  storage_balance_of: () => null,
};

/**
 * Minimal NEAR JSON-RPC node: answers `query`/`call_function` requests the way
 * a real RPC endpoint does — the view result is a byte array of JSON (see
 * plugins/stake2pay/src/client.ts for the wire format the plugin speaks).
 */
async function startMockNearRpc(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const respond = (payload: Record<string, unknown>) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(payload));
      };

      try {
        const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const { request_type, method_name, args_base64 } = request.params ?? {};
        if (request.method !== "query" || request_type !== "call_function") {
          respond({
            jsonrpc: "2.0",
            id: request.id,
            error: { name: "REQUEST_VALIDATION_ERROR", message: "unsupported request" },
          });
          return;
        }

        const args = JSON.parse(Buffer.from(args_base64, "base64").toString("utf8"));
        const fixture = rpcFixtures[method_name];
        if (!fixture) {
          respond({
            jsonrpc: "2.0",
            id: request.id,
            result: { error: `MethodResolveError: ${method_name}` },
          });
          return;
        }

        respond({
          jsonrpc: "2.0",
          id: request.id,
          result: { result: Array.from(Buffer.from(JSON.stringify(fixture(args)))) },
        });
      } catch (error) {
        respond({
          jsonrpc: "2.0",
          id: null,
          error: { name: "PARSE_ERROR", message: String(error) },
        });
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

const PINGPAY_CONFIG = {
  variables: {
    baseUrl: "https://pay.pingpay.io",
    recipientAddress: "test-recipient.near",
  },
  secrets: {
    PING_API_KEY: "test_e2e_api_key",
    PING_WEBHOOK_SECRET: "test_webhook_secret",
  },
} satisfies PluginConfigInput<typeof PingPayPlugin>;

const STRIPE_CONFIG = {
  variables: {},
  secrets: {
    STRIPE_SECRET_KEY: "sk_test_e2e_fake_key",
    STRIPE_WEBHOOK_SECRET: "test_webhook_secret",
  },
} satisfies PluginConfigInput<typeof StripePlugin>;

type ApiClient = ContractRouterClient<typeof contract>;

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
 * Same harness as e2e-subscriptions.test.ts: real plugin runtime, real HTTP
 * server, typed oRPC client, walletAddress injected from a test header the way
 * the host's session middleware injects it from better-near-auth. Copy this
 * (plus a provider config) for future subscription providers.
 */
async function createStake2PayE2EContext(
  stake2payVariables: PluginConfigInput<typeof Stake2PayPlugin>["variables"],
) {
  const runtime = createPluginRuntime({
    registry: {
      api: { module: ApiPlugin, description: "Aggregator API under test" },
      pingpay: { module: PingPayPlugin, description: "Payment-only provider" },
      stripe: { module: StripePlugin, description: "Payment-only provider" },
      stake2pay: { module: Stake2PayPlugin, description: "Stake2Pay provider under test" },
    },
    secrets: {},
  });

  const pingpay = await runtime.usePlugin("pingpay", PINGPAY_CONFIG);
  const stripe = await runtime.usePlugin("stripe", STRIPE_CONFIG);
  const stake2pay = await runtime.usePlugin("stake2pay", {
    variables: stake2payVariables,
    secrets: {},
  });

  // Isolated throwaway pglite dir — `pglite:.bos/api/:memory:` is a shared
  // on-disk path, not in-memory, and parallel vitest forks race on it.
  const databaseDir = `.bos/api-e2e-test-${randomUUID()}`;

  const api = await runtime.usePlugin(
    "api",
    {
      variables: {},
      secrets: { API_DATABASE_URL: `pglite:${databaseDir}/data` },
    },
    {
      pingpay: pingpay.createClient,
      stripe: stripe.createClient,
      stake2pay: stake2pay.createClient,
    },
  );

  const router = api.router as any;
  const rpcHandler = new RPCHandler(router);
  const openApiHandler = new OpenAPIHandler(router);

  const server: Server = createServer(async (req, res) => {
    const walletAddress = req.headers[WALLET_HEADER];
    const context = {
      reqHeaders: toWebHeaders(req),
      ...(typeof walletAddress === "string" ? { walletAddress } : {}),
    };

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

  const anonClient: ApiClient = createORPCClient(
    new RPCLink({ url: `${baseUrl}${RPC_PREFIX}`, fetch: globalThis.fetch }),
  );
  const authedClient: ApiClient = createORPCClient(
    new RPCLink({
      url: `${baseUrl}${RPC_PREFIX}`,
      fetch: globalThis.fetch,
      headers: { [WALLET_HEADER]: SESSION_WALLET },
    }),
  );

  const teardown = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await runtime.shutdown();
    await rm(databaseDir, { recursive: true, force: true });
  };

  return { anonClient, authedClient, baseUrl, teardown };
}

type Stake2PayE2EContext = Awaited<ReturnType<typeof createStake2PayE2EContext>>;

describe("E2E: stake2pay through the aggregator API (mocked NEAR RPC)", () => {
  let ctx: Stake2PayE2EContext;
  let rpc: Awaited<ReturnType<typeof startMockNearRpc>>;

  beforeAll(async () => {
    rpc = await startMockNearRpc();
    ctx = await createStake2PayE2EContext({
      rpcUrl: rpc.url,
      networkId: "testnet",
      contractId: CONTRACT_ID,
      productId: PRODUCT_ID,
    });
  }, 120_000);

  afterAll(async () => {
    await ctx?.teardown();
    await rpc?.close();
  });

  it("lists stake2pay in subscription provider discovery, skipping payment-only plugins", async () => {
    const providers = await ctx.anonClient.subscriptionProviders();

    const stake2pay = providers.find((p) => p.key === PROVIDER);
    expect(stake2pay).toBeDefined();
    expect(stake2pay?.name).toBe("Stake2Pay");
    expect(stake2pay?.logo).toContain("stake2pay");
    expect(stake2pay?.description).toBeTruthy();
    expect(providers.some((p) => p.key === "pingpay")).toBe(false);
    expect(providers.some((p) => p.key === "stripe")).toBe(true);
  });

  it("lists only active recurring tiers as NEAR range plans", async () => {
    const plans = await ctx.anonClient.subscriptionPlans({ provider: PROVIDER });

    expect(plans.map((p) => p.id)).toEqual([STARTER_PRICE_ID, BASIC_PRICE_ID]);
    for (const plan of plans) {
      expect(plan.currency).toBe("NEAR");
      expect(plan.period).toBe("monthly");
      expect(BigInt(plan.minAmount) <= BigInt(plan.maxAmount)).toBe(true);
    }
    expect(plans[0]).toMatchObject({
      name: "Starter",
      minAmount: YOCTO_1_NEAR,
      maxAmount: YOCTO_10_NEAR,
    });
  });

  it("serves plans over the OpenAPI route GET /subscriptions/stake2pay/plans", async () => {
    const response = await fetch(`${ctx.baseUrl}${API_PREFIX}/subscriptions/${PROVIDER}/plans`);

    expect(response.status).toBe(200);
    const plans = (await response.json()) as Array<{ id: string }>;
    expect(plans.map((p) => p.id)).toEqual([STARTER_PRICE_ID, BASIC_PRICE_ID]);
  });

  it("returns a wallet_intent ending in a lock call with the requested deposit", async () => {
    const action = await ctx.authedClient.subscriptionCreate({
      provider: PROVIDER,
      planId: STARTER_PRICE_ID,
      amount: YOCTO_5_NEAR,
    });

    expect(action.kind).toBe("wallet_intent");
    if (action.kind !== "wallet_intent") return;
    expect(action.networkId).toBe("testnet");
    expect(action.contractId).toBe(CONTRACT_ID);
    // Unregistered payer → storage_deposit precedes the lock.
    expect(action.actions).toHaveLength(2);
    expect(action.actions[0]).toMatchObject({
      methodName: "storage_deposit",
      args: { account_id: SESSION_WALLET },
      deposit: chainConfig.min_storage_deposit,
    });
    const lock = action.actions.at(-1);
    expect(lock).toMatchObject({
      methodName: "lock",
      args: { price_id: STARTER_PRICE_ID, duration_ns: null },
      deposit: YOCTO_5_NEAR,
    });
  });

  it("rejects a stake amount outside the plan range with BAD_REQUEST", async () => {
    await expect(
      ctx.authedClient.subscriptionCreate({
        provider: PROVIDER,
        planId: STARTER_PRICE_ID,
        amount: YOCTO_40_NEAR,
      }),
    ).rejects.toThrow(/outside plan range|BAD_REQUEST/);
  });

  it("returns NOT_FOUND for an unknown subscription provider", async () => {
    await expect(ctx.anonClient.subscriptionPlans({ provider: "nonexistent" })).rejects.toThrow(
      /Unknown subscription provider|NOT_FOUND/,
    );

    await expect(
      ctx.authedClient.subscriptionCreate({ provider: "nonexistent", planId: STARTER_PRICE_ID }),
    ).rejects.toThrow(/Unknown subscription provider|NOT_FOUND/);
  });

  it("returns status none for an account with no chain subscription", async () => {
    const subscription = await ctx.anonClient.subscriptionGet({
      provider: PROVIDER,
      planId: STARTER_PRICE_ID,
      payerRef: "fresh.testnet",
    });

    expect(subscription).toEqual({
      planId: STARTER_PRICE_ID,
      status: "none",
      payerRef: "fresh.testnet",
    });
  });

  it("maps an active chain subscription, defaulting payerRef from the session wallet", async () => {
    chainState.subscription = { ...activeSubscription };
    chainState.lock = { ...activeLock };

    const subscription = await ctx.authedClient.subscriptionGet({
      provider: PROVIDER,
      planId: STARTER_PRICE_ID,
    });

    expect(subscription.status).toBe("active");
    expect(subscription.id).toBe("sub_abc");
    expect(subscription.payerRef).toBe(SESSION_WALLET);
    expect(subscription.amount).toBe(YOCTO_5_NEAR);
    expect(subscription.currency).toBe("NEAR");
    expect(subscription.currentPeriodEnd).toBe(
      new Date(Number(BigInt(FUTURE_END_NS) / 1_000_000n)).toISOString(),
    );
  });

  it("transitions to cancel_at_period_end when the chain flags it", async () => {
    chainState.subscription = { ...activeSubscription, cancel_at_period_end: true };
    chainState.lock = { ...activeLock };

    const subscription = await ctx.authedClient.subscriptionGet({
      provider: PROVIDER,
      planId: STARTER_PRICE_ID,
    });

    expect(subscription.status).toBe("cancel_at_period_end");
  });

  it("transitions to pending_unstake once cancelled past period end with an unstaking lock", async () => {
    chainState.subscription = {
      ...activeSubscription,
      status: "Cancelled",
      end_ns: PAST_END_NS,
    };
    chainState.lock = { ...activeLock, status: "UnlockRequested" };

    const subscription = await ctx.authedClient.subscriptionGet({
      provider: PROVIDER,
      planId: STARTER_PRICE_ID,
    });

    expect(subscription.status).toBe("pending_unstake");
  });

  it("transitions to ended once the lock is withdrawn", async () => {
    chainState.subscription = {
      ...activeSubscription,
      status: "Cancelled",
      end_ns: PAST_END_NS,
    };
    chainState.lock = { ...activeLock, status: "Withdrawn" };

    const subscription = await ctx.authedClient.subscriptionGet({
      provider: PROVIDER,
      planId: STARTER_PRICE_ID,
    });

    expect(subscription.status).toBe("ended");
  });

  it("serves status transitions over the OpenAPI route with query params", async () => {
    chainState.subscription = { ...activeSubscription };
    chainState.lock = { ...activeLock };

    const response = await fetch(
      `${ctx.baseUrl}${API_PREFIX}/subscriptions/${PROVIDER}/status?planId=${STARTER_PRICE_ID}&payerRef=${SESSION_WALLET}`,
    );

    expect(response.status).toBe(200);
    const subscription = (await response.json()) as { status: string; payerRef: string };
    expect(subscription.status).toBe("active");
    expect(subscription.payerRef).toBe(SESSION_WALLET);
  });

  it("returns a 1-yocto cancel_subscription wallet_intent", async () => {
    chainState.subscription = { ...activeSubscription };
    chainState.lock = { ...activeLock };

    const action = await ctx.authedClient.subscriptionCancel({
      provider: PROVIDER,
      planId: STARTER_PRICE_ID,
    });

    expect(action.kind).toBe("wallet_intent");
    if (action.kind !== "wallet_intent") return;
    expect(action.contractId).toBe(CONTRACT_ID);
    expect(action.actions).toHaveLength(1);
    expect(action.actions[0]).toMatchObject({
      methodName: "cancel_subscription",
      args: { product_id: PRODUCT_ID },
      deposit: "1",
    });
  });
});

/**
 * Live read-only path against the House of Stake testnet deployment — the
 * stake2pay plugin's default config. Opt-in via HOS_TESTNET so the ephemeral
 * contract can never break CI:
 *
 *   HOS_TESTNET=1 bun run test tests/integration/e2e-stake2pay.test.ts
 */
describe.skipIf(!process.env.HOS_TESTNET)("E2E: stake2pay live against HoS testnet", () => {
  const UNKNOWN_ACCOUNT = "payment-agg-e2e-unknown.testnet";

  let ctx: Stake2PayE2EContext;

  beforeAll(async () => {
    ctx = await createStake2PayE2EContext({});
  }, 120_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  it("discovers stake2pay as a subscription provider", async () => {
    const providers = await ctx.anonClient.subscriptionProviders();
    expect(providers.some((p) => p.key === PROVIDER)).toBe(true);
  });

  it("lists the seeded testnet tiers as NEAR range plans", async () => {
    const plans = await ctx.anonClient.subscriptionPlans({ provider: PROVIDER });

    expect(plans.length).toBeGreaterThanOrEqual(3);
    for (const plan of plans) {
      expect(plan.currency).toBe("NEAR");
      expect(plan.period).toBe("monthly");
      expect(BigInt(plan.minAmount) <= BigInt(plan.maxAmount)).toBe(true);
    }
  });

  it("builds a signable lock intent for the cheapest tier", async () => {
    const plans = await ctx.anonClient.subscriptionPlans({ provider: PROVIDER });
    const plan = plans[0];
    if (!plan) throw new Error("expected at least one testnet plan");

    const action = await ctx.anonClient.subscriptionCreate({
      provider: PROVIDER,
      planId: plan.id,
      amount: plan.minAmount,
      payerRef: UNKNOWN_ACCOUNT,
    });

    expect(action.kind).toBe("wallet_intent");
    if (action.kind !== "wallet_intent") return;
    expect(action.networkId).toBe("testnet");
    expect(action.contractId).toBe(CONTRACT_ID);
    const lock = action.actions.at(-1);
    expect(lock).toMatchObject({
      methodName: "lock",
      args: { price_id: plan.id, duration_ns: null },
      deposit: plan.minAmount,
    });
  });

  it("returns status none for an account that never subscribed", async () => {
    const plans = await ctx.anonClient.subscriptionPlans({ provider: PROVIDER });
    const plan = plans[0];
    if (!plan) throw new Error("expected at least one testnet plan");

    const subscription = await ctx.anonClient.subscriptionGet({
      provider: PROVIDER,
      planId: plan.id,
      payerRef: UNKNOWN_ACCOUNT,
    });

    expect(subscription.status).toBe("none");
    expect(subscription.payerRef).toBe(UNKNOWN_ACCOUNT);
  });
});
