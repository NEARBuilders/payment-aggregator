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
import {
  CancelSubscriptionInputSchema,
  ChangePlanInputSchema,
  CreateSubscriptionInputSchema,
  GetSubscriptionInputSchema,
  ListPlansOutputSchema,
  ResumeSubscriptionInputSchema,
  SubscriptionActionSchema,
  SubscriptionSchema,
} from "./subscription-schema";

const metadata = oc.route({ method: "GET", path: "/metadata" }).output(
  z.object({
    name: z.string(),
    logo: z.string(),
    description: z.string(),
  }),
);

const ping = oc.route({ method: "GET", path: "/ping" }).output(
  z.object({
    provider: z.string(),
    status: z.literal("ok"),
    timestamp: z.string().datetime(),
  }),
);

const paymentProcedures = {
  metadata,
  ping,

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
};

const subscriptionProcedures = {
  metadata,
  ping,

  listPlans: oc
    .route({ method: "GET", path: "/subscriptions/plans" })
    .output(ListPlansOutputSchema),

  createSubscription: oc
    .route({ method: "POST", path: "/subscriptions" })
    .input(CreateSubscriptionInputSchema)
    .output(SubscriptionActionSchema),

  getSubscription: oc
    .route({ method: "GET", path: "/subscriptions/status" })
    .input(GetSubscriptionInputSchema)
    .output(SubscriptionSchema),

  cancelSubscription: oc
    .route({ method: "POST", path: "/subscriptions/cancel" })
    .input(CancelSubscriptionInputSchema)
    .output(SubscriptionActionSchema),

  resumeSubscription: oc
    .route({ method: "POST", path: "/subscriptions/resume" })
    .input(ResumeSubscriptionInputSchema)
    .output(SubscriptionActionSchema),

  changePlan: oc
    .route({ method: "POST", path: "/subscriptions/change" })
    .input(ChangePlanInputSchema)
    .output(SubscriptionActionSchema),
};

export const PaymentContract = oc.router(paymentProcedures);

export const SubscriptionContract = oc.router(subscriptionProcedures);

export const StripeContract = oc.router({
  ...paymentProcedures,
  ...subscriptionProcedures,
});

export type PaymentContractType = typeof PaymentContract;
export type SubscriptionContractType = typeof SubscriptionContract;
export type StripeContractType = typeof StripeContract;
export type ContractType = typeof StripeContract;
