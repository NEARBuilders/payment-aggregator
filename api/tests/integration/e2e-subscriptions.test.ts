import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPIHandler } from "@orpc/openapi/node";
import { RPCHandler } from "@orpc/server/node";
import { createPlugin, createPluginRuntime, type PluginConfigInput } from "every-plugin";
import { Effect } from "every-plugin/effect";
import { z } from "every-plugin/zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import PingPayPlugin from "../../../plugins/pingpay/src/index";
import { SubscriptionContract } from "../../../plugins/stake2pay/src/contract";
import StripePlugin from "../../../plugins/stripe/src/index";
import type { contract } from "../../src/contract";
import ApiPlugin from "../../src/index";

/**
 * E2E harness for the generic subscription routes.
 *
 * Registers the two real payment-only provider plugins (pingpay + stripe, which
 * do NOT implement the SubscriptionContract) alongside a minimal in-test fake
 * subscription plugin, proving:
 *
 *   - discovery probes `listPlans` and skips payment-only providers
 *   - all subscription routes delegate dynamically to the right plugin
 *   - payerRef defaults to the session's NEAR account (context.near.primaryAccountId,
 *     injected here from the `x-test-near-account-id` header exactly like the
 *     host's session middleware injects it from better-near-auth)
 */

const SUBS_PROVIDER = "subsmock";
const NEAR_ACCOUNT_HEADER = "x-test-near-account-id";
const SESSION_NEAR_ACCOUNT_ID = "alice.near";

const FAKE_PLANS = [
  {
    id: "plan-basic",
    name: "Basic",
    description: "Basic monthly staking plan",
    period: "monthly" as const,
    currency: "NEAR",
    minAmount: "1000000000000000000000000",
    maxAmount: "5000000000000000000000000",
  },
  {
    id: "plan-pro",
    name: "Pro",
    period: "monthly" as const,
    currency: "NEAR",
    minAmount: "5000000000000000000000000",
    maxAmount: "10000000000000000000000000",
  },
];

const FakeSubscriptionPlugin = createPlugin({
  variables: z.object({}),
  secrets: z.object({}),

  contract: SubscriptionContract,

  initialize: () => Effect.succeed({}),

  shutdown: () => Effect.void,

  createRouter: (_services, builder) => ({
    metadata: builder.metadata.handler(async () => ({
      name: "Subs Mock",
      logo: "/logos/subsmock.png",
      description: "In-test subscription provider",
    })),

    ping: builder.ping.handler(async () => ({
      provider: SUBS_PROVIDER,
      status: "ok" as const,
      timestamp: new Date().toISOString(),
    })),

    listPlans: builder.listPlans.handler(async () => FAKE_PLANS),

    createSubscription: builder.createSubscription.handler(async ({ input }) =>
      input.payerRef
        ? {
            kind: "executed" as const,
            subscription: {
              planId: input.planId,
              status: "active" as const,
              payerRef: input.payerRef,
            },
          }
        : {
            kind: "redirect" as const,
            url: "https://checkout.example.com/subscribe",
          },
    ),

    getSubscription: builder.getSubscription.handler(async ({ input }) => ({
      planId: input.planId,
      status: "active" as const,
      payerRef: input.payerRef,
    })),

    cancelSubscription: builder.cancelSubscription.handler(async ({ input }) => ({
      kind: "executed" as const,
      subscription: {
        planId: input.planId,
        status: "cancel_at_period_end" as const,
        payerRef: input.payerRef,
      },
    })),

    resumeSubscription: builder.resumeSubscription.handler(async ({ input }) => ({
      kind: "executed" as const,
      subscription: {
        planId: input.planId,
        status: "active" as const,
        payerRef: input.payerRef,
      },
    })),

    changePlan: builder.changePlan.handler(async ({ input }) => ({
      kind: "executed" as const,
      subscription: {
        planId: input.newPlanId,
        status: "active" as const,
        payerRef: input.payerRef,
      },
    })),
  }),
});

const TEST_REGISTRY = {
  api: { module: ApiPlugin, description: "Aggregator API under test" },
  pingpay: { module: PingPayPlugin, description: "Payment-only provider (no subscriptions)" },
  stripe: { module: StripePlugin, description: "Payment-only provider (no subscriptions)" },
  [SUBS_PROVIDER]: { module: FakeSubscriptionPlugin, description: "Subscription test provider" },
} as const;

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

const API_CONFIG = {
  variables: {},
  secrets: {
    API_DATABASE_URL: "pglite:.bos/api-subscriptions-test/data",
  },
} satisfies PluginConfigInput<typeof ApiPlugin>;

const RPC_PREFIX = "/api/rpc";
const API_PREFIX = "/api";

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

async function createSubscriptionE2EContext() {
  const runtime = createPluginRuntime({
    registry: TEST_REGISTRY,
    secrets: {},
  });

  const pingpay = await runtime.usePlugin("pingpay", PINGPAY_CONFIG);
  const stripe = await runtime.usePlugin("stripe", STRIPE_CONFIG);
  const subsmock = await runtime.usePlugin(SUBS_PROVIDER, {
    variables: {},
    secrets: {},
  });

  const api = await runtime.usePlugin("api", API_CONFIG, {
    pingpay: pingpay.createClient,
    stripe: stripe.createClient,
    [SUBS_PROVIDER]: subsmock.createClient,
  });

  const router = api.router as any;
  const rpcHandler = new RPCHandler(router);
  const openApiHandler = new OpenAPIHandler(router);

  const server = createServer(async (req, res) => {
    const nearAccountId = req.headers[NEAR_ACCOUNT_HEADER];
    const context = {
      reqHeaders: toWebHeaders(req),
      ...(typeof nearAccountId === "string" ? { near: { primaryAccountId: nearAccountId } } : {}),
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
      headers: { [NEAR_ACCOUNT_HEADER]: SESSION_NEAR_ACCOUNT_ID },
    }),
  );

  const teardown = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await runtime.shutdown();
  };

  return { anonClient, authedClient, baseUrl, teardown };
}

type SubscriptionE2EContext = Awaited<ReturnType<typeof createSubscriptionE2EContext>>;

describe("E2E: subscription routes through the aggregator API", () => {
  let ctx: SubscriptionE2EContext;

  beforeAll(async () => {
    ctx = await createSubscriptionE2EContext();
  }, 120_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  it("lists only subscription-capable providers, skipping payment-only plugins", async () => {
    const providers = await ctx.anonClient.subscriptionProviders();

    expect(providers.find((p) => p.key === SUBS_PROVIDER)).toEqual({
      key: SUBS_PROVIDER,
      name: "Subs Mock",
      logo: "/logos/subsmock.png",
      description: "In-test subscription provider",
    });
    expect(providers.some((p) => p.key === "stripe")).toBe(true);
    expect(providers.some((p) => p.key === "pingpay")).toBe(false);
  });

  it("lists plans for a subscription provider", async () => {
    const plans = await ctx.anonClient.subscriptionPlans({ provider: SUBS_PROVIDER });

    expect(plans).toHaveLength(2);
    expect(plans[0]?.id).toBe("plan-basic");
    expect(plans[0]?.period).toBe("monthly");
    expect(plans[1]?.id).toBe("plan-pro");
  });

  it("serves plans over the OpenAPI route GET /subscriptions/{provider}/plans", async () => {
    const response = await fetch(
      `${ctx.baseUrl}${API_PREFIX}/subscriptions/${SUBS_PROVIDER}/plans`,
    );

    expect(response.status).toBe(200);
    const plans = (await response.json()) as Array<{ id: string }>;
    expect(plans.map((p) => p.id)).toEqual(["plan-basic", "plan-pro"]);
  });

  it("serves discovery over the OpenAPI route GET /subscriptions/providers", async () => {
    const response = await fetch(`${ctx.baseUrl}${API_PREFIX}/subscriptions/providers`);

    expect(response.status).toBe(200);
    const providers = (await response.json()) as Array<{ key: string }>;
    expect(providers.map((p) => p.key).sort()).toEqual(["stripe", SUBS_PROVIDER].sort());
  });

  it("returns NOT_FOUND for an unknown subscription provider", async () => {
    await expect(ctx.anonClient.subscriptionPlans({ provider: "nonexistent" })).rejects.toThrow(
      /Unknown subscription provider|NOT_FOUND/,
    );

    await expect(
      ctx.anonClient.subscriptionCreate({ provider: "nonexistent", planId: "plan-basic" }),
    ).rejects.toThrow(/Unknown subscription provider|NOT_FOUND/);
  });

  it("creates a subscription with an explicit payerRef", async () => {
    const action = await ctx.anonClient.subscriptionCreate({
      provider: SUBS_PROVIDER,
      planId: "plan-basic",
      payerRef: "bob.near",
    });

    expect(action.kind).toBe("executed");
    if (action.kind === "executed") {
      expect(action.subscription.payerRef).toBe("bob.near");
      expect(action.subscription.planId).toBe("plan-basic");
    }
  });

  it("allows anonymous create without payerRef (hosted checkout collects identity)", async () => {
    const action = await ctx.anonClient.subscriptionCreate({
      provider: SUBS_PROVIDER,
      planId: "plan-basic",
    });

    expect(action.kind).toBe("redirect");
    if (action.kind === "redirect") {
      expect(action.url).toContain("https://");
    }
  });

  it("defaults payerRef to the session NEAR account on create", async () => {
    const action = await ctx.authedClient.subscriptionCreate({
      provider: SUBS_PROVIDER,
      planId: "plan-basic",
    });

    expect(action.kind).toBe("executed");
    if (action.kind === "executed") {
      expect(action.subscription.payerRef).toBe(SESSION_NEAR_ACCOUNT_ID);
    }
  });

  it("defaults payerRef to the session NEAR account on status lookup", async () => {
    const subscription = await ctx.authedClient.subscriptionGet({
      provider: SUBS_PROVIDER,
      planId: "plan-basic",
    });

    expect(subscription.planId).toBe("plan-basic");
    expect(subscription.payerRef).toBe(SESSION_NEAR_ACCOUNT_ID);
  });

  it("lets an explicit payerRef override the session NEAR account", async () => {
    const subscription = await ctx.authedClient.subscriptionGet({
      provider: SUBS_PROVIDER,
      planId: "plan-basic",
      payerRef: "carol.near",
    });

    expect(subscription.payerRef).toBe("carol.near");
  });

  it("serves status over the OpenAPI route with query params", async () => {
    const response = await fetch(
      `${ctx.baseUrl}${API_PREFIX}/subscriptions/${SUBS_PROVIDER}/status?planId=plan-basic&payerRef=dave.near`,
    );

    expect(response.status).toBe(200);
    const subscription = (await response.json()) as { planId: string; payerRef: string };
    expect(subscription.planId).toBe("plan-basic");
    expect(subscription.payerRef).toBe("dave.near");
  });

  it("rejects status lookup with neither payerRef nor session identity", async () => {
    await expect(
      ctx.anonClient.subscriptionGet({ provider: SUBS_PROVIDER, planId: "plan-basic" }),
    ).rejects.toThrow(/payerRef|BAD_REQUEST/);
  });

  it("cancels with payerRef defaulted from the session", async () => {
    const action = await ctx.authedClient.subscriptionCancel({
      provider: SUBS_PROVIDER,
      planId: "plan-basic",
    });

    expect(action.kind).toBe("executed");
    if (action.kind === "executed") {
      expect(action.subscription.status).toBe("cancel_at_period_end");
      expect(action.subscription.payerRef).toBe(SESSION_NEAR_ACCOUNT_ID);
    }
  });

  it("resumes with payerRef defaulted from the session", async () => {
    const action = await ctx.authedClient.subscriptionResume({
      provider: SUBS_PROVIDER,
      planId: "plan-basic",
    });

    expect(action.kind).toBe("executed");
    if (action.kind === "executed") {
      expect(action.subscription.status).toBe("active");
      expect(action.subscription.payerRef).toBe(SESSION_NEAR_ACCOUNT_ID);
    }
  });

  it("changes plan, delegating newPlanId and defaulting payerRef", async () => {
    const action = await ctx.authedClient.subscriptionChange({
      provider: SUBS_PROVIDER,
      planId: "plan-basic",
      newPlanId: "plan-pro",
    });

    expect(action.kind).toBe("executed");
    if (action.kind === "executed") {
      expect(action.subscription.planId).toBe("plan-pro");
      expect(action.subscription.payerRef).toBe(SESSION_NEAR_ACCOUNT_ID);
    }
  });

  it("rejects cancel/resume/change with neither payerRef nor session identity", async () => {
    await expect(
      ctx.anonClient.subscriptionCancel({ provider: SUBS_PROVIDER, planId: "plan-basic" }),
    ).rejects.toThrow(/payerRef|BAD_REQUEST/);

    await expect(
      ctx.anonClient.subscriptionResume({ provider: SUBS_PROVIDER, planId: "plan-basic" }),
    ).rejects.toThrow(/payerRef|BAD_REQUEST/);

    await expect(
      ctx.anonClient.subscriptionChange({
        provider: SUBS_PROVIDER,
        planId: "plan-basic",
        newPlanId: "plan-pro",
      }),
    ).rejects.toThrow(/payerRef|BAD_REQUEST/);
  });
});
