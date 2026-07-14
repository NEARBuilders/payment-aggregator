import { createPlugin } from "every-plugin";
import { Cause, Effect, Exit, Option } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import { StripeContract } from "./contract";
import { StripePaymentService } from "./service";
import { StripeSubscriptionService } from "./subscription-service";

const toORPCError = (error: { _tag?: string; message: string }) => {
  switch (error._tag) {
    case "PlanNotFoundError":
    case "SubscriptionNotFoundError":
      return new ORPCError("NOT_FOUND", { message: error.message });
    case "StripeApiError":
      return new ORPCError("SERVICE_UNAVAILABLE", { message: error.message });
    default:
      return new ORPCError("INTERNAL_SERVER_ERROR", { message: error.message });
  }
};

const runSubscription = async <A>(
  effect: Effect.Effect<A, { _tag?: string; message: string }>,
): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) {
    throw toORPCError(failure.value);
  }
  throw new ORPCError("INTERNAL_SERVER_ERROR", { message: Cause.pretty(exit.cause) });
};

export default createPlugin({
  variables: z.object({
    baseUrl: z.string().optional(),
  }),

  secrets: z.object({
    STRIPE_SECRET_KEY: z.string(),
    STRIPE_WEBHOOK_SECRET: z.string(),
  }),

  contract: StripeContract,

  initialize: (config) =>
    Effect.sync(() => {
      const service = new StripePaymentService(
        config.secrets.STRIPE_SECRET_KEY,
        config.secrets.STRIPE_WEBHOOK_SECRET,
      );

      const subscriptions = new StripeSubscriptionService(config.secrets.STRIPE_SECRET_KEY);

      console.log("[Stripe Plugin] Initialized successfully");

      return { service, subscriptions };
    }),

  shutdown: () => Effect.void,

  createRouter: (context, builder) => {
    const { service, subscriptions } = context;

    return {
      metadata: builder.metadata.handler(async () => ({
        name: "Stripe",
        logo: "/logos/stripe.svg",
        description: "Card payments and subscriptions via Stripe Checkout and Billing",
      })),

      ping: builder.ping.handler(async () => ({
        provider: "stripe",
        status: "ok" as const,
        timestamp: new Date().toISOString(),
      })),

      createCheckout: builder.createCheckout.handler(async ({ input }) => {
        return (await Effect.runPromise(service.createCheckout(input))) as any;
      }),

      verifyWebhook: builder.verifyWebhook.handler(async ({ input }) => {
        const result = (await Effect.runPromise(
          service.verifyWebhook(input.body, input.signature),
        )) as any;

        return {
          received: true,
          eventType: result.event.type,
          orderId: result.orderId,
          sessionId: result.sessionId,
        };
      }),

      getSession: builder.getSession.handler(async ({ input }) => {
        const session = (await Effect.runPromise(service.getSession(input.sessionId))) as any;

        return {
          session: {
            id: session.id,
            status: session.status || "unknown",
            paymentStatus: session.payment_status || "unknown",
            amountTotal: session.amount_total ?? undefined,
            currency: session.currency ?? undefined,
            metadata: session.metadata ?? undefined,
          },
        };
      }),

      listPlans: builder.listPlans.handler(async () => runSubscription(subscriptions.listPlans())),

      createSubscription: builder.createSubscription.handler(async ({ input }) =>
        runSubscription(subscriptions.createSubscription(input)),
      ),

      getSubscription: builder.getSubscription.handler(async ({ input }) =>
        runSubscription(subscriptions.getSubscription(input.planId, input.payerRef)),
      ),

      cancelSubscription: builder.cancelSubscription.handler(async ({ input }) =>
        runSubscription(subscriptions.cancelSubscription(input.planId, input.payerRef)),
      ),

      resumeSubscription: builder.resumeSubscription.handler(async ({ input }) =>
        runSubscription(subscriptions.resumeSubscription(input.planId, input.payerRef)),
      ),

      changePlan: builder.changePlan.handler(async ({ input }) =>
        runSubscription(subscriptions.changePlan(input)),
      ),
    };
  },
});

export { StripePaymentService } from "./service";
export {
  PlanNotFoundError,
  StripeApiError,
  StripeSubscriptionService,
  SubscriptionNotFoundError,
} from "./subscription-service";
