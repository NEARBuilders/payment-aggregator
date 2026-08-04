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
    const getPlugin = (name: string) => {
      const factory = (services.plugins as Record<string, unknown>)[name];
      if (!factory || typeof factory !== "function") {
        throw new ORPCError("NOT_FOUND", {
          message: `Unknown plugin: ${name}`,
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

    const requireOwnPayerRef = (
      payerRef: string | undefined,
      context: {
        near?: {
          primaryAccountId?: string | null;
          linkedAccounts?: Array<{ accountId: string }>;
        };
      },
    ) => {
      const resolved = requirePayerRef(payerRef, context);
      const owned =
        resolved === context.near?.primaryAccountId ||
        (context.near?.linkedAccounts ?? []).some((account) => account.accountId === resolved);
      if (!owned) {
        throw new ORPCError("FORBIDDEN", {
          message: "payerRef must be a NEAR account linked to your session",
        });
      }
      return resolved;
    };

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const getSubscriptionWithRetry = async (
      client: { getSubscription: (input: { planId: string; payerRef: string }) => Promise<any> },
      planId: string,
      payerRef: string,
    ): Promise<{
      status: string;
      amount?: string;
      id?: string;
      currentPeriodEnd?: string;
      metadata?: Record<string, string>;
    }> => {
      const retryDelaysMs = [300, 600, 1200];
      let subscription = await client.getSubscription({ planId, payerRef });
      for (const delay of retryDelaysMs) {
        const hasLockData = !!subscription.metadata?.lastLockId && !!subscription.amount;
        if (hasLockData) break;
        await sleep(delay);
        subscription = await client.getSubscription({ planId, payerRef });
      }
      return subscription;
    };

    const SUCCESS_WEBHOOK_EVENTS = new Set(["checkout.session.completed", "payment.success"]);

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

      paymentCheckout: builder.paymentCheckout.handler(async ({ input, context }) => {
        const { provider, ...checkoutInput } = input;
        const factory = getPlugin(provider);
        const client = (factory as (opts?: unknown) => any)();

        const userMetadata: Record<string, string> = {};
        if (context.userId) {
          userMetadata.userId = context.userId;
          const orgId = context.organization?.activeOrganizationId;
          if (orgId) userMetadata.organizationId = orgId;
        }

        const enriched = {
          ...checkoutInput,
          metadata: { ...checkoutInput.metadata, ...userMetadata },
        };

        return (await client.createCheckout(enriched)) as any;
      }),

      paymentWebhook: builder.paymentWebhook.handler(async ({ input, context }) => {
        const { provider, ...webhookInput } = input;
        const factory = getPlugin(provider);
        const client = (factory as (opts?: unknown) => any)({ headers: context.reqHeaders });
        const result = (await client.verifyWebhook(webhookInput)) as {
          received: boolean;
          eventType?: string;
          orderId?: string;
          sessionId?: string;
        };

        let creditsGranted: string | undefined;

        if (
          result.received &&
          result.eventType &&
          SUCCESS_WEBHOOK_EVENTS.has(result.eventType) &&
          result.sessionId
        ) {
          try {
            const sessionData = (await client.getSession({ sessionId: result.sessionId })) as {
              session: {
                amountTotal?: number;
                metadata?: Record<string, string>;
              };
            };

            const amountTotal = sessionData?.session?.amountTotal;
            const userId = sessionData?.session?.metadata?.userId ?? context.userId;
            const organizationId =
              sessionData?.session?.metadata?.organizationId ??
              context.organization?.activeOrganizationId ??
              null;

            if (userId && amountTotal && amountTotal > 0) {
              const credits = (amountTotal / 100).toFixed(2);
              const grant = await runEffect(
                services.credits.grantCredits({
                  userId,
                  organizationId: organizationId ?? null,
                  amount: credits,
                  source: `${provider}:payment`,
                  sourceRef: result.sessionId,
                  metadata: {
                    provider,
                    orderId: result.orderId,
                    eventType: result.eventType,
                  },
                }),
              );
              if (grant.granted) creditsGranted = credits;
            }
          } catch {
            // Credit granting is best-effort — don't fail the webhook
          }
        }

        return { ...result, creditsGranted };
      }),

      paymentSession: builder.paymentSession.handler(async ({ input }) => {
        const { provider, sessionId } = input;
        const factory = getPlugin(provider);
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
        const factory = getPlugin(input.provider);
        const client = (factory as (opts?: unknown) => any)();
        return (await client.listPlans()) as any;
      }),

      subscriptionCreate: builder.subscriptionCreate.handler(async ({ input, context }) => {
        const { provider, payerRef, ...createInput } = input;
        const factory = getPlugin(provider);
        const client = (factory as (opts?: unknown) => any)();
        const resolved = resolvePayerRef(payerRef, context);

        const userMetadata: Record<string, string> = {};
        if (context.userId) {
          userMetadata.userId = context.userId;
          const orgId = context.organization?.activeOrganizationId;
          if (orgId) userMetadata.organizationId = orgId;
        }

        return (await client.createSubscription({
          ...createInput,
          ...(resolved !== undefined ? { payerRef: resolved } : {}),
          metadata: { ...createInput.metadata, ...userMetadata },
        })) as any;
      }),

      subscriptionGet: builder.subscriptionGet.handler(async ({ input, context }) => {
        const factory = getPlugin(input.provider);
        const client = (factory as (opts?: unknown) => any)();
        const payerRef = requirePayerRef(input.payerRef, context);
        return (await client.getSubscription({ planId: input.planId, payerRef })) as any;
      }),

      subscriptionCancel: builder.subscriptionCancel.handler(async ({ input, context }) => {
        const factory = getPlugin(input.provider);
        const client = (factory as (opts?: unknown) => any)();
        const payerRef = requirePayerRef(input.payerRef, context);
        return (await client.cancelSubscription({ planId: input.planId, payerRef })) as any;
      }),

      subscriptionResume: builder.subscriptionResume.handler(async ({ input, context }) => {
        const factory = getPlugin(input.provider);
        const client = (factory as (opts?: unknown) => any)();
        const payerRef = requirePayerRef(input.payerRef, context);
        return (await client.resumeSubscription({ planId: input.planId, payerRef })) as any;
      }),

      subscriptionChange: builder.subscriptionChange.handler(async ({ input, context }) => {
        const factory = getPlugin(input.provider);
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
        const { provider, planId } = input;
        const organizationId = context.organization?.activeOrganizationId ?? null;
        const factory = getPlugin(provider);
        const client = (factory as (opts?: unknown) => any)();

        const payerRef =
          provider === "stake2pay"
            ? requireOwnPayerRef(input.payerRef, context)
            : requirePayerRef(input.payerRef, context);

        const subscription = await getSubscriptionWithRetry(client, planId, payerRef);

        const grantableStatuses = new Set(["active", "cancel_at_period_end", "pending_unstake"]);
        let granted = false;
        let reason: "granted" | "already_synced" | "not_ready" | "not_staked" = "not_staked";

        if (grantableStatuses.has(subscription.status)) {
          if (provider === "stake2pay") {
            const lockId = subscription.metadata?.lastLockId;
            const amount = subscription.amount;

            if (lockId && amount) {
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
            } else {
              reason = "not_ready";
            }
          } else {
            const subscriptionId = subscription.id;
            const currentPeriodEnd = subscription.currentPeriodEnd;
            const amount = subscription.amount;

            if (subscriptionId && amount && currentPeriodEnd) {
              const credits = (Number(amount) / 100).toFixed(2);
              const sourceRef = `${subscriptionId}:${currentPeriodEnd}`;
              const result = await runEffect(
                services.credits.grantCredits({
                  userId,
                  organizationId,
                  amount: credits,
                  source: `${provider}:subscription`,
                  sourceRef,
                  metadata: { provider, planId, payerRef },
                }),
              );
              granted = result.granted;
              reason = result.granted ? "granted" : "already_synced";
            } else {
              reason = "not_ready";
            }
          }
        }

        const balances = await runEffect(services.credits.getBalances({ userId, organizationId }));
        return { granted, reason, balances };
      }),
    };
  },
});
