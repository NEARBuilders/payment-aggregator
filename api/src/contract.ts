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
  fees: z
    .array(
      z.object({
        type: z.string(),
        label: z.string(),
        recipient: z.string(),
        bps: z.number(),
      }),
    )
    .optional(),
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

const AmountSchema = z
  .string()
  .regex(/^\d+$/, "integer string in the currency's smallest unit (yoctoNEAR, cents)");

const PlanPeriodSchema = z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]);

const SubscriptionStatusSchema = z.enum([
  "active",
  "cancel_at_period_end",
  "pending_unstake",
  "ended",
  "none",
]);

const PlanSchema = z
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

const SubscriptionSchema = z.object({
  id: z.string().optional(),
  planId: z.string(),
  status: SubscriptionStatusSchema,
  amount: AmountSchema.optional(),
  currency: z.string().optional(),
  currentPeriodEnd: z.string().datetime().optional(),
  payerRef: z.string(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const WalletFunctionCallSchema = z.object({
  methodName: z.string(),
  args: z.record(z.string(), z.unknown()),
  deposit: AmountSchema,
  gas: z.string().regex(/^\d+$/),
});

const SubscriptionActionSchema = z.discriminatedUnion("kind", [
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

const CreateSubscriptionInputSchema = z.object({
  planId: z.string(),
  amount: AmountSchema.optional(),
  payerRef: z.string().optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const contract = oc.router({
  ping: oc.route({ method: "GET", path: "/ping" }).output(
    z.object({
      status: z.literal("ok"),
      timestamp: z.iso.datetime(),
    }),
  ),

  paymentProviders: oc.route({ method: "GET", path: "/payments/providers" }).output(
    z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        logo: z.string(),
        description: z.string(),
      }),
    ),
  ),

  paymentCheckout: oc
    .route({ method: "POST", path: "/payments/checkout" })
    .input(CheckoutSessionInputSchema.extend({ provider: z.string() }))
    .output(CheckoutSessionOutputSchema),

  paymentWebhook: oc
    .route({ method: "POST", path: "/payments/webhook/{provider}" })
    .input(WebhookInputSchema.extend({ provider: z.string() }))
    .output(WebhookOutputSchema),

  paymentSession: oc
    .route({ method: "GET", path: "/payments/sessions/{provider}/{sessionId}" })
    .input(GetSessionInputSchema.extend({ provider: z.string() }))
    .output(GetSessionOutputSchema),

  subscriptionProviders: oc.route({ method: "GET", path: "/subscriptions/providers" }).output(
    z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        logo: z.string(),
        description: z.string(),
      }),
    ),
  ),

  subscriptionPlans: oc
    .route({ method: "GET", path: "/subscriptions/{provider}/plans" })
    .input(z.object({ provider: z.string() }))
    .output(z.array(PlanSchema)),

  subscriptionCreate: oc
    .route({ method: "POST", path: "/subscriptions/{provider}" })
    .input(CreateSubscriptionInputSchema.extend({ provider: z.string() }))
    .output(SubscriptionActionSchema),

  subscriptionGet: oc
    .route({ method: "GET", path: "/subscriptions/{provider}/status" })
    .input(
      z.object({
        provider: z.string(),
        planId: z.string(),
        payerRef: z.string().optional(),
      }),
    )
    .output(SubscriptionSchema),

  subscriptionCancel: oc
    .route({ method: "POST", path: "/subscriptions/{provider}/cancel" })
    .input(
      z.object({
        provider: z.string(),
        planId: z.string(),
        payerRef: z.string().optional(),
      }),
    )
    .output(SubscriptionActionSchema),

  subscriptionResume: oc
    .route({ method: "POST", path: "/subscriptions/{provider}/resume" })
    .input(
      z.object({
        provider: z.string(),
        planId: z.string(),
        payerRef: z.string().optional(),
      }),
    )
    .output(SubscriptionActionSchema),

  subscriptionChange: oc
    .route({ method: "POST", path: "/subscriptions/{provider}/change" })
    .input(
      z.object({
        provider: z.string(),
        planId: z.string(),
        newPlanId: z.string(),
        amount: AmountSchema.optional(),
        payerRef: z.string().optional(),
      }),
    )
    .output(SubscriptionActionSchema),
});

export type ContractType = typeof contract;
