import { z } from "every-plugin/zod";
export declare const SubscriptionContract: {
    metadata: import("@orpc/contract").ContractProcedure<import("@orpc/contract").Schema<unknown, unknown>, z.ZodObject<{
        name: z.ZodString;
        logo: z.ZodString;
        description: z.ZodString;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, Record<never, never>>, Record<never, never>>;
    ping: import("@orpc/contract").ContractProcedure<import("@orpc/contract").Schema<unknown, unknown>, z.ZodObject<{
        provider: z.ZodString;
        status: z.ZodLiteral<"ok">;
        timestamp: z.ZodString;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, Record<never, never>>, Record<never, never>>;
    listPlans: import("@orpc/contract").ContractProcedure<import("@orpc/contract").Schema<unknown, unknown>, z.ZodArray<z.ZodObject<{
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
    }, z.core.$strip>>, import("@orpc/contract").MergedErrorMap<Record<never, never>, Record<never, never>>, Record<never, never>>;
    createSubscription: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        planId: z.ZodString;
        amount: z.ZodOptional<z.ZodString>;
        payerRef: z.ZodOptional<z.ZodString>;
        successUrl: z.ZodOptional<z.ZodString>;
        cancelUrl: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>, z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strip>], "kind">, import("@orpc/contract").MergedErrorMap<Record<never, never>, Record<never, never>>, Record<never, never>>;
    getSubscription: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        planId: z.ZodString;
        payerRef: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
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
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, Record<never, never>>, Record<never, never>>;
    cancelSubscription: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        planId: z.ZodString;
        payerRef: z.ZodString;
    }, z.core.$strip>, z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strip>], "kind">, import("@orpc/contract").MergedErrorMap<Record<never, never>, Record<never, never>>, Record<never, never>>;
    resumeSubscription: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        planId: z.ZodString;
        payerRef: z.ZodString;
    }, z.core.$strip>, z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strip>], "kind">, import("@orpc/contract").MergedErrorMap<Record<never, never>, Record<never, never>>, Record<never, never>>;
    changePlan: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        planId: z.ZodString;
        newPlanId: z.ZodString;
        amount: z.ZodOptional<z.ZodString>;
        payerRef: z.ZodString;
    }, z.core.$strip>, z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strip>], "kind">, import("@orpc/contract").MergedErrorMap<Record<never, never>, Record<never, never>>, Record<never, never>>;
};
export type SubscriptionContractType = typeof SubscriptionContract;
export type ContractType = typeof SubscriptionContract;
