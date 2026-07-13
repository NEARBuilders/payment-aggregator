import { Context, Effect, Layer } from "every-plugin/effect";
import type { z } from "every-plugin/zod";
import {
  HosConfigSchema,
  type HosLock,
  HosLockSchema,
  type HosPrice,
  HosPriceSchema,
  HosProductSchema,
  type HosSubscription,
  HosSubscriptionSchema,
  StorageBalanceSchema,
} from "./chain";
import type { ViewClient } from "./client";
import {
  ChainDataError,
  InvalidAmountError,
  PlanNotFoundError,
  RpcError,
  SubscriptionNotFoundError,
} from "./errors";
import type {
  ChangePlanInput,
  CreateSubscriptionInput,
  Plan,
  Subscription,
  SubscriptionAction,
  WalletFunctionCall,
} from "./schema";

export interface Stake2PayConfig {
  networkId: string;
  contractId: string;
  productId: string;
  client: ViewClient;
  catalogTtlMs?: number;
  now?: () => number;
}

const GAS_STORAGE_DEPOSIT = "30000000000000";
const GAS_LOCK = "250000000000000";
const GAS_UPDATE_SUBSCRIPTION = "300000000000000";
const GAS_LIFECYCLE = "30000000000000";
const ONE_YOCTO = "1";
const DEFAULT_CATALOG_TTL_MS = 60_000;

type ServiceError =
  | RpcError
  | ChainDataError
  | PlanNotFoundError
  | SubscriptionNotFoundError
  | InvalidAmountError;

export class Stake2PayService extends Context.Tag("Stake2PayService")<
  Stake2PayService,
  {
    readonly listPlans: () => Effect.Effect<Plan[], ServiceError>;
    readonly getSubscription: (
      planId: string,
      payerRef: string,
    ) => Effect.Effect<Subscription, ServiceError>;
    readonly createSubscription: (
      input: CreateSubscriptionInput,
    ) => Effect.Effect<SubscriptionAction, ServiceError>;
    readonly cancelSubscription: (
      planId: string,
      payerRef: string,
    ) => Effect.Effect<SubscriptionAction, ServiceError>;
    readonly resumeSubscription: (
      planId: string,
      payerRef: string,
    ) => Effect.Effect<SubscriptionAction, ServiceError>;
    readonly changePlan: (
      input: ChangePlanInput,
    ) => Effect.Effect<SubscriptionAction, ServiceError>;
  }
>() {}

const periodFromBillingPeriod = (billingPeriod: HosPrice["billing_period"]): Plan["period"] => {
  switch (billingPeriod) {
    case "Monthly":
      return "monthly";
    default:
      return "monthly";
  }
};

const toPlan = (price: HosPrice): Plan => ({
  id: price.price_id,
  name: price.name,
  description: price.description || undefined,
  period: periodFromBillingPeriod(price.billing_period),
  currency: "NEAR",
  minAmount: price.amount,
  maxAmount: price.metadata?.max_amount ?? price.amount,
  metadata: { productId: price.product_id },
});

const nsToIso = (ns: string): string => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();

const mapSubscription = (
  chain: HosSubscription,
  lock: HosLock | null,
  payerRef: string,
  nowMs: number,
): Subscription => {
  const periodEndMs = Number(BigInt(chain.end_ns) / 1_000_000n);
  const periodActive = periodEndMs > nowMs;

  let status: Subscription["status"];
  if (chain.status === "Active" && periodActive) {
    status = chain.cancel_at_period_end ? "cancel_at_period_end" : "active";
  } else {
    status = lock && lock.status !== "Withdrawn" ? "pending_unstake" : "ended";
  }

  const metadata: Record<string, string> = {
    productId: chain.product_id,
    lastLockId: chain.last_lock_id,
  };
  if (chain.pending_update) {
    if (chain.pending_update.target_price_id) {
      metadata.pendingTargetPlanId = chain.pending_update.target_price_id;
    }
    if (chain.pending_update.target_amount) {
      metadata.pendingTargetAmount = chain.pending_update.target_amount;
    }
    metadata.pendingApplyAt = nsToIso(chain.pending_update.apply_ns);
  }

  return {
    id: chain.subscription_id,
    planId: chain.price_id,
    status,
    amount: lock?.amount_near,
    currency: "NEAR",
    currentPeriodEnd: nsToIso(chain.end_ns),
    payerRef,
    metadata,
  };
};

export const Stake2PayServiceLive = (config: Stake2PayConfig) => {
  const catalogTtlMs = config.catalogTtlMs ?? DEFAULT_CATALOG_TTL_MS;
  const now = config.now ?? Date.now;
  let catalogCache: { at: number; plans: Plan[] } | null = null;

  const view = <T>(methodName: string, args: Record<string, unknown> = {}) =>
    Effect.tryPromise({
      try: () => config.client.viewFunction<T>(config.contractId, methodName, args),
      catch: (cause) =>
        new RpcError({
          message: cause instanceof Error ? cause.message : `RPC failure calling ${methodName}`,
          cause,
        }),
    });

  const parseChain = <S extends z.ZodType>(schema: S, value: unknown, what: string) =>
    Effect.try({
      try: () => schema.parse(value) as z.infer<S>,
      catch: (cause) =>
        new ChainDataError({ message: `Unexpected chain shape for ${what}`, cause }),
    });

  const parseChainNullable = <S extends z.ZodType>(schema: S, value: unknown, what: string) =>
    value === null || value === undefined
      ? Effect.succeed(null)
      : parseChain(schema, value, what).pipe(Effect.map((parsed) => parsed as z.infer<S>));

  const getActiveRecurringPrice = (planId: string) =>
    Effect.gen(function* () {
      const raw = yield* view<unknown>("get_price", { price_id: planId });
      const price = yield* parseChainNullable(HosPriceSchema, raw, `price ${planId}`);
      if (!price) {
        return yield* Effect.fail(
          new PlanNotFoundError({ message: `Unknown plan: ${planId}`, planId }),
        );
      }
      if (price.status !== "Active" || price.price_type !== "Recurring") {
        return yield* Effect.fail(
          new PlanNotFoundError({
            message: `Plan ${planId} is not an active recurring plan`,
            planId,
          }),
        );
      }
      return price;
    });

  const getChainSubscription = (planId: string, payerRef: string) =>
    Effect.gen(function* () {
      const raw = yield* view<unknown>("get_subscription_for_price", {
        account_id: payerRef,
        price_id: planId,
      });
      return yield* parseChainNullable(HosSubscriptionSchema, raw, `subscription for ${planId}`);
    });

  const requireChainSubscription = (planId: string, payerRef: string) =>
    Effect.gen(function* () {
      const subscription = yield* getChainSubscription(planId, payerRef);
      if (!subscription) {
        return yield* Effect.fail(
          new SubscriptionNotFoundError({
            message: `No subscription for ${payerRef} on plan ${planId}`,
            planId,
            payerRef,
          }),
        );
      }
      return subscription;
    });

  const getLock = (lockId: string) =>
    Effect.gen(function* () {
      const raw = yield* view<unknown>("get_lock", { lock_id: lockId });
      return yield* parseChainNullable(HosLockSchema, raw, `lock ${lockId}`);
    });

  const validateAmountInRange = (amount: string, price: HosPrice) =>
    Effect.gen(function* () {
      const minAmount = price.amount;
      const maxAmount = price.metadata?.max_amount ?? price.amount;
      if (BigInt(amount) < BigInt(minAmount) || BigInt(amount) > BigInt(maxAmount)) {
        return yield* Effect.fail(
          new InvalidAmountError({
            message: `Amount ${amount} outside plan range [${minAmount}, ${maxAmount}]`,
            minAmount,
            maxAmount,
          }),
        );
      }
      return amount;
    });

  const walletIntent = (actions: WalletFunctionCall[]): SubscriptionAction => ({
    kind: "wallet_intent",
    networkId: config.networkId,
    contractId: config.contractId,
    actions,
  });

  return Layer.succeed(Stake2PayService, {
    listPlans: () =>
      Effect.gen(function* () {
        if (catalogCache && now() - catalogCache.at < catalogTtlMs) {
          return catalogCache.plans;
        }

        const rawProduct = yield* view<unknown>("get_product", { product_id: config.productId });
        const product = yield* parseChainNullable(
          HosProductSchema,
          rawProduct,
          `product ${config.productId}`,
        );
        if (!product) {
          return yield* Effect.fail(
            new ChainDataError({ message: `Product ${config.productId} not found on chain` }),
          );
        }

        const prices = yield* Effect.all(
          product.price_ids.map((priceId) =>
            Effect.gen(function* () {
              const raw = yield* view<unknown>("get_price", { price_id: priceId });
              return yield* parseChainNullable(HosPriceSchema, raw, `price ${priceId}`);
            }),
          ),
          { concurrency: 4 },
        );

        const plans = prices
          .filter((price): price is HosPrice => price !== null)
          .filter((price) => price.status === "Active" && price.price_type === "Recurring")
          .map(toPlan);

        catalogCache = { at: now(), plans };
        return plans;
      }),

    getSubscription: (planId, payerRef) =>
      Effect.gen(function* () {
        const chain = yield* getChainSubscription(planId, payerRef);
        if (!chain) {
          return { planId, status: "none" as const, payerRef };
        }
        const lock = yield* getLock(chain.last_lock_id);
        return mapSubscription(chain, lock, payerRef, now());
      }),

    createSubscription: (input) =>
      Effect.gen(function* () {
        const price = yield* getActiveRecurringPrice(input.planId);
        const amount = yield* validateAmountInRange(input.amount ?? price.amount, price);

        const rawConfig = yield* view<unknown>("get_config");
        const chainConfig = yield* parseChain(HosConfigSchema, rawConfig, "config");

        let registered = false;
        if (input.payerRef) {
          const rawBalance = yield* view<unknown>("storage_balance_of", {
            account_id: input.payerRef,
          });
          const balance = yield* parseChainNullable(
            StorageBalanceSchema,
            rawBalance,
            `storage balance of ${input.payerRef}`,
          );
          registered = balance !== null;
        }

        const storageTopUp =
          BigInt(chainConfig.per_lock_storage_stake) +
          (registered ? 0n : BigInt(chainConfig.min_storage_deposit));

        const actions: WalletFunctionCall[] = [];
        if (storageTopUp > 0n) {
          actions.push({
            methodName: "storage_deposit",
            args: input.payerRef ? { account_id: input.payerRef } : {},
            deposit: storageTopUp.toString(),
            gas: GAS_STORAGE_DEPOSIT,
          });
        }
        actions.push({
          methodName: "lock",
          args: { price_id: input.planId, duration_ns: null },
          deposit: amount,
          gas: GAS_LOCK,
        });

        return walletIntent(actions);
      }),

    cancelSubscription: (planId, payerRef) =>
      Effect.gen(function* () {
        const subscription = yield* requireChainSubscription(planId, payerRef);
        return walletIntent([
          {
            methodName: "cancel_subscription",
            args: { product_id: subscription.product_id },
            deposit: ONE_YOCTO,
            gas: GAS_LIFECYCLE,
          },
        ]);
      }),

    resumeSubscription: (planId, payerRef) =>
      Effect.gen(function* () {
        const subscription = yield* requireChainSubscription(planId, payerRef);
        return walletIntent([
          {
            methodName: "resume_subscription",
            args: { product_id: subscription.product_id },
            deposit: ONE_YOCTO,
            gas: GAS_LIFECYCLE,
          },
        ]);
      }),

    changePlan: (input) =>
      Effect.gen(function* () {
        const subscription = yield* requireChainSubscription(input.planId, input.payerRef);
        const targetPrice = yield* getActiveRecurringPrice(input.newPlanId);
        const targetAmount = yield* validateAmountInRange(
          input.amount ?? targetPrice.amount,
          targetPrice,
        );

        const lock = yield* getLock(subscription.last_lock_id);
        const currentAmount = lock ? BigInt(lock.amount_near) : 0n;
        const delta = BigInt(targetAmount) - currentAmount;

        return walletIntent([
          {
            methodName: "update_subscription",
            args: {
              subscription_id: subscription.subscription_id,
              target_price_id: input.newPlanId,
              target_amount: targetAmount,
            },
            deposit: delta > 0n ? delta.toString() : ONE_YOCTO,
            gas: GAS_UPDATE_SUBSCRIPTION,
          },
        ]);
      }),
  });
};
