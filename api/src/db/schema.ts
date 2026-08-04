import { sql } from "drizzle-orm";
import {
  check,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const entitlements = pgTable(
  "entitlements",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    organizationId: text("organization_id"),
    creditType: text("credit_type").notNull().default("default"),
    balance: numeric("balance").notNull().default("0"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("entitlements_user_org_type_unique")
      .on(table.userId, table.organizationId, table.creditType)
      .nullsNotDistinct(),
  ],
);

export const entitlementTransactions = pgTable(
  "entitlement_transactions",
  {
    id: text("id").primaryKey(),
    entitlementId: text("entitlement_id")
      .notNull()
      .references(() => entitlements.id),
    type: text("type").notNull(),
    amount: numeric("amount").notNull(),
    source: text("source").notNull(),
    sourceRef: text("source_ref"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("entitlement_transactions_source_ref_unique").on(table.sourceRef),
    check("entitlement_transactions_type_check", sql`${table.type} IN ('grant', 'consume')`),
  ],
);
