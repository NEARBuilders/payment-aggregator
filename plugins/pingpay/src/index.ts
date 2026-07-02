import { createPlugin } from "every-plugin";
import { Effect } from "every-plugin/effect";
import { z } from "every-plugin/zod";
import { PaymentContract } from "./contract";
import type { FeeConfig } from "./schema";
import { PingPayService, PingPayServiceLive } from "./service";

export default createPlugin({
  variables: z.object({
    baseUrl: z.string().default("https://pay.pingpay.io"),
    recipientAddress: z.string().default("near-merch-store.near"),
  }),

  secrets: z.object({
    PING_API_KEY: z.string().optional(),
    PING_WEBHOOK_SECRET: z.string().optional(),
  }),

  contract: PaymentContract,

  initialize: (config) =>
    Effect.sync(() => {
      const serviceLayer = PingPayServiceLive({
        baseUrl: config.variables.baseUrl,
        recipientAddress: config.variables.recipientAddress,
        webhookSecret: config.secrets.PING_WEBHOOK_SECRET,
        apiKey: config.secrets.PING_API_KEY,
      });

      if (config.secrets.PING_API_KEY) {
        console.log("[PingPay Plugin] API key configured");
      } else {
        console.warn("[PingPay Plugin] No API key configured - requests may use test mode");
      }

      return { serviceLayer };
    }),

  shutdown: () => Effect.void,

  createRouter: (context, builder) => {
    const { serviceLayer } = context;

    return {
      metadata: builder.metadata.handler(async () => ({
        name: "PingPay",
        logo: "https://pay.everything.dev/logos/pingpay.svg",
        description: "NEAR-based USDC payments",
      })),

      ping: builder.ping.handler(async () => ({
        provider: "pingpay",
        status: "ok" as const,
        timestamp: new Date().toISOString(),
      })),

      createCheckout: builder.createCheckout.handler(async ({ input }) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* PingPayService;
            const fees = input.fees as FeeConfig[] | undefined;
            return yield* service.createCheckout(input, fees);
          }).pipe(Effect.provide(serviceLayer)),
        ),
      ),

      verifyWebhook: builder.verifyWebhook.handler(async ({ input }) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* PingPayService;
            const result = yield* service.verifyWebhook(
              input.body,
              input.signature,
              (input as { timestamp?: string }).timestamp ?? "",
            );
            return {
              received: true,
              eventType: result.eventType,
              orderId: result.orderId,
              sessionId: result.sessionId,
            };
          }).pipe(Effect.provide(serviceLayer)),
        ),
      ),

      getSession: builder.getSession.handler(async ({ input }) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* PingPayService;
            const session = yield* service.getSession(input.sessionId);

            const metadata: Record<string, string> | undefined = session.metadata
              ? Object.fromEntries(Object.entries(session.metadata).map(([k, v]) => [k, String(v)]))
              : undefined;

            return {
              session: {
                id: session.id,
                status: session.status,
                paymentStatus: session.paymentStatus,
                amountTotal: session.amountTotal,
                currency: session.currency,
                metadata,
              },
            };
          }).pipe(Effect.provide(serviceLayer)),
        ),
      ),
    };
  },
});

export type { PingWebhookResult } from "./schema";
export {
  type PingPayConfig,
  PingPayService,
  PingPayServiceLive,
  type PingSessionInfo,
} from "./service";
