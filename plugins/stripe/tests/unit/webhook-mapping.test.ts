import { Effect } from "every-plugin/effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEventAsync: vi.fn(),
}));

vi.mock("stripe", () => {
  const mockInstance = {
    webhooks: { constructEventAsync: mocks.constructEventAsync },
  };

  function MockStripe(..._args: any[]) {
    return mockInstance;
  }

  return {
    default: MockStripe,
  };
});

import { StripePaymentService } from "@/service";

const service = new StripePaymentService("sk_test_mock", "whsec_test_mock");

const verify = async (event: unknown) => {
  mocks.constructEventAsync.mockResolvedValue(event);
  return Effect.runPromise(service.verifyWebhook("{}", "sig_test"));
};

beforeEach(() => {
  mocks.constructEventAsync.mockReset();
});

describe("StripePaymentService webhook event mapping", () => {
  it("maps checkout.session.completed with orderId and sessionId", async () => {
    const result = await verify({
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_123", metadata: { orderId: "order-123" } } },
    });

    expect(result.orderId).toBe("order-123");
    expect(result.sessionId).toBe("cs_test_123");
    expect(result.event.type).toBe("checkout.session.completed");
  });

  it("maps customer.subscription.updated using the subscription id as sessionId", async () => {
    const result = await verify({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_123", metadata: { orderId: "order-456" } } },
    });

    expect(result.event.type).toBe("customer.subscription.updated");
    expect(result.sessionId).toBe("sub_123");
    expect(result.orderId).toBe("order-456");
  });

  it("maps invoice.paid using the invoice's subscription reference", async () => {
    const result = await verify({
      type: "invoice.paid",
      data: { object: { id: "in_123", subscription: "sub_123", metadata: {} } },
    });

    expect(result.sessionId).toBe("sub_123");
    expect(result.orderId).toBeUndefined();
  });

  it("maps invoice.paid when the subscription lives under parent.subscription_details", async () => {
    const result = await verify({
      type: "invoice.paid",
      data: {
        object: {
          id: "in_456",
          parent: { subscription_details: { subscription: "sub_456" } },
        },
      },
    });

    expect(result.sessionId).toBe("sub_456");
  });

  it("passes through unrelated events without ids", async () => {
    const result = await verify({
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_123" } },
    });

    expect(result.event.type).toBe("payment_intent.succeeded");
    expect(result.orderId).toBeUndefined();
    expect(result.sessionId).toBeUndefined();
  });
});
