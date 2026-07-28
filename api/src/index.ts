import { createPlugin } from "every-plugin";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import { contract } from "./contract";
import { DatabaseLive, DatabaseTag } from "./db/layer";
import { ContextSchema, runEffect } from "./lib/context";
import { EntitlementService, EntitlementServiceLive, yoctoToNear } from "./lib/credits";
import type { PluginsClient } from "./lib/plugins-types.gen";

export default createPlugin.withPlugins<PluginsClient>()({
  variables: z.object({}),

  secrets: z.object({
    API_DATABASE_URL: z.string().default("pglite:.bos/api/:memory:"),
  }),

  context: ContextSchema,

  contract,

  initialize: (config, plugins, tools) =>
    Effect.gen(function* () {
      const db = yield* tools.buildService(
        DatabaseTag,
        DatabaseLive(config.secrets.API_DATABASE_URL),
      );
      const credits = yield* tools.buildService(EntitlementService, EntitlementServiceLive(db));
      const { auth, ...restPlugins } = plugins;
      return { auth, plugins: restPlugins, db, credits };
    }),

  createRouter: (services, builder) => {
    const getPaymentPlugin = (provider: string) => {
      const factory = (services.plugins as Record<string, unknown>)[provider];
      if (!factory || typeof factory !== "function") {
        throw new ORPCError("NOT_FOUND", {
          message: `Unknown payment provider: ${provider}`,
        });
      }
      return factory;
    };

    const getSubscriptionPlugin = (provider: string) => {
      const factory = (services.plugins as Record<string, unknown>)[provider];
      if (!factory || typeof factory !== "function") {
        throw new ORPCError("NOT_FOUND", {
          message: `Unknown subscription provider: ${provider}`,
        });
      }
      return factory;
    };

    const resolvePayerRef = (
      payerRef: string | undefined,
      context: { near?: { primaryAccountId?: string | null } },
    ) => payerRef ?? context.near?.primaryAccountId ?? undefined;

    const requirePayerRef = (
      payerRef: string | undefined,
      context: { near?: { primaryAccountId?: string | null } },
    ) => {
      const resolved = resolvePayerRef(payerRef, context);
      if (!resolved) {
        throw new ORPCError("BAD_REQUEST", {
          message: "payerRef is required when no authenticated NEAR account is available",
        });
      }
      return resolved;
    };

    const requireUserId = (context: { userId?: string | null }) => {
      if (!context.userId) {
        throw new ORPCError("UNAUTHORIZED", { message: "Sign in to view credits" });
      }
      return context.userId;
    };

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // Public NEAR RPC endpoints load-balance across nodes with no read-after-write
    // guarantee, so a subscription's status can flip to "active" on one node while
    // its lock object is still unindexed on another. Retry a few times before
    // treating "status active but no lock data yet" as "nothing to grant".
    const getSubscriptionWithRetry = async (
      client: { getSubscription: (input: { planId: string; payerRef: string }) => Promise<any> },
      planId: string,
      payerRef: string,
    ): Promise<{ status: string; amount?: string; metadata?: Record<string, string> }> => {
      const retryDelaysMs = [300, 600, 1200];
      let subscription = await client.getSubscription({ planId, payerRef });
      for (const delay of retryDelaysMs) {
        const hasLockData = !!subscription.metadata?.lastLockId && !!subscription.amount;
        if (subscription.status === "none" || hasLockData) break;
        await sleep(delay);
        subscription = await client.getSubscription({ planId, payerRef });
      }
      return subscription;
    };

    return {
      ping: builder.ping.handler(async () => ({
        status: "ok",
        timestamp: new Date().toISOString(),
      })),

      paymentProviders: builder.paymentProviders.handler(async () => {
        const providers: Array<{
          key: string;
          name: string;
          logo: string;
          description: string;
        }> = [];

        for (const [key, factory] of Object.entries(services.plugins)) {
          if (typeof factory !== "function") continue;
          try {
            const client = (factory as () => any)();
            if (typeof client.createCheckout !== "function") continue;
            const metadata = await client.metadata();
            providers.push({ key, ...metadata });
          } catch {}
        }

        return providers;
      }),

      paymentCheckout: builder.paymentCheckout.handler(async ({ input }) => {
        const { provider, ...checkoutInput } = input;
        const factory = getPaymentPlugin(provider);
        const client = (factory as (opts?: unknown) => any)();
        return (await client.createCheckout(checkoutInput)) as any;
      }),

      paymentWebhook: builder.paymentWebhook.handler(async ({ input, context }) => {
        const { provider, ...webhookInput } = input;
        const factory = getPaymentPlugin(provider);
        const client = (factory as (opts?: unknown) => any)({ headers: context.reqHeaders });
        return (await client.verifyWebhook(webhookInput)) as any;
      }),

      paymentSession: builder.paymentSession.handler(async ({ input }) => {
        const { provider, sessionId } = input;
        const factory = getPaymentPlugin(provider);
        const client = (factory as (opts?: unknown) => any)();
        return (await client.getSession({ sessionId })) as any;
      }),

      subscriptionProviders: builder.subscriptionProviders.handler(async () => {
        const providers: Array<{
          key: string;
          name: string;
          logo: string;
          description: string;
        }> = [];

        for (const [key, factory] of Object.entries(services.plugins)) {
          if (typeof factory !== "function") continue;
          try {
            const client = (factory as () => any)();
            if (typeof client.listPlans !== "function") continue;
            const metadata = await client.metadata();
            providers.push({ key, ...metadata });
          } catch {}
        }

        return providers;
      }),

      subscriptionPlans: builder.subscriptionPlans.handler(async ({ input }) => {
        const factory = getSubscriptionPlugin(input.provider);
        const client = (factory as (opts?: unknown) => any)();
        return (await client.listPlans()) as any;
      }),

      subscriptionCreate: builder.subscriptionCreate.handler(async ({ input, context }) => {
        const { provider, payerRef, ...createInput } = input;
        const factory = getSubscriptionPlugin(provider);
        const client = (factory as (opts?: unknown) => any)();
        const resolved = resolvePayerRef(payerRef, context);
        return (await client.createSubscription({
          ...createInput,
          ...(resolved !== undefined ? { payerRef: resolved } : {}),
        })) as any;
      }),

      subscriptionGet: builder.subscriptionGet.handler(async ({ input, context }) => {
        const factory = getSubscriptionPlugin(input.provider);
        const client = (factory as (opts?: unknown) => any)();
        const payerRef = requirePayerRef(input.payerRef, context);
        return (await client.getSubscription({ planId: input.planId, payerRef })) as any;
      }),

      subscriptionCancel: builder.subscriptionCancel.handler(async ({ input, context }) => {
        const factory = getSubscriptionPlugin(input.provider);
        const client = (factory as (opts?: unknown) => any)();
        const payerRef = requirePayerRef(input.payerRef, context);
        return (await client.cancelSubscription({ planId: input.planId, payerRef })) as any;
      }),

      subscriptionResume: builder.subscriptionResume.handler(async ({ input, context }) => {
        const factory = getSubscriptionPlugin(input.provider);
        const client = (factory as (opts?: unknown) => any)();
        const payerRef = requirePayerRef(input.payerRef, context);
        return (await client.resumeSubscription({ planId: input.planId, payerRef })) as any;
      }),

      subscriptionChange: builder.subscriptionChange.handler(async ({ input, context }) => {
        const factory = getSubscriptionPlugin(input.provider);
        const client = (factory as (opts?: unknown) => any)();
        const payerRef = requirePayerRef(input.payerRef, context);
        return (await client.changePlan({
          planId: input.planId,
          newPlanId: input.newPlanId,
          ...(input.amount !== undefined ? { amount: input.amount } : {}),
          payerRef,
        })) as any;
      }),

      creditList: builder.creditList.handler(async ({ context }) => {
        const userId = requireUserId(context);
        const organizationId = context.organization?.activeOrganizationId ?? null;
        return await runEffect(services.credits.getBalances({ userId, organizationId }));
      }),

      subscriptionCreditSync: builder.subscriptionCreditSync.handler(async ({ input, context }) => {
        const userId = requireUserId(context);
        const organizationId = context.organization?.activeOrganizationId ?? null;
        const { provider, planId } = input;
        const factory = getSubscriptionPlugin(provider);
        const client = (factory as (opts?: unknown) => any)();
        const payerRef = requirePayerRef(input.payerRef, context);

        const subscription = await getSubscriptionWithRetry(client, planId, payerRef);

        const lockId = subscription.metadata?.lastLockId;
        const amount = subscription.amount;

        let granted = false;
        let reason: "granted" | "already_synced" | "not_ready" | "not_staked" = "not_staked";

        if (subscription.status !== "none" && lockId && amount) {
          const result = await runEffect(
            services.credits.grantCredits({
              userId,
              organizationId,
              amount: yoctoToNear(amount),
              source: `${provider}:lock`,
              sourceRef: lockId,
              metadata: { provider, planId, payerRef },
            }),
          );
          granted = result.granted;
          reason = result.granted ? "granted" : "already_synced";
        } else if (subscription.status !== "none") {
          reason = "not_ready";
        }

        const balances = await runEffect(services.credits.getBalances({ userId, organizationId }));
        return { granted, reason, balances };
      }),
    };
  },
});
