import { createPlugin } from "every-plugin";
import { Effect } from "every-plugin/effect";
import { z } from "every-plugin/zod";
import { contract } from "./contract";
import { DatabaseLive, DatabaseTag } from "./db/layer";
import { loadMigrations } from "./db/load-migrations";
import { migrate } from "./db/migrator";
import { createAuthMiddleware } from "./lib/auth";
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
    const { requireAuth } = createAuthMiddleware(builder);

    return {
      ping: builder.ping.handler(async () => ({
        status: "ok",
        timestamp: new Date().toISOString(),
      })),
    };
  },
});
