import { Cause, Effect, Exit, Option } from "every-plugin/effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pricesList: vi.fn(),
  sessionsCreate: vi.fn(),
  subscriptionsRetrieve: vi.fn(),
  subscriptionsList: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  customersList: vi.fn(),
}));

vi.mock("stripe", () => {
  const mockInstance = {
    prices: { list: mocks.pricesList },
    checkout: { sessions: { create: mocks.sessionsCreate } },
    subscriptions: {
      retrieve: mocks.subscriptionsRetrieve,
      list: mocks.subscriptionsList,
      update: mocks.subscriptionsUpdate,
    },
    customers: { list: mocks.customersList },
  };

  function MockStripe(..._args: any[]) {
    return mockInstance;
  }

  return {
    default: MockStripe,
  };
});

import {
  PlanNotFoundError,
  StripeSubscriptionService,
  SubscriptionNotFoundError,
} from "@/subscription-service";

const PERIOD_END = 1_800_000_000;
const PERIOD_END_ISO = new Date(PERIOD_END * 1000).toISOString();

const stripeError = (code: string, message: string) => Object.assign(new Error(message), { code });

const makeSubscription = (overrides: Record<string, unknown> = {}) => ({
  id: "sub_123",
  customer: "cus_1",
  status: "active",
  cancel_at_period_end: false,
  created: 1_700_000_000,
  current_period_end: PERIOD_END,
  items: {
    data: [
      {
        id: "si_1",
        price: { id: "price_monthly", unit_amount: 1500, currency: "usd" },
      },
    ],
  },
  ...overrides,
});

const makeService = (options?: { catalogTtlMs?: number; now?: () => number }) =>
  new StripeSubscriptionService("sk_test_mock", options);

const failureOf = async (effect: Effect.Effect<unknown, unknown>) => {
  const exit = await Effect.runPromiseExit(effect);
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    return Option.getOrThrow(Cause.failureOption(exit.cause));
  }
  throw new Error("expected failure");
};

beforeEach(() => {
  mocks.pricesList.mockReset();
  mocks.sessionsCreate.mockReset();
  mocks.subscriptionsRetrieve.mockReset();
  mocks.subscriptionsList.mockReset();
  mocks.subscriptionsUpdate.mockReset();
  mocks.customersList.mockReset();
});

describe("StripeSubscriptionService", () => {
  describe("listPlans", () => {
    it("maps recurring prices to plans and filters unusable prices", async () => {
      mocks.pricesList.mockResolvedValue({
        data: [
          {
            id: "price_monthly",
            nickname: null,
            unit_amount: 1500,
            currency: "usd",
            recurring: { interval: "month", interval_count: 1 },
            product: { id: "prod_1", name: "Pro", description: "Pro tier", active: true },
          },
          {
            id: "price_yearly",
            nickname: "Annual",
            unit_amount: 15000,
            currency: "usd",
            recurring: { interval: "year", interval_count: 1 },
            product: { id: "prod_1", name: "Pro", description: "Pro tier", active: true },
          },
          {
            id: "price_quarterly",
            nickname: null,
            unit_amount: 4000,
            currency: "usd",
            recurring: { interval: "month", interval_count: 3 },
            product: { id: "prod_2", name: "Team", active: true },
          },
          {
            id: "price_metered",
            nickname: null,
            unit_amount: null,
            currency: "usd",
            recurring: { interval: "month", interval_count: 1 },
            product: { id: "prod_1", name: "Pro", active: true },
          },
          {
            id: "price_unexpanded",
            nickname: null,
            unit_amount: 500,
            currency: "usd",
            recurring: { interval: "month", interval_count: 1 },
            product: "prod_3",
          },
        ],
      });

      const plans = await Effect.runPromise(makeService().listPlans());

      expect(mocks.pricesList).toHaveBeenCalledWith({
        active: true,
        type: "recurring",
        expand: ["data.product"],
        limit: 100,
      });

      expect(plans).toEqual([
        {
          id: "price_monthly",
          name: "Pro",
          description: "Pro tier",
          period: "monthly",
          currency: "USD",
          minAmount: "1500",
          maxAmount: "1500",
          metadata: { productId: "prod_1" },
        },
        {
          id: "price_yearly",
          name: "Pro (Annual)",
          description: "Pro tier",
          period: "yearly",
          currency: "USD",
          minAmount: "15000",
          maxAmount: "15000",
          metadata: { productId: "prod_1" },
        },
        {
          id: "price_quarterly",
          name: "Team",
          period: "quarterly",
          currency: "USD",
          minAmount: "4000",
          maxAmount: "4000",
          metadata: { productId: "prod_2" },
        },
      ]);
    });

    it("caches the catalog and refreshes after the TTL", async () => {
      mocks.pricesList.mockResolvedValue({ data: [] });
      let nowMs = 1_000_000;
      const service = makeService({ catalogTtlMs: 60_000, now: () => nowMs });

      await Effect.runPromise(service.listPlans());
      nowMs += 30_000;
      await Effect.runPromise(service.listPlans());
      expect(mocks.pricesList).toHaveBeenCalledTimes(1);

      nowMs += 60_001;
      await Effect.runPromise(service.listPlans());
      expect(mocks.pricesList).toHaveBeenCalledTimes(2);
    });
  });

  describe("createSubscription", () => {
    it("creates a subscription-mode checkout session and returns a redirect action", async () => {
      mocks.sessionsCreate.mockResolvedValue({
        id: "cs_sub_123",
        url: "https://checkout.stripe.com/pay/cs_sub_123",
      });

      const result = await Effect.runPromise(
        makeService().createSubscription({
          planId: "price_monthly",
          payerRef: "alice@example.com",
          successUrl: "https://example.com/success",
          cancelUrl: "https://example.com/cancel",
        }),
      );

      expect(mocks.sessionsCreate).toHaveBeenCalledWith({
        mode: "subscription",
        line_items: [{ price: "price_monthly", quantity: 1 }],
        customer_email: "alice@example.com",
        success_url: "https://example.com/success",
        cancel_url: "https://example.com/cancel",
        metadata: undefined,
      });

      expect(result).toEqual({
        kind: "redirect",
        url: "https://checkout.stripe.com/pay/cs_sub_123",
      });
    });

    it("omits customer_email when payerRef is absent", async () => {
      mocks.sessionsCreate.mockResolvedValue({
        id: "cs_sub_456",
        url: "https://checkout.stripe.com/pay/cs_sub_456",
      });

      await Effect.runPromise(makeService().createSubscription({ planId: "price_monthly" }));

      expect(mocks.sessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ customer_email: undefined }),
      );
    });

    it("fails with PlanNotFoundError for an unknown plan", async () => {
      mocks.sessionsCreate.mockRejectedValue(stripeError("resource_missing", "No such price"));

      const failure = await failureOf(
        makeService().createSubscription({ planId: "price_missing" }),
      );

      expect(failure).toBeInstanceOf(PlanNotFoundError);
    });
  });

  describe("getSubscription", () => {
    it("retrieves directly when payerRef is a subscription id", async () => {
      mocks.subscriptionsRetrieve.mockResolvedValue(makeSubscription());

      const result = await Effect.runPromise(
        makeService().getSubscription("price_monthly", "sub_123"),
      );

      expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith("sub_123");
      expect(mocks.customersList).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: "sub_123",
        planId: "price_monthly",
        status: "active",
        amount: "1500",
        currency: "USD",
        currentPeriodEnd: PERIOD_END_ISO,
        payerRef: "sub_123",
        metadata: { customerId: "cus_1" },
      });
    });

    it("resolves by customer email and picks the most recently created match", async () => {
      mocks.customersList.mockResolvedValue({ data: [{ id: "cus_1" }, { id: "cus_2" }] });
      mocks.subscriptionsList
        .mockResolvedValueOnce({
          data: [makeSubscription({ id: "sub_old", created: 1_600_000_000 })],
        })
        .mockResolvedValueOnce({
          data: [makeSubscription({ id: "sub_new", created: 1_750_000_000, customer: "cus_2" })],
        });

      const result = await Effect.runPromise(
        makeService().getSubscription("price_monthly", "alice@example.com"),
      );

      expect(mocks.customersList).toHaveBeenCalledWith({
        email: "alice@example.com",
        limit: 100,
      });
      expect(mocks.subscriptionsList).toHaveBeenCalledWith({
        customer: "cus_1",
        price: "price_monthly",
        status: "all",
        limit: 100,
      });
      expect(result.id).toBe("sub_new");
      expect(result.payerRef).toBe("alice@example.com");
      expect(result.metadata).toEqual({ customerId: "cus_2" });
    });

    it.each([
      ["active", false, "active"],
      ["trialing", false, "active"],
      ["active", true, "cancel_at_period_end"],
      ["trialing", true, "cancel_at_period_end"],
      ["canceled", false, "ended"],
      ["incomplete_expired", false, "ended"],
      ["unpaid", false, "ended"],
      ["incomplete", false, "ended"],
    ])("maps stripe status %s (cancel_at_period_end=%s) to %s", async (status, capa, expected) => {
      mocks.subscriptionsRetrieve.mockResolvedValue(
        makeSubscription({ status, cancel_at_period_end: capa }),
      );

      const result = await Effect.runPromise(
        makeService().getSubscription("price_monthly", "sub_123"),
      );

      expect(result.status).toBe(expected);
    });

    it("returns status none when no customer subscription matches", async () => {
      mocks.customersList.mockResolvedValue({ data: [{ id: "cus_1" }] });
      mocks.subscriptionsList.mockResolvedValue({ data: [] });

      const result = await Effect.runPromise(
        makeService().getSubscription("price_monthly", "alice@example.com"),
      );

      expect(result).toEqual({
        planId: "price_monthly",
        status: "none",
        payerRef: "alice@example.com",
      });
    });

    it("returns status none when the subscription id does not exist", async () => {
      mocks.subscriptionsRetrieve.mockRejectedValue(
        stripeError("resource_missing", "No such subscription"),
      );

      const result = await Effect.runPromise(
        makeService().getSubscription("price_monthly", "sub_missing"),
      );

      expect(result).toEqual({
        planId: "price_monthly",
        status: "none",
        payerRef: "sub_missing",
      });
    });
  });

  describe("cancelSubscription", () => {
    it("sets cancel_at_period_end and returns an executed action", async () => {
      mocks.subscriptionsRetrieve.mockResolvedValue(makeSubscription());
      mocks.subscriptionsUpdate.mockResolvedValue(makeSubscription({ cancel_at_period_end: true }));

      const result = await Effect.runPromise(
        makeService().cancelSubscription("price_monthly", "sub_123"),
      );

      expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith("sub_123", {
        cancel_at_period_end: true,
      });
      expect(result.kind).toBe("executed");
      if (result.kind === "executed") {
        expect(result.subscription.status).toBe("cancel_at_period_end");
      }
    });

    it("fails with SubscriptionNotFoundError when nothing is found", async () => {
      mocks.customersList.mockResolvedValue({ data: [] });

      const failure = await failureOf(
        makeService().cancelSubscription("price_monthly", "alice@example.com"),
      );

      expect(failure).toBeInstanceOf(SubscriptionNotFoundError);
      expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled();
    });
  });

  describe("resumeSubscription", () => {
    it("clears cancel_at_period_end and returns an executed action", async () => {
      mocks.subscriptionsRetrieve.mockResolvedValue(
        makeSubscription({ cancel_at_period_end: true }),
      );
      mocks.subscriptionsUpdate.mockResolvedValue(makeSubscription());

      const result = await Effect.runPromise(
        makeService().resumeSubscription("price_monthly", "sub_123"),
      );

      expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith("sub_123", {
        cancel_at_period_end: false,
      });
      expect(result.kind).toBe("executed");
      if (result.kind === "executed") {
        expect(result.subscription.status).toBe("active");
      }
    });
  });

  describe("changePlan", () => {
    it("swaps the subscription item to the new price", async () => {
      mocks.subscriptionsRetrieve.mockResolvedValue(makeSubscription());
      mocks.subscriptionsUpdate.mockResolvedValue(
        makeSubscription({
          items: {
            data: [
              {
                id: "si_1",
                price: { id: "price_yearly", unit_amount: 15000, currency: "usd" },
              },
            ],
          },
        }),
      );

      const result = await Effect.runPromise(
        makeService().changePlan({
          planId: "price_monthly",
          newPlanId: "price_yearly",
          payerRef: "sub_123",
        }),
      );

      expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith("sub_123", {
        items: [{ id: "si_1", price: "price_yearly" }],
      });
      expect(result.kind).toBe("executed");
      if (result.kind === "executed") {
        expect(result.subscription.planId).toBe("price_yearly");
        expect(result.subscription.amount).toBe("15000");
      }
    });

    it("fails with PlanNotFoundError for an unknown target plan", async () => {
      mocks.subscriptionsRetrieve.mockResolvedValue(makeSubscription());
      mocks.subscriptionsUpdate.mockRejectedValue(stripeError("resource_missing", "No such price"));

      const failure = await failureOf(
        makeService().changePlan({
          planId: "price_monthly",
          newPlanId: "price_missing",
          payerRef: "sub_123",
        }),
      );

      expect(failure).toBeInstanceOf(PlanNotFoundError);
    });
  });
});
