import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API_PREFIX, createE2EContext, type E2EContext, TEST_WEBHOOK_SECRET } from "./setup";

const PROVIDER = "pingpay";

/**
 * Computes a PingPay-style webhook signature: HMAC-SHA256 over
 * `${timestamp}.${payload}`, hex encoded — exactly what PingPay's servers
 * attach to webhook deliveries.
 */
function signPingPayWebhook(payload: string, timestamp: string, secret = TEST_WEBHOOK_SECRET) {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
}

describe("E2E: PingPay through the aggregator API", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await createE2EContext();
  }, 120_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  it("returns PingPay in provider list with metadata", async () => {
    const providers = await ctx.client.paymentProviders();

    const pingpay = providers.find((p) => p.key === PROVIDER);
    expect(pingpay).toBeDefined();
    expect(pingpay?.name).toBe("PingPay");
    expect(pingpay?.logo).toContain("pingpay");
    expect(pingpay?.description).toBeTruthy();
  });

  it("proves the PingPay plugin is alive via provider discovery", async () => {
    const providers = await ctx.client.paymentProviders();
    expect(providers.some((p) => p.key === PROVIDER)).toBe(true);
  });

  it("creates a PingPay checkout session through the generic endpoint", async () => {
    const result = await ctx.client.paymentCheckout({
      provider: PROVIDER,
      orderId: "e2e-order-001",
      amount: 1000, // $10.00
      currency: "USD",
      items: [{ name: "E2E Test Item", unitAmount: 1000, quantity: 1 }],
      customerEmail: "test@example.com",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });

    expect(result.sessionId).toBeTruthy();
    // test mode detection: mock sessions are prefixed with test_session_
    expect(result.sessionId).toContain("test_session_");
    expect(result.url).toContain("https://");
  });

  it("retrieves a PingPay session through the generic endpoint", async () => {
    const { sessionId } = await ctx.client.paymentCheckout({
      provider: PROVIDER,
      orderId: "e2e-order-002",
      amount: 500,
      currency: "USD",
      items: [{ name: "Test", unitAmount: 500, quantity: 1 }],
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });

    const result = await ctx.client.paymentSession({
      provider: PROVIDER,
      sessionId,
    });

    expect(result.session.id).toBe(sessionId);
    expect(result.session.status).toBeTruthy();
    expect(result.session.paymentStatus).toBeTruthy();
    expect(result.session.amountTotal).toBeGreaterThan(0);
    // USDC amount conversion / session normalization
    expect(result.session.currency).toBe("USDC");
  });

  it("verifies a PingPay webhook (HMAC-SHA256) through the generic endpoint", async () => {
    const payload = JSON.stringify({
      type: "payment.success",
      sessionId: "test_session_webhook_001",
      metadata: { orderId: "e2e-order-003" },
    });

    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signPingPayWebhook(payload, timestamp);

    const result = await ctx.client.paymentWebhook({
      provider: PROVIDER,
      body: payload,
      signature,
      timestamp,
    });

    expect(result.received).toBe(true);
    expect(result.eventType).toBe("payment.success");
    expect(result.orderId).toBe("e2e-order-003");
    expect(result.sessionId).toBe("test_session_webhook_001");
  });

  it("accepts a webhook delivered as a raw HTTP POST to /api/payments/webhook/pingpay", async () => {
    // Simulates PingPay's servers POSTing a signed webhook to the running API.
    const payload = JSON.stringify({
      type: "payment.success",
      sessionId: "test_session_webhook_http",
      metadata: { orderId: "e2e-order-004" },
    });

    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signPingPayWebhook(payload, timestamp);

    const response = await fetch(`${ctx.baseUrl}${API_PREFIX}/payments/webhook/${PROVIDER}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: payload, signature, timestamp }),
    });

    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      received: boolean;
      eventType?: string;
      orderId?: string;
      sessionId?: string;
    };
    expect(result.received).toBe(true);
    expect(result.eventType).toBe("payment.success");
    expect(result.orderId).toBe("e2e-order-004");
    expect(result.sessionId).toBe("test_session_webhook_http");
  });

  it("returns error for unknown provider", async () => {
    await expect(
      ctx.client.paymentCheckout({
        provider: "nonexistent",
        orderId: "test",
        amount: 100,
        currency: "USD",
        items: [{ name: "Test", unitAmount: 100, quantity: 1 }],
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      }),
    ).rejects.toThrow(/Unknown payment provider|NOT_FOUND/);
  });

  it("rejects webhook with invalid signature", async () => {
    const payload = JSON.stringify({
      type: "payment.success",
      sessionId: "test_session_bad",
    });

    await expect(
      ctx.client.paymentWebhook({
        provider: PROVIDER,
        body: payload,
        signature: "invalid_signature",
        timestamp: String(Math.floor(Date.now() / 1000)),
      }),
    ).rejects.toThrow();
  });

  it("rejects a raw HTTP webhook delivery signed with the wrong secret", async () => {
    const payload = JSON.stringify({
      type: "payment.success",
      sessionId: "test_session_forged",
      metadata: { orderId: "e2e-order-005" },
    });

    const timestamp = String(Math.floor(Date.now() / 1000));
    // Same length/format as a valid signature, but computed with an attacker's
    // secret — exercises the constant-time comparison path.
    const forgedSignature = signPingPayWebhook(payload, timestamp, "attacker_secret");

    const response = await fetch(`${ctx.baseUrl}${API_PREFIX}/payments/webhook/${PROVIDER}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: payload, signature: forgedSignature, timestamp }),
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
