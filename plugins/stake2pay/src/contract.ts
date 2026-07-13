import { oc } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import {
  CancelSubscriptionInputSchema,
  ChangePlanInputSchema,
  CreateSubscriptionInputSchema,
  GetSubscriptionInputSchema,
  ListPlansOutputSchema,
  ResumeSubscriptionInputSchema,
  SubscriptionActionSchema,
  SubscriptionSchema,
} from "./schema";

// metadata and ping mirror PaymentContract exactly so a plugin can implement
// both contracts in one merged router and discovery can probe either the same way.
// Subscription route paths must never collide with PaymentContract paths
// (/checkout, /webhook, /sessions/{sessionId}).
export const SubscriptionContract = oc.router({
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
});

export type SubscriptionContractType = typeof SubscriptionContract;
export type ContractType = typeof SubscriptionContract;
