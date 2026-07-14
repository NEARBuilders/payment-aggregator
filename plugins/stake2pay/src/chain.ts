import { z } from "every-plugin/zod";

export const HosProductSchema = z.object({
  product_id: z.string(),
  validator_id: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.enum(["Active", "Archived"]),
  created_ns: z.string(),
  price_ids: z.array(z.string()),
  default_price_id: z.string().nullable().optional(),
  usage_count: z.number(),
});

export const HosPriceSchema = z.object({
  price_id: z.string(),
  product_id: z.string(),
  name: z.string(),
  description: z.string(),
  amount: z.string(),
  price_type: z.enum(["OneOff", "Recurring"]),
  billing_period: z.enum(["Monthly"]).nullable().optional(),
  lock_factor_near_months: z.string(),
  metadata: z
    .object({ max_amount: z.string().nullable().optional() })
    .passthrough()
    .nullable()
    .optional(),
  status: z.enum(["Active", "Archived"]),
  usage_count: z.number(),
});

export const HosPendingUpdateSchema = z.object({
  target_price_id: z.string().nullable().optional(),
  target_amount: z.string().nullable().optional(),
  apply_ns: z.string(),
});

export const HosSubscriptionSchema = z.object({
  subscription_id: z.string(),
  account_id: z.string(),
  product_id: z.string(),
  price_id: z.string(),
  start_ns: z.string(),
  end_ns: z.string(),
  anchor_day: z.number(),
  last_lock_id: z.string(),
  status: z.enum(["Active", "Cancelled", "Expired"]),
  cancel_at_period_end: z.boolean(),
  pending_update: HosPendingUpdateSchema.nullable().optional(),
});

export const HosLockSchema = z.object({
  lock_id: z.string(),
  account_id: z.string(),
  validator_id: z.string(),
  amount_near: z.string(),
  shares: z.string(),
  start_ns: z.string(),
  end_ns: z.string(),
  status: z.enum(["Active", "UnlockRequested", "Withdrawn"]),
});

export const HosConfigSchema = z
  .object({
    min_storage_deposit: z.string(),
    per_lock_storage_stake: z.string(),
    min_lock_amount: z.string(),
  })
  .passthrough();

export const StorageBalanceSchema = z.object({
  total: z.string(),
  available: z.string(),
});

export type HosProduct = z.infer<typeof HosProductSchema>;
export type HosPrice = z.infer<typeof HosPriceSchema>;
export type HosSubscription = z.infer<typeof HosSubscriptionSchema>;
export type HosLock = z.infer<typeof HosLockSchema>;
export type HosConfig = z.infer<typeof HosConfigSchema>;
export type StorageBalance = z.infer<typeof StorageBalanceSchema>;
