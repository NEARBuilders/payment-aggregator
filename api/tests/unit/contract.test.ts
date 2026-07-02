import { describe, expect, it } from "vitest";
import { contract } from "../../src/contract";

describe("aggregator API contract", () => {
  it("exposes the generic payment procedures", () => {
    expect(Object.keys(contract)).toEqual(
      expect.arrayContaining([
        "ping",
        "paymentProviders",
        "paymentCheckout",
        "paymentWebhook",
        "paymentSession",
      ]),
    );
  });
});
