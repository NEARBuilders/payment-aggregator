import { Effect } from "every-plugin/effect";
import Stripe from "stripe";
import type { CheckoutSessionInput, CheckoutSessionOutput } from "./schema";

export class StripePaymentService {
  private stripe: any;
  private webhookSecret: string;

  constructor(secretKey: string, webhookSecret: string) {
    this.stripe = new (Stripe as any)(secretKey, {
      apiVersion: "2026-02-25.clover",
    });
    this.webhookSecret = webhookSecret;
  }

  createCheckout(input: CheckoutSessionInput): Effect.Effect<CheckoutSessionOutput, Error> {
    return Effect.tryPromise({
      try: async () => {
        const session = await this.stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: input.items.map((item: any) => ({
            price_data: {
              currency: input.currency.toLowerCase(),
              product_data: {
                name: item.name,
                description: item.description,
                images: item.image ? [item.image] : undefined,
              },
              unit_amount: item.unitAmount,
            },
            quantity: item.quantity,
          })),
          mode: "payment",
          success_url: `${input.successUrl}?sessionId={CHECKOUT_SESSION_ID}`,
          cancel_url: input.cancelUrl,
          customer_email: input.customerEmail,
          metadata: {
            orderId: input.orderId,
            ...input.metadata,
          },
        });

        return {
          sessionId: session.id,
          url: session.url!,
        };
      },
      catch: (error: unknown) =>
        new Error(
          `Stripe checkout failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
    });
  }

  verifyWebhook(body: string, signature: string) {
    return Effect.tryPromise({
      try: async () => {
        const event = (await this.stripe.webhooks.constructEventAsync(
          body,
          signature,
          this.webhookSecret,
        )) as any;

        const object = event.data?.object as any;
        let orderId: string | undefined;
        let sessionId: string | undefined;

        if (event.type === "checkout.session.completed") {
          orderId = object?.metadata?.orderId;
          sessionId = object?.id;
        } else if (event.type.startsWith("customer.subscription.")) {
          orderId = object?.metadata?.orderId;
          sessionId = object?.id;
        } else if (event.type.startsWith("invoice.")) {
          orderId = object?.metadata?.orderId;
          const subscriptionRef =
            object?.subscription ?? object?.parent?.subscription_details?.subscription;
          sessionId = typeof subscriptionRef === "string" ? subscriptionRef : subscriptionRef?.id;
        }

        return {
          event,
          orderId,
          sessionId,
        };
      },
      catch: (error: unknown) =>
        new Error(
          `Webhook verification failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
    });
  }

  getSession(sessionId: string) {
    return Effect.tryPromise({
      try: async () => {
        const session = (await this.stripe.checkout.sessions.retrieve(sessionId)) as any;
        return session;
      },
      catch: (error: unknown) =>
        new Error(
          `Failed to retrieve session: ${error instanceof Error ? error.message : String(error)}`,
        ),
    });
  }
}
