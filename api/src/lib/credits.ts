import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "every-plugin/effect";
import type { Database } from "../db";
import { DatabaseError } from "../db";
import { entitlements, entitlementTransactions } from "../db/schema";

const YOCTO_PER_NEAR = 10n ** 24n;

export function yoctoToNear(yocto: string): string {
  const value = BigInt(yocto);
  const whole = value / YOCTO_PER_NEAR;
  const fraction = (value % YOCTO_PER_NEAR).toString().padStart(24, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export interface GrantCreditsInput {
  userId: string;
  organizationId: string | null;
  creditType?: string;
  amount: string;
  source: string;
  sourceRef: string | null;
  metadata?: Record<string, unknown>;
}

export interface GrantCreditsResult {
  granted: boolean;
  balance: string;
}

export interface CreditBalance {
  creditType: string;
  balance: string;
}

export class EntitlementService extends Context.Tag("EntitlementService")<
  EntitlementService,
  {
    readonly grantCredits: (
      input: GrantCreditsInput,
    ) => Effect.Effect<GrantCreditsResult, DatabaseError>;
    readonly getBalances: (params: {
      userId: string;
      organizationId: string | null;
    }) => Effect.Effect<CreditBalance[], DatabaseError>;
  }
>() {}

export const EntitlementServiceLive = (db: Database) =>
  Layer.succeed(EntitlementService, {
    grantCredits: (input) =>
      Effect.tryPromise({
        try: () =>
          db.transaction(async (tx) => {
            const creditType = input.creditType ?? "default";

            const [entitlement] = await tx
              .insert(entitlements)
              .values({
                id: randomUUID(),
                userId: input.userId,
                organizationId: input.organizationId,
                creditType,
                balance: "0",
              })
              .onConflictDoUpdate({
                target: [entitlements.userId, entitlements.organizationId, entitlements.creditType],
                set: { updatedAt: new Date() },
              })
              .returning();

            if (!entitlement) {
              throw new Error("Entitlement upsert returned no row");
            }

            const [inserted] = await tx
              .insert(entitlementTransactions)
              .values({
                id: randomUUID(),
                entitlementId: entitlement.id,
                type: "grant",
                amount: input.amount,
                source: input.source,
                sourceRef: input.sourceRef,
                metadata: input.metadata ?? null,
              })
              .onConflictDoNothing({ target: entitlementTransactions.sourceRef })
              .returning();

            if (!inserted) {
              return { granted: false, balance: entitlement.balance };
            }

            const [updated] = await tx
              .update(entitlements)
              .set({
                balance: sql`${entitlements.balance} + ${input.amount}::numeric`,
                updatedAt: new Date(),
              })
              .where(eq(entitlements.id, entitlement.id))
              .returning();

            if (!updated) {
              throw new Error("Entitlement balance update returned no row");
            }

            return { granted: true, balance: updated.balance };
          }),
        catch: (cause) => new DatabaseError({ stage: "load", cause }),
      }),

    getBalances: (params) =>
      Effect.tryPromise({
        try: () =>
          db
            .select({ creditType: entitlements.creditType, balance: entitlements.balance })
            .from(entitlements)
            .where(
              and(
                eq(entitlements.userId, params.userId),
                params.organizationId === null
                  ? isNull(entitlements.organizationId)
                  : eq(entitlements.organizationId, params.organizationId),
              ),
            ),
        catch: (cause) => new DatabaseError({ stage: "load", cause }),
      }),
  });
