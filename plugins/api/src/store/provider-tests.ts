import { eq } from 'drizzle-orm';
import { Context, Effect, Layer } from 'every-plugin/effect';
import * as schema from '../db/schema';
import type { ProviderName, ProviderTestScenario, ProviderTestState } from '../schema';
import { Database } from './database';

export class ProviderTestStateStore extends Context.Tag('ProviderTestStateStore')<
  ProviderTestStateStore,
  {
    readonly getState: (provider: ProviderName) => Effect.Effect<ProviderTestState | null, Error>;
    readonly upsertState: (input: {
      provider: ProviderName;
      testProductId?: string | null;
      selectedRates?: Record<string, string> | null;
      scenario?: ProviderTestScenario | null;
      latestOrderId?: string | null;
      latestStepResults?: Record<string, unknown>;
      latestWebhookPayloads?: Record<string, unknown>;
    }) => Effect.Effect<ProviderTestState, Error>;
  }
>() {}

const rowToState = (row: typeof schema.providerTestStates.$inferSelect): ProviderTestState => ({
  provider: row.provider as ProviderName,
  testProductId: row.testProductId ?? null,
  selectedRates: (row.selectedRates as Record<string, string> | null) ?? undefined,
  scenario: (row.scenario as ProviderTestScenario | null) ?? null,
  latestOrderId: row.latestOrderId ?? null,
  latestStepResults: row.latestStepResults ?? undefined,
  latestWebhookPayloads: row.latestWebhookPayloads ?? undefined,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const ProviderTestStateStoreLive = Layer.effect(
  ProviderTestStateStore,
  Effect.gen(function* () {
    const db = yield* Database;

    return {
      getState: (provider) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(schema.providerTestStates)
              .where(eq(schema.providerTestStates.provider, provider))
              .limit(1);

            if (results.length === 0) {
              return null;
            }

            return rowToState(results[0]!);
          },
          catch: (error) => new Error(`Failed to get provider test state: ${error}`),
        }),

      upsertState: (input) =>
        Effect.tryPromise({
          try: async () => {
            const now = new Date();
            const existing = await db
              .select()
              .from(schema.providerTestStates)
              .where(eq(schema.providerTestStates.provider, input.provider))
              .limit(1);

            if (existing.length > 0) {
              const row = existing[0]!;
              await db
                .update(schema.providerTestStates)
                .set({
                  testProductId: input.testProductId !== undefined ? input.testProductId : row.testProductId,
                  selectedRates: input.selectedRates !== undefined ? input.selectedRates : row.selectedRates,
                  scenario: input.scenario !== undefined ? input.scenario : row.scenario,
                  latestOrderId: input.latestOrderId !== undefined ? input.latestOrderId : row.latestOrderId,
                  latestStepResults: input.latestStepResults !== undefined ? input.latestStepResults : row.latestStepResults,
                  latestWebhookPayloads: input.latestWebhookPayloads !== undefined ? input.latestWebhookPayloads : row.latestWebhookPayloads,
                  updatedAt: now,
                })
                .where(eq(schema.providerTestStates.provider, input.provider));
            } else {
              await db.insert(schema.providerTestStates).values({
                provider: input.provider,
                testProductId: input.testProductId ?? null,
                selectedRates: input.selectedRates ?? null,
                scenario: input.scenario ?? null,
                latestOrderId: input.latestOrderId ?? null,
                latestStepResults: input.latestStepResults ?? null,
                latestWebhookPayloads: input.latestWebhookPayloads ?? null,
                createdAt: now,
                updatedAt: now,
              });
            }

            const results = await db
              .select()
              .from(schema.providerTestStates)
              .where(eq(schema.providerTestStates.provider, input.provider))
              .limit(1);

            if (results.length === 0) {
              throw new Error('Failed to persist provider test state');
            }

            return rowToState(results[0]!);
          },
          catch: (error) => new Error(`Failed to upsert provider test state: ${error}`),
        }),
    };
  }),
);
