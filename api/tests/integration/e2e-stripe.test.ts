// Real stripe-node SDK. Resolved from api/ this is the npm package (used below
// for signing + real webhook verification); it is NOT what the plugin's service
// sees — see the vi.mock note.
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { API_PREFIX, createE2EContext, type E2EContext, TEST_WEBHOOK_SECRET } from "./setup";

const PROVIDER = "stripe";

/**
 * Stripe SDK mock state, hoisted so the `vi.mock` factory below can reference
 * it. Only the network-bound Checkout Session API is stubbed — webhook
 * signature verification stays REAL (see the mock factory).
 */
const stripeMocks = vi.hoisted(() => {
  const createdSession = {
    id: "cs_test_e2e_123",
    url: "https://checkout.stripe.com/c/pay/cs_test_e2e_123",
    status: "open",
    payment_status: "unpaid",
    amount_total: 1000,
    currency: "usd",
    metadata: { orderId: "e2e-order-001" },
  };

  const retrievedSession = {
    id: "cs_test_e2e_123",
    status: "complete",
    payment_status: "paid",
    amount_total: 1000,
    currency: "usd",
    metadata: { orderId: "e2e-order-001" },
  };

  return {
    createdSession,
    retrievedSession,
    sessionsCreate: vi.fn().mockResolvedValue(createdSession),
    sessionsRetrieve: vi.fn().mockResolvedValue(retrievedSession),
  };
});

/**
 * Why the mock lives on the service module and not on `vi.mock("stripe")`:
 *
 * The workspace package at plugins/stripe is itself named "stripe" and has an
 * `exports` map, so inside the plugin `import Stripe from "stripe"` SELF-
 * resolves to plugins/stripe/src/index.ts (Node/Vite package self-reference) —
 * not to the stripe npm SDK. `vi.mock("stripe")` from this file would only
 * mock the npm package (which the service never sees under vitest), and
 * mocking the self-referenced id would clobber the plugin module the harness
 * needs real.
 *
 * Instead we mock the service module: the REAL `StripePaymentService` class is
 * kept (all checkout mapping / webhook parsing / session normalization logic
 * runs for real) and only its constructed SDK client instance is swapped —
 * exactly the seam a `new Stripe(key, config)` constructor mock would replace.
 *
 * Hybrid SDK stand-in:
 *   - `checkout.sessions.*` is stubbed (those calls would hit api.stripe.com)
 *   - `webhooks` is the REAL stripe-node implementation — Stripe signature
 *     verification (`constructEventAsync`) is pure local HMAC crypto with no
 *     network involved, so the E2E webhook tests exercise Stripe's actual
 *     `t=...,v1=...` signature scheme instead of a canned mock.
 */
vi.mock("../../../plugins/stripe/src/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../plugins/stripe/src/service")>();
  const { default: RealStripe } = await import("stripe");

  // Real instance used ONLY for its `webhooks` object; constructing a Stripe
  // client performs no network I/O.
  const realWebhooks = new RealStripe("sk_test_webhooks_only").webhooks;

  class E2EStripePaymentService extends actual.StripePaymentService {
    constructor(secretKey: string, webhookSecret: string) {
      super(secretKey, webhookSecret);
      // Swap the SDK client the real constructor built for the hybrid mock.
      Object.assign(this, {
        stripe: {
          checkout: {
            sessions: {
              create: stripeMocks.sessionsCreate,
              retrieve: stripeMocks.sessionsRetrieve,
            },
          },
          webhooks: realWebhooks,
        },
      });
    }
  }

  return { ...actual, StripePaymentService: E2EStripePaymentService };
});

// Real SDK signer: generates genuine `Stripe-Signature` headers
// (t=...,v1=<hmac-sha256>), which the plugin then verifies with the real
// `constructEventAsync` — a full-fidelity webhook round-trip.
const signer = new Stripe("sk_test_signer");
const signStripeWebhook = (payload: string, secret: string = TEST_WEBHOOK_SECRET) =>
  signer.webhooks.generateTestHeaderString({ payload, secret });

describe("E2E: Stripe through the aggregator API", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await createE2EContext();
  }, 120_000);

  afterAll(async () => {
    await ctx?.teardown();
    vi.clearAllMocks();
  });

  it("returns Stripe in provider list with metadata", async () => {
    const providers = await ctx.client.paymentProviders();

    const stripe = providers.find((p) => p.key === PROVIDER);
    expect(stripe).toBeDefined();
    expect(stripe?.name).toBe("Stripe");
    expect(stripe?.logo).toContain("stripe");
    expect(stripe?.description).toBeTruthy();
  });

  it("creates a Stripe checkout session through the generic endpoint", async () => {
    const result = await ctx.client.paymentCheckout({
      provider: PROVIDER,
      orderId: "e2e-order-001",
      amount: 1000, // $10.00
      currency: "USD",
      items: [{ name: "E2E Test Item", unitAmount: 1000, quantity: 1 }],
      customerEmail: "stripe-test@example.com",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });

    expect(result.sessionId).toBe("cs_test_e2e_123");
    expect(result.url).toContain("https://checkout.stripe.com");

    // The aggregator delegated all the way down to the Stripe SDK.
    expect(stripeMocks.sessionsCreate).toHaveBeenCalledTimes(1);
    const createArgs = stripeMocks.sessionsCreate.mock.calls[0]?.[0];
    expect(createArgs.mode).toBe("payment");
    expect(createArgs.metadata).toMatchObject({ orderId: "e2e-order-001" });
    expect(createArgs.customer_email).toBe("stripe-test@example.com");
    // currency is lowercased and unitAmount mapped to unit_amount
    expect(createArgs.line_items[0].price_data.currency).toBe("usd");
    expect(createArgs.line_items[0].price_data.unit_amount).toBe(1000);
    expect(createArgs.line_items[0].quantity).toBe(1);
  });

  it("retrieves a Stripe session through the generic endpoint", async () => {
    const result = await ctx.client.paymentSession({
      provider: PROVIDER,
      sessionId: "cs_test_e2e_123",
    });

    // snake_case Stripe fields normalized to the generic session shape
    expect(result.session.id).toBe("cs_test_e2e_123");
    expect(result.session.status).toBe("complete");
    expect(result.session.paymentStatus).toBe("paid");
    expect(result.session.amountTotal).toBe(1000);
    expect(result.session.currency).toBe("usd");
    expect(result.session.metadata).toMatchObject({ orderId: "e2e-order-001" });

    expect(stripeMocks.sessionsRetrieve).toHaveBeenCalledWith("cs_test_e2e_123");
  });

  it("verifies a Stripe webhook (real signature scheme) through the generic endpoint", async () => {
    const payload = JSON.stringify({
      id: "evt_e2e_001",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_e2e_123",
          metadata: { orderId: "e2e-order-001" },
        },
      },
    });

    const result = await ctx.client.paymentWebhook({
      provider: PROVIDER,
      body: payload,
      signature: signStripeWebhook(payload),
    });

    expect(result.received).toBe(true);
    expect(result.eventType).toBe("checkout.session.completed");
    expect(result.orderId).toBe("e2e-order-001");
  });

  it("accepts a webhook delivered as a raw HTTP POST to /api/payments/webhook/stripe", async () => {
    // Simulates Stripe's servers POSTing a signed event to the running API.
    const payload = JSON.stringify({
      id: "evt_e2e_http_001",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_e2e_http",
          metadata: { orderId: "e2e-order-002" },
        },
      },
    });

    const response = await fetch(`${ctx.baseUrl}${API_PREFIX}/payments/webhook/${PROVIDER}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: payload, signature: signStripeWebhook(payload) }),
    });

    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      received: boolean;
      eventType?: string;
      orderId?: string;
    };
    expect(result.received).toBe(true);
    expect(result.eventType).toBe("checkout.session.completed");
    expect(result.orderId).toBe("e2e-order-002");
  });

  it("rejects Stripe webhook with invalid signature", async () => {
    const payload = JSON.stringify({ type: "checkout.session.completed" });

    await expect(
      ctx.client.paymentWebhook({
        provider: PROVIDER,
        body: payload,
        signature: "invalid",
      }),
    ).rejects.toThrow();
  });

  it("rejects a raw HTTP webhook delivery signed with the wrong secret", async () => {
    const payload = JSON.stringify({
      id: "evt_e2e_forged",
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_forged", metadata: { orderId: "e2e-order-003" } } },
    });

    // Well-formed `t=...,v1=...` header, but signed with an attacker's secret.
    const forgedSignature = signStripeWebhook(payload, "attacker_secret");

    const response = await fetch(`${ctx.baseUrl}${API_PREFIX}/payments/webhook/${PROVIDER}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: payload, signature: forgedSignature }),
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("returns error for unknown provider", async () => {
    await expect(
      ctx.client.paymentCheckout({
        provider: "nonexistent-provider",
        orderId: "test",
        amount: 100,
        currency: "USD",
        items: [{ name: "Test", unitAmount: 100, quantity: 1 }],
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      }),
    ).rejects.toThrow(/Unknown payment provider|NOT_FOUND/);
  });

  it("provider list includes both Stripe and PingPay", async () => {
    const providers = await ctx.client.paymentProviders();
    const keys = providers.map((p) => p.key);

    expect(keys).toContain("stripe");
    expect(keys).toContain("pingpay");
    expect(providers.length).toBeGreaterThanOrEqual(2);
  });
});
