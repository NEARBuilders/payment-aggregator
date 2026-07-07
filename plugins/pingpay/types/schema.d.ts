import { z } from "every-plugin/zod";
export declare const FeeConfigSchema: z.ZodObject<{
    type: z.ZodString;
    label: z.ZodString;
    recipient: z.ZodString;
    bps: z.ZodNumber;
}, z.core.$strip>;
export declare const PaymentLineItemSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    image: z.ZodOptional<z.ZodString>;
    unitAmount: z.ZodNumber;
    quantity: z.ZodNumber;
}, z.core.$strip>;
export declare const CheckoutSessionInputSchema: z.ZodObject<{
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
}, z.core.$strip>;
export declare const CheckoutSessionOutputSchema: z.ZodObject<{
    sessionId: z.ZodString;
    url: z.ZodString;
}, z.core.$strip>;
export declare const WebhookInputSchema: z.ZodObject<{
    body: z.ZodString;
    signature: z.ZodString;
    timestamp: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const WebhookOutputSchema: z.ZodObject<{
    received: z.ZodBoolean;
    eventType: z.ZodOptional<z.ZodString>;
    orderId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const GetSessionInputSchema: z.ZodObject<{
    sessionId: z.ZodString;
}, z.core.$strip>;
export declare const GetSessionOutputSchema: z.ZodObject<{
    session: z.ZodObject<{
        id: z.ZodString;
        status: z.ZodString;
        paymentStatus: z.ZodString;
        amountTotal: z.ZodOptional<z.ZodNumber>;
        currency: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const PingWebhookPayloadSchema: z.ZodObject<{
    type: z.ZodEnum<{
        "payment.success": "payment.success";
        "payment.failed": "payment.failed";
        "checkout.session.completed": "checkout.session.completed";
    }>;
    sessionId: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodObject<{
        orderId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    data: z.ZodOptional<z.ZodObject<{
        sessionId: z.ZodOptional<z.ZodString>;
        paymentId: z.ZodOptional<z.ZodString>;
        status: z.ZodOptional<z.ZodString>;
        amount: z.ZodOptional<z.ZodString>;
        assetId: z.ZodOptional<z.ZodString>;
        payerAddress: z.ZodOptional<z.ZodString>;
        recipientAddress: z.ZodOptional<z.ZodString>;
        merchantId: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const PingWebhookResultSchema: z.ZodObject<{
    eventType: z.ZodString;
    orderId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type FeeConfig = z.infer<typeof FeeConfigSchema>;
export type PaymentLineItem = z.infer<typeof PaymentLineItemSchema>;
export type CheckoutSessionInput = z.infer<typeof CheckoutSessionInputSchema>;
export type CheckoutSessionOutput = z.infer<typeof CheckoutSessionOutputSchema>;
export type WebhookInput = z.infer<typeof WebhookInputSchema>;
export type WebhookOutput = z.infer<typeof WebhookOutputSchema>;
export type GetSessionInput = z.infer<typeof GetSessionInputSchema>;
export type GetSessionOutput = z.infer<typeof GetSessionOutputSchema>;
export type PingWebhookPayload = z.infer<typeof PingWebhookPayloadSchema>;
export type PingWebhookResult = z.infer<typeof PingWebhookResultSchema>;
