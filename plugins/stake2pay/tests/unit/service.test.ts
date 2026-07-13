import { Effect } from "every-plugin/effect";
import { describe, expect, it } from "vitest";
import type { ViewClient } from "@/client";
import { type Stake2PayConfig, Stake2PayService, Stake2PayServiceLive } from "@/service";

const CONTRACT_ID = "hos-e2e-0601144939.testnet";
const PRODUCT_ID = "prod_5lklj46roIwKZK";
const STARTER_PRICE_ID = "price_RjiajH4KEZ43w68DgY5xVaVU";
const BASIC_PRICE_ID = "price_h577VYQUEynPA3uQt1u1neGn";
const NOW_MS = 1_800_000_000_000;
const FUTURE_END_NS = String(BigInt(NOW_MS + 30 * 24 * 3600 * 1000) * 1_000_000n);
const PAST_END_NS = String(BigInt(NOW_MS - 24 * 3600 * 1000) * 1_000_000n);

const YOCTO_1_NEAR = "1000000000000000000000000";
const YOCTO_5_NEAR = "5000000000000000000000000";
const YOCTO_10_NEAR = "10000000000000000000000000";
const YOCTO_40_NEAR = "40000000000000000000000000";

const starterPrice = {
  price_id: STARTER_PRICE_ID,
  product_id: PRODUCT_ID,
  name: "Starter",
  description: "1 agent; stake range [1, 10] NEAR",
  amount: YOCTO_1_NEAR,
  price_type: "Recurring",
  billing_period: "Monthly",
  lock_factor_near_months: YOCTO_1_NEAR,
  metadata: { max_amount: YOCTO_10_NEAR, farm_reward_rate: null },
  status: "Active",
  usage_count: 11,
};

const basicPrice = {
  ...starterPrice,
  price_id: BASIC_PRICE_ID,
  name: "Basic",
  amount: YOCTO_10_NEAR,
  metadata: { max_amount: YOCTO_40_NEAR, farm_reward_rate: null },
};

const oneOffPrice = {
  ...starterPrice,
  price_id: "price_oneoff",
  name: "Credits",
  price_type: "OneOff",
  billing_period: null,
  metadata: null,
};

const archivedPrice = {
  ...starterPrice,
  price_id: "price_archived",
  status: "Archived",
};

const product = {
  product_id: PRODUCT_ID,
  validator_id: "mock-pool-0.hos-e2e-0601144939.testnet",
  name: "NEAR AI Agents",
  description: "Monthly agent hosting subscription tiers",
  status: "Active",
  created_ns: "1780305858303142485",
  price_ids: [STARTER_PRICE_ID, BASIC_PRICE_ID, "price_oneoff", "price_archived"],
  default_price_id: STARTER_PRICE_ID,
  usage_count: 25,
};

const chainConfig = {
  owner_account_id: CONTRACT_ID,
  min_storage_deposit: "10000000000000000000000",
  per_lock_storage_stake: "0",
  per_purchase_storage_stake: "0",
  min_lock_amount: YOCTO_1_NEAR,
};

const activeSubscription = {
  subscription_id: "sub_abc",
  account_id: "alice.testnet",
  product_id: PRODUCT_ID,
  price_id: STARTER_PRICE_ID,
  start_ns: "1780305858303142485",
  end_ns: FUTURE_END_NS,
  anchor_day: 1,
  last_lock_id: "lock_1",
  status: "Active",
  cancel_at_period_end: false,
  pending_update: null,
};

const activeLock = {
  lock_id: "lock_1",
  account_id: "alice.testnet",
  validator_id: "mock-pool-0.hos-e2e-0601144939.testnet",
  amount_near: YOCTO_5_NEAR,
  shares: "123",
  start_ns: "1780305858303142485",
  end_ns: FUTURE_END_NS,
  status: "Active",
};

const priceTable: Record<string, unknown> = {
  [STARTER_PRICE_ID]: starterPrice,
  [BASIC_PRICE_ID]: basicPrice,
  price_oneoff: oneOffPrice,
  price_archived: archivedPrice,
};

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

class FakeClient implements ViewClient {
  calls: Array<{ method: string; args: Record<string, unknown> }> = [];

  constructor(private readonly handlers: Handlers) {}

  async viewFunction<T>(
    _contractId: string,
    methodName: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    this.calls.push({ method: methodName, args });
    const handler = this.handlers[methodName];
    if (!handler) {
      throw new Error(`FakeClient: no handler for ${methodName}`);
    }
    return handler(args) as T;
  }

  callCount(method: string): number {
    return this.calls.filter((call) => call.method === method).length;
  }
}

const defaultHandlers: Handlers = {
  get_product: () => product,
  get_price: (args) => priceTable[args.price_id as string] ?? null,
  get_config: () => chainConfig,
  get_subscription_for_price: () => null,
  get_lock: () => null,
  storage_balance_of: () => null,
};

const makeService = (handlers: Handlers = {}, overrides: Partial<Stake2PayConfig> = {}) => {
  const client = new FakeClient({ ...defaultHandlers, ...handlers });
  const layer = Stake2PayServiceLive({
    networkId: "testnet",
    contractId: CONTRACT_ID,
    productId: PRODUCT_ID,
    client,
    now: () => NOW_MS,
    ...overrides,
  });
  return { client, layer };
};

const run = <A, E>(
  layer: ReturnType<typeof Stake2PayServiceLive>,
  f: (service: Effect.Effect.Success<typeof Stake2PayService>) => Effect.Effect<A, E>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* Stake2PayService;
      return yield* f(service);
    }).pipe(Effect.provide(layer)),
  );

const runError = <A, E extends { _tag: string }>(
  layer: ReturnType<typeof Stake2PayServiceLive>,
  f: (service: Effect.Effect.Success<typeof Stake2PayService>) => Effect.Effect<A, E>,
): Promise<E> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* Stake2PayService;
      return yield* f(service);
    }).pipe(Effect.flip, Effect.provide(layer)),
  );

describe("listPlans", () => {
  it("maps active recurring prices to range plans and filters one-off/archived", async () => {
    const { layer } = makeService();
    const plans = await run(layer, (s) => s.listPlans());

    expect(plans.map((plan) => plan.id)).toEqual([STARTER_PRICE_ID, BASIC_PRICE_ID]);
    expect(plans[0]).toMatchObject({
      name: "Starter",
      period: "monthly",
      currency: "NEAR",
      minAmount: YOCTO_1_NEAR,
      maxAmount: YOCTO_10_NEAR,
      metadata: { productId: PRODUCT_ID },
    });
  });

  it("falls back to a fixed amount when the price has no max_amount", async () => {
    const fixedPrice = { ...starterPrice, metadata: null };
    const { layer } = makeService({
      get_product: () => ({ ...product, price_ids: [STARTER_PRICE_ID] }),
      get_price: () => fixedPrice,
    });
    const plans = await run(layer, (s) => s.listPlans());
    expect(plans[0]?.maxAmount).toBe(plans[0]?.minAmount);
  });

  it("caches the catalog within the TTL", async () => {
    const { client, layer } = makeService();
    await run(layer, (s) => s.listPlans());
    await run(layer, (s) => s.listPlans());
    expect(client.callCount("get_product")).toBe(1);
  });
});

describe("getSubscription", () => {
  it("returns status none when the chain has no subscription", async () => {
    const { layer } = makeService();
    const subscription = await run(layer, (s) =>
      s.getSubscription(STARTER_PRICE_ID, "fresh.testnet"),
    );
    expect(subscription).toEqual({
      planId: STARTER_PRICE_ID,
      status: "none",
      payerRef: "fresh.testnet",
    });
  });

  it("maps an active subscription with the locked amount", async () => {
    const { layer } = makeService({
      get_subscription_for_price: () => activeSubscription,
      get_lock: () => activeLock,
    });
    const subscription = await run(layer, (s) =>
      s.getSubscription(STARTER_PRICE_ID, "alice.testnet"),
    );
    expect(subscription.status).toBe("active");
    expect(subscription.id).toBe("sub_abc");
    expect(subscription.amount).toBe(YOCTO_5_NEAR);
    expect(subscription.currentPeriodEnd).toBe(
      new Date(Number(BigInt(FUTURE_END_NS) / 1_000_000n)).toISOString(),
    );
  });

  it("maps cancel_at_period_end while the period is still running", async () => {
    const { layer } = makeService({
      get_subscription_for_price: () => ({ ...activeSubscription, cancel_at_period_end: true }),
      get_lock: () => activeLock,
    });
    const subscription = await run(layer, (s) =>
      s.getSubscription(STARTER_PRICE_ID, "alice.testnet"),
    );
    expect(subscription.status).toBe("cancel_at_period_end");
  });

  it("maps a cancelled subscription with an unstaking lock to pending_unstake", async () => {
    const { layer } = makeService({
      get_subscription_for_price: () => ({
        ...activeSubscription,
        status: "Cancelled",
        end_ns: PAST_END_NS,
      }),
      get_lock: () => ({ ...activeLock, status: "UnlockRequested" }),
    });
    const subscription = await run(layer, (s) =>
      s.getSubscription(STARTER_PRICE_ID, "alice.testnet"),
    );
    expect(subscription.status).toBe("pending_unstake");
  });

  it("maps an expired subscription with a withdrawn lock to ended", async () => {
    const { layer } = makeService({
      get_subscription_for_price: () => ({
        ...activeSubscription,
        status: "Expired",
        end_ns: PAST_END_NS,
      }),
      get_lock: () => ({ ...activeLock, status: "Withdrawn" }),
    });
    const subscription = await run(layer, (s) =>
      s.getSubscription(STARTER_PRICE_ID, "alice.testnet"),
    );
    expect(subscription.status).toBe("ended");
  });

  it("surfaces a deferred plan change in metadata", async () => {
    const { layer } = makeService({
      get_subscription_for_price: () => ({
        ...activeSubscription,
        pending_update: {
          target_price_id: BASIC_PRICE_ID,
          target_amount: YOCTO_10_NEAR,
          apply_ns: FUTURE_END_NS,
        },
      }),
      get_lock: () => activeLock,
    });
    const subscription = await run(layer, (s) =>
      s.getSubscription(STARTER_PRICE_ID, "alice.testnet"),
    );
    expect(subscription.metadata).toMatchObject({
      pendingTargetPlanId: BASIC_PRICE_ID,
      pendingTargetAmount: YOCTO_10_NEAR,
    });
  });
});

describe("createSubscription", () => {
  it("returns storage_deposit + lock intent for an unregistered payer", async () => {
    const { layer } = makeService();
    const action = await run(layer, (s) =>
      s.createSubscription({
        planId: STARTER_PRICE_ID,
        amount: YOCTO_5_NEAR,
        payerRef: "fresh.testnet",
      }),
    );

    if (action.kind !== "wallet_intent") throw new Error("expected wallet_intent");
    expect(action.networkId).toBe("testnet");
    expect(action.contractId).toBe(CONTRACT_ID);
    expect(action.actions).toHaveLength(2);
    expect(action.actions[0]).toMatchObject({
      methodName: "storage_deposit",
      args: { account_id: "fresh.testnet" },
      deposit: chainConfig.min_storage_deposit,
    });
    expect(action.actions[1]).toMatchObject({
      methodName: "lock",
      args: { price_id: STARTER_PRICE_ID, duration_ns: null },
      deposit: YOCTO_5_NEAR,
    });
  });

  it("omits the storage action for a registered payer when no per-lock stake is required", async () => {
    const { layer } = makeService({
      storage_balance_of: () => ({ total: "10000000000000000000000", available: "0" }),
    });
    const action = await run(layer, (s) =>
      s.createSubscription({
        planId: STARTER_PRICE_ID,
        amount: YOCTO_5_NEAR,
        payerRef: "alice.testnet",
      }),
    );
    if (action.kind !== "wallet_intent") throw new Error("expected wallet_intent");
    expect(action.actions).toHaveLength(1);
    expect(action.actions[0]?.methodName).toBe("lock");
  });

  it("tops up per-lock storage for a registered payer when the contract requires it", async () => {
    const { layer } = makeService({
      get_config: () => ({ ...chainConfig, per_lock_storage_stake: "5000000000000000000000" }),
      storage_balance_of: () => ({ total: "10000000000000000000000", available: "0" }),
    });
    const action = await run(layer, (s) =>
      s.createSubscription({
        planId: STARTER_PRICE_ID,
        amount: YOCTO_5_NEAR,
        payerRef: "alice.testnet",
      }),
    );
    if (action.kind !== "wallet_intent") throw new Error("expected wallet_intent");
    expect(action.actions[0]).toMatchObject({
      methodName: "storage_deposit",
      deposit: "5000000000000000000000",
    });
  });

  it("defaults the stake to the plan minimum when amount is omitted", async () => {
    const { layer } = makeService();
    const action = await run(layer, (s) => s.createSubscription({ planId: STARTER_PRICE_ID }));
    if (action.kind !== "wallet_intent") throw new Error("expected wallet_intent");
    expect(action.actions.at(-1)?.deposit).toBe(YOCTO_1_NEAR);
  });

  it("rejects amounts outside the plan range", async () => {
    const { layer } = makeService();
    const tooHigh = await runError(layer, (s) =>
      s.createSubscription({ planId: STARTER_PRICE_ID, amount: YOCTO_40_NEAR }),
    );
    expect(tooHigh._tag).toBe("InvalidAmountError");

    const tooLow = await runError(layer, (s) =>
      s.createSubscription({ planId: STARTER_PRICE_ID, amount: "1" }),
    );
    expect(tooLow._tag).toBe("InvalidAmountError");
  });

  it("rejects unknown and non-recurring plans", async () => {
    const { layer } = makeService();
    const unknown = await runError(layer, (s) => s.createSubscription({ planId: "price_nope" }));
    expect(unknown._tag).toBe("PlanNotFoundError");

    const oneOff = await runError(layer, (s) => s.createSubscription({ planId: "price_oneoff" }));
    expect(oneOff._tag).toBe("PlanNotFoundError");
  });
});

describe("cancel and resume", () => {
  it("builds a 1-yocto cancel_subscription intent addressed by product id", async () => {
    const { layer } = makeService({
      get_subscription_for_price: () => activeSubscription,
    });
    const action = await run(layer, (s) => s.cancelSubscription(STARTER_PRICE_ID, "alice.testnet"));
    if (action.kind !== "wallet_intent") throw new Error("expected wallet_intent");
    expect(action.actions[0]).toMatchObject({
      methodName: "cancel_subscription",
      args: { product_id: PRODUCT_ID },
      deposit: "1",
    });
  });

  it("builds a resume_subscription intent", async () => {
    const { layer } = makeService({
      get_subscription_for_price: () => ({ ...activeSubscription, cancel_at_period_end: true }),
    });
    const action = await run(layer, (s) => s.resumeSubscription(STARTER_PRICE_ID, "alice.testnet"));
    if (action.kind !== "wallet_intent") throw new Error("expected wallet_intent");
    expect(action.actions[0]?.methodName).toBe("resume_subscription");
  });

  it("fails with SubscriptionNotFoundError when there is nothing to cancel", async () => {
    const { layer } = makeService();
    const error = await runError(layer, (s) =>
      s.cancelSubscription(STARTER_PRICE_ID, "fresh.testnet"),
    );
    expect(error._tag).toBe("SubscriptionNotFoundError");
  });
});

describe("changePlan", () => {
  it("attaches the stake delta when moving to a bigger plan", async () => {
    const { layer } = makeService({
      get_subscription_for_price: () => activeSubscription,
      get_lock: () => activeLock,
    });
    const action = await run(layer, (s) =>
      s.changePlan({
        planId: STARTER_PRICE_ID,
        newPlanId: BASIC_PRICE_ID,
        amount: YOCTO_10_NEAR,
        payerRef: "alice.testnet",
      }),
    );
    if (action.kind !== "wallet_intent") throw new Error("expected wallet_intent");
    expect(action.actions[0]).toMatchObject({
      methodName: "update_subscription",
      args: {
        subscription_id: "sub_abc",
        target_price_id: BASIC_PRICE_ID,
        target_amount: YOCTO_10_NEAR,
      },
      deposit: YOCTO_5_NEAR,
    });
  });

  it("attaches 1 yocto for decreases (applied at the billing boundary)", async () => {
    const { layer } = makeService({
      get_subscription_for_price: () => ({ ...activeSubscription, price_id: BASIC_PRICE_ID }),
      get_lock: () => ({ ...activeLock, amount_near: YOCTO_10_NEAR }),
    });
    const action = await run(layer, (s) =>
      s.changePlan({
        planId: BASIC_PRICE_ID,
        newPlanId: STARTER_PRICE_ID,
        amount: YOCTO_1_NEAR,
        payerRef: "alice.testnet",
      }),
    );
    if (action.kind !== "wallet_intent") throw new Error("expected wallet_intent");
    expect(action.actions[0]?.deposit).toBe("1");
  });

  it("validates the amount against the target plan range", async () => {
    const { layer } = makeService({
      get_subscription_for_price: () => activeSubscription,
      get_lock: () => activeLock,
    });
    const error = await runError(layer, (s) =>
      s.changePlan({
        planId: STARTER_PRICE_ID,
        newPlanId: BASIC_PRICE_ID,
        amount: YOCTO_1_NEAR,
        payerRef: "alice.testnet",
      }),
    );
    expect(error._tag).toBe("InvalidAmountError");
  });
});

describe("error propagation", () => {
  it("wraps client failures in RpcError", async () => {
    const { layer } = makeService({
      get_product: () => {
        throw new Error("RPC timeout after 15000ms calling get_product");
      },
    });
    const error = await runError(layer, (s) => s.listPlans());
    expect(error._tag).toBe("RpcError");
    expect(error).toMatchObject({ message: expect.stringContaining("timeout") });
  });

  it("wraps malformed chain JSON in ChainDataError", async () => {
    const { layer } = makeService({
      get_subscription_for_price: () => ({ bogus: true }),
    });
    const error = await runError(layer, (s) =>
      s.getSubscription(STARTER_PRICE_ID, "alice.testnet"),
    );
    expect(error._tag).toBe("ChainDataError");
  });
});
