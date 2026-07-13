import { describe, expect, it } from "vitest";
import { SubscriptionContract } from "@/contract";
import {
  AmountSchema,
  CreateSubscriptionInputSchema,
  ListPlansOutputSchema,
  PlanSchema,
  SubscriptionActionSchema,
  SubscriptionSchema,
  SubscriptionStatusSchema,
} from "@/schema";

const YOCTO_1_NEAR = "1000000000000000000000000";
const YOCTO_10_NEAR = "10000000000000000000000000";
const YOCTO_40_NEAR = "40000000000000000000000000";
const YOCTO_400_NEAR = "400000000000000000000000000";

const hosStarterPlan = {
  id: "price_RjiajH4KEZ43w68DgY5xVaVU",
  name: "Starter",
  description: "Lock 1-10 NEAR",
  period: "monthly",
  currency: "NEAR",
  minAmount: YOCTO_1_NEAR,
  maxAmount: YOCTO_10_NEAR,
  metadata: { productId: "prod_5lklj46roIwKZK" },
};

const stripeMonthlyPlan = {
  id: "price_1QxYzAbCdEfGhIjK",
  name: "Pro Monthly",
  period: "monthly",
  currency: "USD",
  minAmount: "2999",
  maxAmount: "2999",
};

describe("AmountSchema", () => {
  it("accepts yocto amounts beyond Number.MAX_SAFE_INTEGER without precision loss", () => {
    const parsed = AmountSchema.parse(YOCTO_400_NEAR);
    expect(parsed).toBe(YOCTO_400_NEAR);
    expect(BigInt(parsed) > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it.each(["1.5", "1e24", "-1", "", "1 NEAR"])("rejects non-integer string %j", (value) => {
    expect(AmountSchema.safeParse(value).success).toBe(false);
  });
});

describe("PlanSchema", () => {
  it("round-trips an HoS range-priced plan", () => {
    const parsed = PlanSchema.parse(hosStarterPlan);
    expect(PlanSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(hosStarterPlan);
  });

  it("round-trips a Stripe fixed-price recurring plan (min == max)", () => {
    const parsed = PlanSchema.parse(stripeMonthlyPlan);
    expect(parsed.minAmount).toBe(parsed.maxAmount);
  });

  it("rejects a plan whose minAmount exceeds maxAmount", () => {
    const result = PlanSchema.safeParse({
      ...hosStarterPlan,
      minAmount: YOCTO_40_NEAR,
      maxAmount: YOCTO_10_NEAR,
    });
    expect(result.success).toBe(false);
  });

  it("parses the full HoS testnet tier catalog", () => {
    const catalog = [
      hosStarterPlan,
      {
        ...hosStarterPlan,
        id: "price_basic",
        name: "Basic",
        minAmount: YOCTO_10_NEAR,
        maxAmount: YOCTO_40_NEAR,
      },
      {
        ...hosStarterPlan,
        id: "price_pro",
        name: "Pro",
        minAmount: YOCTO_40_NEAR,
        maxAmount: YOCTO_400_NEAR,
      },
    ];
    expect(ListPlansOutputSchema.parse(catalog)).toHaveLength(3);
  });

  it("rejects an unknown period", () => {
    expect(PlanSchema.safeParse({ ...hosStarterPlan, period: "biweekly" }).success).toBe(false);
  });
});

describe("SubscriptionSchema", () => {
  it("parses an active on-chain subscription", () => {
    const subscription = SubscriptionSchema.parse({
      id: "sub_starter_alice",
      planId: hosStarterPlan.id,
      status: "active",
      amount: YOCTO_10_NEAR,
      currency: "NEAR",
      currentPeriodEnd: "2026-08-13T00:00:00.000Z",
      payerRef: "alice.testnet",
    });
    expect(subscription.status).toBe("active");
    expect(subscription.amount).toBe(YOCTO_10_NEAR);
  });

  it("parses a 'none' result with no id or amount for a fresh account", () => {
    const subscription = SubscriptionSchema.parse({
      planId: hosStarterPlan.id,
      status: "none",
      payerRef: "fresh-account.testnet",
    });
    expect(subscription.id).toBeUndefined();
  });

  it.each([
    "active",
    "cancel_at_period_end",
    "pending_unstake",
    "ended",
    "none",
  ])("accepts status %j", (status) => {
    expect(SubscriptionStatusSchema.parse(status)).toBe(status);
  });

  it("rejects an unknown status", () => {
    expect(SubscriptionStatusSchema.safeParse("paused").success).toBe(false);
  });
});

describe("SubscriptionActionSchema", () => {
  it("parses a multi-action wallet intent (storage_deposit + lock)", () => {
    const action = SubscriptionActionSchema.parse({
      kind: "wallet_intent",
      networkId: "testnet",
      contractId: "hos-e2e-0601144939.testnet",
      actions: [
        {
          methodName: "storage_deposit",
          args: { account_id: "alice.testnet" },
          deposit: "1250000000000000000000",
          gas: "30000000000000",
        },
        {
          methodName: "lock",
          args: { price_id: hosStarterPlan.id },
          deposit: YOCTO_10_NEAR,
          gas: "100000000000000",
        },
      ],
    });
    if (action.kind !== "wallet_intent") throw new Error("expected wallet_intent");
    expect(action.actions).toHaveLength(2);
    expect(action.actions[1]?.deposit).toBe(YOCTO_10_NEAR);
  });

  it("rejects a wallet intent with an empty actions array", () => {
    const result = SubscriptionActionSchema.safeParse({
      kind: "wallet_intent",
      networkId: "testnet",
      contractId: "hos-e2e-0601144939.testnet",
      actions: [],
    });
    expect(result.success).toBe(false);
  });

  it("parses a redirect action (Stripe Checkout)", () => {
    const action = SubscriptionActionSchema.parse({
      kind: "redirect",
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
    });
    expect(action.kind).toBe("redirect");
  });

  it("parses an executed action embedding the resulting subscription", () => {
    const action = SubscriptionActionSchema.parse({
      kind: "executed",
      subscription: {
        id: "sub_1QxYz",
        planId: stripeMonthlyPlan.id,
        status: "cancel_at_period_end",
        amount: "2999",
        currency: "USD",
        currentPeriodEnd: "2026-08-01T00:00:00.000Z",
        payerRef: "customer@example.com",
      },
    });
    if (action.kind !== "executed") throw new Error("expected executed");
    expect(action.subscription.status).toBe("cancel_at_period_end");
  });

  it("rejects an unknown action kind", () => {
    expect(SubscriptionActionSchema.safeParse({ kind: "noop" }).success).toBe(false);
  });
});

describe("CreateSubscriptionInputSchema", () => {
  it("accepts a wallet-provider input (amount, NEAR payerRef, no URLs)", () => {
    const input = CreateSubscriptionInputSchema.parse({
      planId: hosStarterPlan.id,
      amount: YOCTO_10_NEAR,
      payerRef: "alice.testnet",
    });
    expect(input.successUrl).toBeUndefined();
  });

  it("accepts a hosted-provider input (URLs, no amount for fixed plans)", () => {
    const input = CreateSubscriptionInputSchema.parse({
      planId: stripeMonthlyPlan.id,
      payerRef: "customer@example.com",
      successUrl: "https://pay.everything.dev/subscriptions?status=success",
      cancelUrl: "https://pay.everything.dev/subscriptions?status=cancel",
    });
    expect(input.amount).toBeUndefined();
  });
});

describe("SubscriptionContract", () => {
  it("exposes the full subscription surface", () => {
    expect(Object.keys(SubscriptionContract).sort()).toEqual(
      [
        "cancelSubscription",
        "changePlan",
        "createSubscription",
        "getSubscription",
        "listPlans",
        "metadata",
        "ping",
        "resumeSubscription",
      ].sort(),
    );
  });
});
