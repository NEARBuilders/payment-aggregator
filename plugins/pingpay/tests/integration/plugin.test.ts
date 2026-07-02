import { afterAll, describe, expect, it } from "vitest";
import { getPluginClient, teardown } from "../setup";

describe("PingPay Plugin Integration Tests", () => {
  afterAll(async () => {
    await teardown();
  });

  describe("metadata procedure", () => {
    it("should return provider metadata", async () => {
      const client = await getPluginClient();

      const result = await client.metadata();

      expect(result).toEqual({
        name: "PingPay",
        logo: expect.stringContaining("pingpay"),
        description: expect.any(String),
      });
    });
  });

  describe("ping procedure", () => {
    it("should return healthy status with provider name", async () => {
      const client = await getPluginClient();

      const result = await client.ping();

      expect(result).toEqual({
        provider: "pingpay",
        status: "ok",
        timestamp: expect.any(String),
      });
    });
  });

  describe("createCheckout procedure", () => {
    it("should create a checkout session", async () => {
      const client = await getPluginClient();

      const result = await client.createCheckout({
        orderId: "order-123",
        amount: 1000,
        currency: "USD",
        items: [{ name: "Test Item", unitAmount: 1000, quantity: 1 }],
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      });

      expect(result).toEqual({
        sessionId: expect.any(String),
        url: expect.stringContaining("https://"),
      });
      expect(result.sessionId).toContain("test_session_");
    });
  });

  describe("getSession procedure", () => {
    it("should retrieve a session", async () => {
      const client = await getPluginClient();

      const result = await client.getSession({ sessionId: "test_session_123" });

      expect(result).toEqual({
        session: {
          id: "test_session_123",
          status: "created",
          paymentStatus: "unpaid",
          amountTotal: expect.any(Number),
          currency: "USDC",
          metadata: expect.any(Object),
        },
      });
    });
  });

  describe("verifyWebhook procedure", () => {
    it("should verify a valid webhook", async () => {
      const client = await getPluginClient();

      const payload = JSON.stringify({
        type: "payment.success",
        sessionId: "test_session_123",
        metadata: { orderId: "order-789" },
      });

      const crypto = await import("crypto");
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = crypto
        .createHmac("sha256", "test_webhook_secret")
        .update(`${timestamp}.${payload}`)
        .digest("hex");

      const result = await client.verifyWebhook({
        body: payload,
        signature,
        timestamp,
      });

      expect(result).toEqual({
        received: true,
        eventType: "payment.success",
        orderId: "order-789",
        sessionId: "test_session_123",
      });
    });
  });
});
