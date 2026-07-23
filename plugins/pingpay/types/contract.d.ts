import { z } from "every-plugin/zod";
export declare const PaymentContract: {
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
    createCheckout: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        orderId: z.ZodString;
        amount: z.ZodNumber;
        currency: z.ZodDefault<z.ZodString>;
        items: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            image: z.ZodOptional<z.ZodString>;
            unitAmount: z.ZodNumber;
            quantity: z.ZodNumber;
        }, z.core.$strip>>;
        customerEmail: z.ZodOptional<z.ZodString>;
        successUrl: z.ZodString;
        cancelUrl: z.ZodString;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        fees: z.ZodOptional<z.ZodArray<z.ZodObject<{
            type: z.ZodString;
            label: z.ZodString;
            recipient: z.ZodString;
            bps: z.ZodNumber;
        }, z.core.$strip>>>;
    }, z.core.$strip>, z.ZodObject<{
        sessionId: z.ZodString;
        url: z.ZodString;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, Record<never, never>>, Record<never, never>>;
    verifyWebhook: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        body: z.ZodString;
        signature: z.ZodString;
        timestamp: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        received: z.ZodBoolean;
        eventType: z.ZodOptional<z.ZodString>;
        orderId: z.ZodOptional<z.ZodString>;
        sessionId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, Record<never, never>>, Record<never, never>>;
    getSession: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        sessionId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        session: z.ZodObject<{
            id: z.ZodString;
            status: z.ZodString;
            paymentStatus: z.ZodString;
            amountTotal: z.ZodOptional<z.ZodNumber>;
            currency: z.ZodOptional<z.ZodString>;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strip>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, Record<never, never>>, Record<never, never>>;
};
export type PaymentContractType = typeof PaymentContract;
export type ContractType = typeof PaymentContract;
