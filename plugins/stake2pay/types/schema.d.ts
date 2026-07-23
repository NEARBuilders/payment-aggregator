import { z } from "every-plugin/zod";
export declare const AmountSchema: z.ZodString;
export declare const PlanPeriodSchema: z.ZodEnum<{
    daily: "daily";
    weekly: "weekly";
    monthly: "monthly";
    quarterly: "quarterly";
    yearly: "yearly";
}>;
export declare const SubscriptionStatusSchema: z.ZodEnum<{
    active: "active";
    cancel_at_period_end: "cancel_at_period_end";
    pending_unstake: "pending_unstake";
    ended: "ended";
    none: "none";
}>;
export declare const PlanSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    period: z.ZodEnum<{
        daily: "daily";
        weekly: "weekly";
        monthly: "monthly";
        quarterly: "quarterly";
        yearly: "yearly";
    }>;
    currency: z.ZodString;
    minAmount: z.ZodString;
    maxAmount: z.ZodString;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>;
export declare const SubscriptionSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    planId: z.ZodString;
    status: z.ZodEnum<{
        active: "active";
        cancel_at_period_end: "cancel_at_period_end";
        pending_unstake: "pending_unstake";
        ended: "ended";
        none: "none";
    }>;
    amount: z.ZodOptional<z.ZodString>;
    currency: z.ZodOptional<z.ZodString>;
    currentPeriodEnd: z.ZodOptional<z.ZodString>;
    payerRef: z.ZodString;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>;
export declare const WalletFunctionCallSchema: z.ZodObject<{
    methodName: z.ZodString;
    args: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    deposit: z.ZodString;
    gas: z.ZodString;
}, z.core.$strip>;
export declare const SubscriptionActionSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"wallet_intent">;
    networkId: z.ZodString;
    contractId: z.ZodString;
    actions: z.ZodArray<z.ZodObject<{
        methodName: z.ZodString;
        args: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        deposit: z.ZodString;
        gas: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"redirect">;
    url: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"executed">;
    subscription: z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        planId: z.ZodString;
        status: z.ZodEnum<{
            active: "active";
            cancel_at_period_end: "cancel_at_period_end";
            pending_unstake: "pending_unstake";
            ended: "ended";
            none: "none";
        }>;
        amount: z.ZodOptional<z.ZodString>;
        currency: z.ZodOptional<z.ZodString>;
        currentPeriodEnd: z.ZodOptional<z.ZodString>;
        payerRef: z.ZodString;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>;
}, z.core.$strip>], "kind">;
export declare const ListPlansOutputSchema: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    period: z.ZodEnum<{
        daily: "daily";
        weekly: "weekly";
        monthly: "monthly";
        quarterly: "quarterly";
        yearly: "yearly";
    }>;
    currency: z.ZodString;
    minAmount: z.ZodString;
    maxAmount: z.ZodString;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>>;
export declare const CreateSubscriptionInputSchema: z.ZodObject<{
    planId: z.ZodString;
    amount: z.ZodOptional<z.ZodString>;
    payerRef: z.ZodOptional<z.ZodString>;
    successUrl: z.ZodOptional<z.ZodString>;
    cancelUrl: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>;
export declare const GetSubscriptionInputSchema: z.ZodObject<{
    planId: z.ZodString;
    payerRef: z.ZodString;
}, z.core.$strip>;
export declare const CancelSubscriptionInputSchema: z.ZodObject<{
    planId: z.ZodString;
    payerRef: z.ZodString;
}, z.core.$strip>;
export declare const ResumeSubscriptionInputSchema: z.ZodObject<{
    planId: z.ZodString;
    payerRef: z.ZodString;
}, z.core.$strip>;
export declare const ChangePlanInputSchema: z.ZodObject<{
    planId: z.ZodString;
    newPlanId: z.ZodString;
    amount: z.ZodOptional<z.ZodString>;
    payerRef: z.ZodString;
}, z.core.$strip>;
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
