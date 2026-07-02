import { Effect } from "every-plugin/effect";
import { describe, expect, it, vi } from "vitest";

vi.mock("stripe", () => {
  const mockInstance = {
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({
          id: "cs_test_123",
          url: "https://checkout.stripe.com/pay/cs_test_123",
        }),
        retrieve: vi.fn().mockResolvedValue({
          id: "cs_test_123",
          status: "complete",
          payment_status: "paid",
          amount_total: 1000,
          currency: "usd",
          metadata: { orderId: "order-123" },
        }),
      },
    },
    webhooks: {
      constructEventAsync: vi.fn().mockResolvedValue({
        type: "checkout.session.completed",
        data: {
          object: {
            metadata: { orderId: "order-123" },
          },
        },
      }),
    },
  };

  function MockStripe(..._args: any[]) {
    return mockInstance;
  }

  return {
    default: MockStripe,
  };
});

import { StripePaymentService } from "@/service";

describe("StripePaymentService", () => {
  const service = new StripePaymentService("sk_test_mock", "whsec_test_mock");

  describe("createCheckout", () => {
    it("should create a checkout session with line items", async () => {
      const result = await Effect.runPromise(
        service.createCheckout({
          orderId: "order-123",
          amount: 1000,
          currency: "USD",
          items: [{ name: "Test Item", unitAmount: 1000, quantity: 1 }],
          successUrl: "https://example.com/success",
          cancelUrl: "https://example.com/cancel",
        }),
      );

      expect(result).toEqual({
        sessionId: "cs_test_123",
        url: "https://checkout.stripe.com/pay/cs_test_123",
      });
    });
  });

  describe("verifyWebhook", () => {
    it("should verify and parse webhook event", async () => {
      const result = await Effect.runPromise(service.verifyWebhook("{}", "sig_test"));

      expect(result).toEqual({
        event: {
          type: "checkout.session.completed",
          data: { object: { metadata: { orderId: "order-123" } } },
        },
        orderId: "order-123",
      });
    });
  });

  describe("getSession", () => {
    it("should retrieve a session by ID", async () => {
      const result = await Effect.runPromise(service.getSession("cs_test_123"));

      expect(result).toEqual({
        id: "cs_test_123",
        status: "complete",
        payment_status: "paid",
        amount_total: 1000,
        currency: "usd",
        metadata: { orderId: "order-123" },
      });
    });
  });
});
