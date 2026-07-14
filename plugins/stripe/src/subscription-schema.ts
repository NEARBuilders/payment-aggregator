import { z } from "every-plugin/zod";

export const AmountSchema = z
  .string()
  .regex(/^\d+$/, "integer string in the currency's smallest unit (cents)");

export const PlanPeriodSchema = z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]);

export const SubscriptionStatusSchema = z.enum([
  "active",
  "cancel_at_period_end",
  "pending_unstake",
  "ended",
  "none",
]);

export const PlanSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    period: PlanPeriodSchema,
    currency: z.string(),
    minAmount: AmountSchema,
    maxAmount: AmountSchema,
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .refine((plan) => BigInt(plan.minAmount) <= BigInt(plan.maxAmount), {
    message: "minAmount must not exceed maxAmount",
    path: ["minAmount"],
  });

export const SubscriptionSchema = z.object({
  id: z.string().optional(),
  planId: z.string(),
  status: SubscriptionStatusSchema,
  amount: AmountSchema.optional(),
  currency: z.string().optional(),
  currentPeriodEnd: z.string().datetime().optional(),
  payerRef: z.string(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const WalletFunctionCallSchema = z.object({
  methodName: z.string(),
  args: z.record(z.string(), z.unknown()),
  deposit: AmountSchema,
  gas: z.string().regex(/^\d+$/),
});

export const SubscriptionActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("wallet_intent"),
    networkId: z.string(),
    contractId: z.string(),
    actions: z.array(WalletFunctionCallSchema).min(1),
  }),
  z.object({
    kind: z.literal("redirect"),
    url: z.string().url(),
  }),
  z.object({
    kind: z.literal("executed"),
    subscription: SubscriptionSchema,
  }),
]);

export const ListPlansOutputSchema = z.array(PlanSchema);

export const CreateSubscriptionInputSchema = z.object({
  planId: z.string(),
  amount: AmountSchema.optional(),
  payerRef: z.string().optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const GetSubscriptionInputSchema = z.object({
  planId: z.string(),
  payerRef: z.string(),
});

export const CancelSubscriptionInputSchema = z.object({
  planId: z.string(),
  payerRef: z.string(),
});

export const ResumeSubscriptionInputSchema = z.object({
  planId: z.string(),
  payerRef: z.string(),
});

export const ChangePlanInputSchema = z.object({
  planId: z.string(),
  newPlanId: z.string(),
  amount: AmountSchema.optional(),
  payerRef: z.string(),
});

export type Amount = z.infer<typeof AmountSchema>;
export type PlanPeriod = z.infer<typeof PlanPeriodSchema>;
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;
export type WalletFunctionCall = z.infer<typeof WalletFunctionCallSchema>;
export type SubscriptionAction = z.infer<typeof SubscriptionActionSchema>;
export type CreateSubscriptionInput = z.infer<typeof CreateSubscriptionInputSchema>;
export type GetSubscriptionInput = z.infer<typeof GetSubscriptionInputSchema>;
export type CancelSubscriptionInput = z.infer<typeof CancelSubscriptionInputSchema>;
export type ResumeSubscriptionInput = z.infer<typeof ResumeSubscriptionInputSchema>;
export type ChangePlanInput = z.infer<typeof ChangePlanInputSchema>;
