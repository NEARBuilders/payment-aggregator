import { oc } from "every-plugin/orpc";
import { z } from "every-plugin/zod";

const PaymentLineItemSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  image: z.string().optional(),
  unitAmount: z.number().positive(),
  quantity: z.number().int().positive(),
});

const CheckoutSessionInputSchema = z.object({
  orderId: z.string(),
  amount: z.number().positive(),
  currency: z.string().default("USD"),
  items: z.array(PaymentLineItemSchema),
  customerEmail: z.string().email().optional(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  metadata: z.record(z.string(), z.string()).optional(),
  fees: z.array(z.object({
    type: z.string(),
    label: z.string(),
    recipient: z.string(),
    bps: z.number(),
  })).optional(),
});

const CheckoutSessionOutputSchema = z.object({
  sessionId: z.string(),
  url: z.string().url(),
});

const WebhookInputSchema = z.object({
  body: z.string(),
  signature: z.string(),
  timestamp: z.string().optional(),
});

const WebhookOutputSchema = z.object({
  received: z.boolean(),
  eventType: z.string().optional(),
  orderId: z.string().optional(),
  sessionId: z.string().optional(),
});

const GetSessionInputSchema = z.object({
  sessionId: z.string(),
});

const GetSessionOutputSchema = z.object({
  session: z.object({
    id: z.string(),
    status: z.string(),
    paymentStatus: z.string(),
    amountTotal: z.number().optional(),
    currency: z.string().optional(),
    metadata: z.record(z.string(), z.string()).optional(),
  }),
});

export const contract = oc.router({
  ping: oc.route({ method: "GET", path: "/ping" }).output(
    z.object({
      status: z.literal("ok"),
      timestamp: z.iso.datetime(),
    }),
  ),

  stripePing: oc
    .route({ method: "GET", path: "/payments/stripe/ping" })
    .output(z.object({
      provider: z.string(),
      status: z.literal("ok"),
      timestamp: z.string().datetime(),
    })),

  stripeCreateCheckout: oc
    .route({ method: "POST", path: "/payments/stripe/checkout" })
    .input(CheckoutSessionInputSchema)
    .output(CheckoutSessionOutputSchema),

  stripeVerifyWebhook: oc
    .route({ method: "POST", path: "/payments/stripe/webhook" })
    .input(WebhookInputSchema)
    .output(WebhookOutputSchema),

  stripeGetSession: oc
    .route({ method: "GET", path: "/payments/stripe/sessions/{sessionId}" })
    .input(GetSessionInputSchema)
    .output(GetSessionOutputSchema),

  pingpayPing: oc
    .route({ method: "GET", path: "/payments/pingpay/ping" })
    .output(z.object({
      provider: z.string(),
      status: z.literal("ok"),
      timestamp: z.string().datetime(),
    })),

  pingpayCreateCheckout: oc
    .route({ method: "POST", path: "/payments/pingpay/checkout" })
    .input(CheckoutSessionInputSchema)
    .output(CheckoutSessionOutputSchema),

  pingpayVerifyWebhook: oc
    .route({ method: "POST", path: "/payments/pingpay/webhook" })
    .input(WebhookInputSchema)
    .output(WebhookOutputSchema),

  pingpayGetSession: oc
    .route({ method: "GET", path: "/payments/pingpay/sessions/{sessionId}" })
    .input(GetSessionInputSchema)
    .output(GetSessionOutputSchema),
});

export type ContractType = typeof contract;
