import { createPlugin } from "every-plugin";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import { contract } from "./contract";
import { DatabaseLive, DatabaseTag } from "./db/layer";
import { loadMigrations } from "./db/load-migrations";
import { migrate } from "./db/migrator";
import type { PluginsClient } from "./lib/plugins-types.gen";

export default createPlugin.withPlugins<PluginsClient>()({
  variables: z.object({}),

  secrets: z.object({
    API_DATABASE_URL: z.string().default("pglite:.bos/api/:memory:"),
  }),

  context: z.object({
    userId: z.string().optional(),
    user: z
      .object({
        id: z.string(),
        role: z.string().optional(),
        email: z.string().optional(),
        name: z.string().optional(),
      })
      .optional(),
    organizationId: z.string().optional(),
    reqHeaders: z.custom<Headers>().optional(),
    getRawBody: z.custom<() => Promise<string>>().optional(),
  }),

  contract,

  initialize: (config, plugins) =>
    Effect.provide(
      Effect.gen(function* () {
        const db = yield* DatabaseTag;

        const migrations = yield* Effect.promise(() => loadMigrations());
        yield* Effect.promise(() => migrate(db, migrations));

        const { auth, ...restPlugins } = plugins;

        return { auth, plugins: restPlugins, db };
      }),
      DatabaseLive(config.secrets.API_DATABASE_URL),
    ),

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
    };
  },
});
