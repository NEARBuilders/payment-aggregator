import { Effect } from "every-plugin/effect";
import { describe, expect, it } from "vitest";
import { type PingPayConfig, PingPayService, PingPayServiceLive } from "@/service";

const testConfig: PingPayConfig = {
  baseUrl: "https://pay.pingpay.io",
  recipientAddress: "near-merch-store.near",
  apiKey: "test_api_key",
  webhookSecret: "test_webhook_secret",
};

describe("PingPayService", () => {
  const serviceLayer = PingPayServiceLive(testConfig);
  describe("createCheckout", () => {
    it("should create a checkout session in test mode", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PingPayService;
          return yield* service.createCheckout({
            orderId: "order-123",
            amount: 1000,
            currency: "USD",
            items: [{ name: "Test Item", unitAmount: 1000, quantity: 1 }],
            successUrl: "https://example.com/success",
            cancelUrl: "https://example.com/cancel",
          });
        }).pipe(Effect.provide(serviceLayer)),
      );

      expect(result).toBeDefined();
      expect(result.sessionId).toContain("test_session_");
      expect(result.url).toContain("https://pay.pingpay.io/checkout?sessionId=");
    });

    it("should create checkout with fees", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PingPayService;
          return yield* service.createCheckout(
            {
              orderId: "order-456",
              amount: 2000,
              currency: "USD",
              items: [{ name: "Test Item", unitAmount: 2000, quantity: 1 }],
              successUrl: "https://example.com/success",
              cancelUrl: "https://example.com/cancel",
            },
            [{ type: "platform", label: "Platform Fee", recipient: "platform.near", bps: 250 }],
          );
        }).pipe(Effect.provide(serviceLayer)),
      );

      expect(result.sessionId).toContain("test_session_");
    });
  });

  describe("verifyWebhook", () => {
    it("should verify a valid webhook payload", async () => {
      const payload = JSON.stringify({
        type: "payment.success",
        sessionId: "test_session_123",
        metadata: { orderId: "order-789" },
      });

      const crypto = await import("node:crypto");
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = crypto
        .createHmac("sha256", testConfig.webhookSecret!)
        .update(`${timestamp}.${payload}`)
        .digest("hex");

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PingPayService;
          return yield* service.verifyWebhook(payload, signature, timestamp);
        }).pipe(Effect.provide(serviceLayer)),
      );

      expect(result.eventType).toBe("payment.success");
      expect(result.orderId).toBe("order-789");
    });

    it("should reject invalid signature", async () => {
      const payload = JSON.stringify({
        type: "payment.success",
        sessionId: "test_session_123",
      });

      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* PingPayService;
            return yield* service.verifyWebhook(payload, "invalid-signature", "123456789");
          }).pipe(Effect.provide(serviceLayer)),
        ),
      ).rejects.toThrow();
    });

    it("should reject invalid JSON body", async () => {
      const crypto = await import("node:crypto");
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = crypto
        .createHmac("sha256", testConfig.webhookSecret!)
        .update(`${timestamp}.not-json`)
        .digest("hex");

      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* PingPayService;
            return yield* service.verifyWebhook("not-json", signature, timestamp);
          }).pipe(Effect.provide(serviceLayer)),
        ),
      ).rejects.toThrow("Invalid JSON");
    });
  });

  describe("getSession", () => {
    it("should retrieve a session in test mode", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PingPayService;
          return yield* service.getSession("test_session_123");
        }).pipe(Effect.provide(serviceLayer)),
      );

      expect(result.id).toBe("test_session_123");
      expect(result.status).toBe("created");
      expect(result.paymentStatus).toBe("unpaid");
    });
  });
});
