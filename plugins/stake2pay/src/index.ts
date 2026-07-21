import { createPlugin } from "every-plugin";
import { Cause, Effect, Exit, type Layer, Option } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import { NearRpcClient } from "./client";
import { SubscriptionContract } from "./contract";
import { ContextSchema } from "./lib/context";
import { Stake2PayService, Stake2PayServiceLive } from "./service";

const toORPCError = (error: { _tag: string; message: string }) => {
  switch (error._tag) {
    case "PlanNotFoundError":
    case "SubscriptionNotFoundError":
      return new ORPCError("NOT_FOUND", { message: error.message });
    case "InvalidAmountError":
      return new ORPCError("BAD_REQUEST", { message: error.message });
    case "RpcError":
      return new ORPCError("SERVICE_UNAVAILABLE", { message: error.message });
    default:
      return new ORPCError("INTERNAL_SERVER_ERROR", { message: error.message });
  }
};

export default createPlugin({
  variables: z.object({
    rpcUrl: z.string().default("https://test.rpc.fastnear.com"),
    networkId: z.string().default("testnet"),
    contractId: z.string().default("hos-e2e-0601144939.testnet"),
    productId: z.string().default("prod_5lklj46roIwKZK"),
    rpcTimeoutMs: z.number().min(1000).max(60000).default(15000),
  }),

  secrets: z.object({}),

  contract: SubscriptionContract,

  context: ContextSchema,

  initialize: (config) =>
    Effect.sync(() => {
      const serviceLayer = Stake2PayServiceLive({
        networkId: config.variables.networkId,
        contractId: config.variables.contractId,
        productId: config.variables.productId,
        client: new NearRpcClient(config.variables.rpcUrl, config.variables.rpcTimeoutMs),
      });

      return { serviceLayer };
    }),

  shutdown: () => Effect.void,

  createRouter: (context, builder) => {
    const { serviceLayer } = context;

    const run = async <A>(
      effect: Effect.Effect<A, { _tag: string; message: string }, Stake2PayService>,
    ): Promise<A> => {
      const exit = await Effect.runPromiseExit(
        effect.pipe(Effect.provide(serviceLayer as Layer.Layer<Stake2PayService>)),
      );
      if (Exit.isSuccess(exit)) {
        return exit.value;
      }
      const failure = Cause.failureOption(exit.cause);
      if (Option.isSome(failure)) {
        throw toORPCError(failure.value);
      }
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: Cause.pretty(exit.cause) });
    };

    return {
      metadata: builder.metadata.handler(async () => ({
        name: "Stake2Pay",
        logo: "/logos/stake2pay.svg",
        description: "Subscriptions paid from NEAR staking yield via House of Stake",
      })),

      ping: builder.ping.handler(async () => ({
        provider: "stake2pay",
        status: "ok" as const,
        timestamp: new Date().toISOString(),
      })),

      listPlans: builder.listPlans.handler(async () =>
        run(
          Effect.gen(function* () {
            const service = yield* Stake2PayService;
            return yield* service.listPlans();
          }),
        ),
      ),

      createSubscription: builder.createSubscription.handler(async ({ input }) =>
        run(
          Effect.gen(function* () {
            const service = yield* Stake2PayService;
            return yield* service.createSubscription(input);
          }),
        ),
      ),

      getSubscription: builder.getSubscription.handler(async ({ input }) =>
        run(
          Effect.gen(function* () {
            const service = yield* Stake2PayService;
            return yield* service.getSubscription(input.planId, input.payerRef);
          }),
        ),
      ),

      cancelSubscription: builder.cancelSubscription.handler(async ({ input }) =>
        run(
          Effect.gen(function* () {
            const service = yield* Stake2PayService;
            return yield* service.cancelSubscription(input.planId, input.payerRef);
          }),
        ),
      ),

      resumeSubscription: builder.resumeSubscription.handler(async ({ input }) =>
        run(
          Effect.gen(function* () {
            const service = yield* Stake2PayService;
            return yield* service.resumeSubscription(input.planId, input.payerRef);
          }),
        ),
      ),

      changePlan: builder.changePlan.handler(async ({ input }) =>
        run(
          Effect.gen(function* () {
            const service = yield* Stake2PayService;
            return yield* service.changePlan(input);
          }),
        ),
      ),
    };
  },
});

export type { ViewClient } from "./client";
export { NearRpcClient } from "./client";
export { type Stake2PayConfig, Stake2PayService, Stake2PayServiceLive } from "./service";
