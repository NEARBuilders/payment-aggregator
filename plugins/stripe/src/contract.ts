import { oc } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import {
  CheckoutSessionInputSchema,
  CheckoutSessionOutputSchema,
  GetSessionInputSchema,
  GetSessionOutputSchema,
  WebhookInputSchema,
  WebhookOutputSchema,
} from "./schema";

export const PaymentContract = oc.router({
  metadata: oc.route({ method: "GET", path: "/metadata" }).output(
    z.object({
      name: z.string(),
      logo: z.string(),
      description: z.string(),
    }),
  ),

  ping: oc.route({ method: "GET", path: "/ping" }).output(
    z.object({
      provider: z.string(),
      status: z.literal("ok"),
      timestamp: z.string().datetime(),
    }),
  ),

  createCheckout: oc
    .route({ method: "POST", path: "/checkout" })
    .input(CheckoutSessionInputSchema)
    .output(CheckoutSessionOutputSchema),

  verifyWebhook: oc
    .route({ method: "POST", path: "/webhook" })
    .input(WebhookInputSchema)
    .output(WebhookOutputSchema),

  getSession: oc
    .route({ method: "GET", path: "/sessions/{sessionId}" })
    .input(GetSessionInputSchema)
    .output(GetSessionOutputSchema),
});

export type PaymentContractType = typeof PaymentContract;
export type ContractType = typeof PaymentContract;
