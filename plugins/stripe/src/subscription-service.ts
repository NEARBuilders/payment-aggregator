import { Data, Effect } from "every-plugin/effect";
import Stripe from "stripe";
import type {
  ChangePlanInput,
  CreateSubscriptionInput,
  Plan,
  Subscription,
  SubscriptionAction,
} from "./subscription-schema";

export class StripeApiError extends Data.TaggedError("StripeApiError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class PlanNotFoundError extends Data.TaggedError("PlanNotFoundError")<{
  readonly message: string;
  readonly planId: string;
}> {}

export class SubscriptionNotFoundError extends Data.TaggedError("SubscriptionNotFoundError")<{
  readonly message: string;
  readonly planId: string;
  readonly payerRef: string;
}> {}

type ServiceError = StripeApiError | PlanNotFoundError | SubscriptionNotFoundError;

const DEFAULT_CATALOG_TTL_MS = 60_000;

const PERIOD_BY_INTERVAL: Record<string, Plan["period"]> = {
  day: "daily",
  week: "weekly",
  month: "monthly",
  year: "yearly",
};

const periodFromRecurring = (recurring: any): Plan["period"] => {
  if (recurring?.interval === "month" && recurring?.interval_count === 3) {
    return "quarterly";
  }
  return PERIOD_BY_INTERVAL[recurring?.interval] ?? "monthly";
};

const toPlan = (price: any): Plan | null => {
  const product = price?.product;
  if (!product || typeof product === "string" || product.deleted || product.active === false) {
    return null;
  }
  if (typeof price.unit_amount !== "number" || !price.recurring) {
    return null;
  }
  const amount = String(price.unit_amount);
  return {
    id: price.id,
    name: price.nickname ? `${product.name} (${price.nickname})` : product.name,
    description: product.description ?? undefined,
    period: periodFromRecurring(price.recurring),
    currency: String(price.currency).toUpperCase(),
    minAmount: amount,
    maxAmount: amount,
    metadata: { productId: product.id },
  };
};

const mapStripeSubscription = (
  subscription: any,
  payerRef: string,
  planIdHint?: string,
): Subscription => {
  const items = subscription.items?.data ?? [];
  const item = items.find((entry: any) => entry?.price?.id === planIdHint) ?? items[0];
  const price = item?.price;

  let status: Subscription["status"];
  if (
    subscription.status === "active" ||
    subscription.status === "trialing" ||
    subscription.status === "past_due"
  ) {
    status = subscription.cancel_at_period_end ? "cancel_at_period_end" : "active";
  } else {
    status = "ended";
  }

  const periodEnd = subscription.current_period_end ?? item?.current_period_end;
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;

  return {
    id: subscription.id,
    planId: price?.id ?? planIdHint ?? "",
    status,
    amount: typeof price?.unit_amount === "number" ? String(price.unit_amount) : undefined,
    currency: price?.currency ? String(price.currency).toUpperCase() : undefined,
    currentPeriodEnd:
      typeof periodEnd === "number" ? new Date(periodEnd * 1000).toISOString() : undefined,
    payerRef,
    metadata: customerId ? { customerId } : undefined,
  };
};

const isResourceMissing = (error: unknown): boolean =>
  (error as { code?: string } | null)?.code === "resource_missing";

export class StripeSubscriptionService {
  private stripe: any;
  private catalogTtlMs: number;
  private now: () => number;
  private plansCache: { at: number; plans: Plan[] } | null = null;

  constructor(secretKey: string, options?: { catalogTtlMs?: number; now?: () => number }) {
    this.stripe = new (Stripe as any)(secretKey, {
      apiVersion: "2026-02-25.clover",
    });
    this.catalogTtlMs = options?.catalogTtlMs ?? DEFAULT_CATALOG_TTL_MS;
    this.now = options?.now ?? Date.now;
  }

  private run<A>(f: () => Promise<A>): Effect.Effect<A, ServiceError> {
    return Effect.tryPromise({
      try: f,
      catch: (error) =>
        error instanceof PlanNotFoundError ||
        error instanceof SubscriptionNotFoundError ||
        error instanceof StripeApiError
          ? error
          : new StripeApiError({
              message: error instanceof Error ? error.message : String(error),
              cause: error,
            }),
    });
  }

  private async findStripeSubscription(planId: string, payerRef: string): Promise<any | null> {
    if (payerRef.startsWith("sub_")) {
      try {
        return await this.stripe.subscriptions.retrieve(payerRef);
      } catch (error) {
        if (isResourceMissing(error)) return null;
        throw error;
      }
    }

    const customers = await this.stripe.customers.list({ email: payerRef, limit: 100 });
    const matches: any[] = [];
    for (const customer of customers.data ?? []) {
      const subscriptions = await this.stripe.subscriptions.list({
        customer: customer.id,
        price: planId,
        status: "all",
        limit: 100,
      });
      matches.push(...(subscriptions.data ?? []));
    }

    if (matches.length === 0) return null;
    matches.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    return matches[0];
  }

  private async requireStripeSubscription(planId: string, payerRef: string): Promise<any> {
    const subscription = await this.findStripeSubscription(planId, payerRef);
    if (!subscription) {
      throw new SubscriptionNotFoundError({
        message: `No subscription for ${payerRef} on plan ${planId}`,
        planId,
        payerRef,
      });
    }
    return subscription;
  }

  listPlans(): Effect.Effect<Plan[], ServiceError> {
    return this.run(async () => {
      if (this.plansCache && this.now() - this.plansCache.at < this.catalogTtlMs) {
        return this.plansCache.plans;
      }

      const prices = await this.stripe.prices.list({
        active: true,
        type: "recurring",
        expand: ["data.product"],
        limit: 100,
      });

      const plans = ((prices.data ?? []) as any[])
        .map(toPlan)
        .filter((plan): plan is Plan => plan !== null);

      this.plansCache = { at: this.now(), plans };
      return plans;
    });
  }

  createSubscription(
    input: CreateSubscriptionInput,
  ): Effect.Effect<SubscriptionAction, ServiceError> {
    return this.run(async () => {
      let session: any;
      try {
        session = await this.stripe.checkout.sessions.create({
          mode: "subscription",
          line_items: [{ price: input.planId, quantity: 1 }],
          customer_email: input.payerRef,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          metadata: input.metadata,
        });
      } catch (error) {
        if (isResourceMissing(error)) {
          throw new PlanNotFoundError({
            message: `Unknown plan: ${input.planId}`,
            planId: input.planId,
          });
        }
        throw error;
      }

      if (!session.url) {
        throw new StripeApiError({ message: "Stripe did not return a checkout URL" });
      }

      return { kind: "redirect" as const, url: session.url };
    });
  }

  getSubscription(planId: string, payerRef: string): Effect.Effect<Subscription, ServiceError> {
    return this.run(async () => {
      const subscription = await this.findStripeSubscription(planId, payerRef);
      if (!subscription) {
        return { planId, status: "none" as const, payerRef };
      }
      return mapStripeSubscription(subscription, payerRef, planId);
    });
  }

  cancelSubscription(
    planId: string,
    payerRef: string,
  ): Effect.Effect<SubscriptionAction, ServiceError> {
    return this.run(async () => {
      const existing = await this.requireStripeSubscription(planId, payerRef);
      const updated = await this.stripe.subscriptions.update(existing.id, {
        cancel_at_period_end: true,
      });
      return {
        kind: "executed" as const,
        subscription: mapStripeSubscription(updated, payerRef, planId),
      };
    });
  }

  resumeSubscription(
    planId: string,
    payerRef: string,
  ): Effect.Effect<SubscriptionAction, ServiceError> {
    return this.run(async () => {
      const existing = await this.requireStripeSubscription(planId, payerRef);
      const updated = await this.stripe.subscriptions.update(existing.id, {
        cancel_at_period_end: false,
      });
      return {
        kind: "executed" as const,
        subscription: mapStripeSubscription(updated, payerRef, planId),
      };
    });
  }

  changePlan(input: ChangePlanInput): Effect.Effect<SubscriptionAction, ServiceError> {
    return this.run(async () => {
      const existing = await this.requireStripeSubscription(input.planId, input.payerRef);
      const items = existing.items?.data ?? [];
      const item = items.find((entry: any) => entry?.price?.id === input.planId) ?? items[0];
      if (!item) {
        throw new StripeApiError({
          message: `Subscription ${existing.id} has no items to update`,
        });
      }

      let updated: any;
      try {
        updated = await this.stripe.subscriptions.update(existing.id, {
          items: [{ id: item.id, price: input.newPlanId }],
        });
      } catch (error) {
        if (isResourceMissing(error)) {
          throw new PlanNotFoundError({
            message: `Unknown plan: ${input.newPlanId}`,
            planId: input.newPlanId,
          });
        }
        throw error;
      }

      return {
        kind: "executed" as const,
        subscription: mapStripeSubscription(updated, input.payerRef, input.newPlanId),
      };
    });
  }
}
