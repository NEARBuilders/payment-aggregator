import { createPlugin } from "every-plugin";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import { contract } from "./contract";
import { DatabaseLive, DatabaseTag } from "./db/layer";
import { ContextSchema } from "./lib/context";
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
      const { auth, ...restPlugins } = plugins;
      return { auth, plugins: restPlugins, db };
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
    };
  },
});
