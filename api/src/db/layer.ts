import { Context, Effect, Layer } from "every-plugin/effect";
import type { ApiDatabase } from "./index";

const closeMap = new WeakMap<ApiDatabase, () => Promise<void>>();

export class DatabaseTag extends Context.Tag("api/Database")<DatabaseTag, ApiDatabase>() {}

export const DatabaseLive = (url: string) =>
  Layer.scoped(
    DatabaseTag,
    Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          const { createDatabaseDriver } = await import("./index");
          const driver = await createDatabaseDriver(url);
          closeMap.set(driver.db, () => driver.close());
          return driver.db;
        },
        catch: (error) => new Error(`Database connection failed: ${String(error)}`),
      }),
      (db) =>
        Effect.promise(async () => {
          const close = closeMap.get(db);
          if (close) {
            closeMap.delete(db);
            await close();
          }
        }),
    ),
  );
