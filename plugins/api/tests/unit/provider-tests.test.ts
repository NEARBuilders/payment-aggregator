import { Effect } from "every-plugin/effect";
import { describe, expect, it, vi } from "vitest";
import {
  assertOwnedTestProduct,
  deriveSelectedRates,
  resolveTestProduct,
} from "../../src/services/provider-tests";

describe("provider test helpers", () => {
  it("derives selected rates from quote when scenario rates are absent", () => {
    const rates = deriveSelectedRates([
      {
        provider: "printful",
        selectedShipping: { rateId: "pf-rate-1" },
        availableRates: [{ rateId: "pf-rate-1" }],
      },
      {
        provider: "lulu",
        selectedShipping: { rateId: "lulu-rate-2" },
        availableRates: [{ rateId: "lulu-rate-2" }],
      },
    ]);

    expect(rates).toEqual({
      printful: "pf-rate-1",
      lulu: "lulu-rate-2",
    });
  });

  it("prefers scenario-selected rates when provided", () => {
    const rates = deriveSelectedRates(
      [
        {
          provider: "printful",
          selectedShipping: { rateId: "pf-rate-1" },
          availableRates: [{ rateId: "manual-rate" }, { rateId: "pf-rate-1" }],
        },
      ],
      { printful: "manual-rate" },
    );

    expect(rates).toEqual({ printful: "manual-rate" });
  });

  it("fails when a scenario-selected rate is no longer available", () => {
    expect(() =>
      deriveSelectedRates(
        [
          {
            provider: "printful",
            selectedShipping: { rateId: "pf-rate-1" },
            availableRates: [{ rateId: "pf-rate-1" }],
          },
        ],
        {
          printful: "stale-rate",
        },
      ),
    ).toThrow(/no longer available/);
  });

  it("rejects non-test products for the provider test harness", () => {
    expect(() =>
      assertOwnedTestProduct(
        {
          id: "prod_1",
          source: "real-product",
        } as never,
        "printful",
      ),
    ).toThrow(/non-test product/);
  });

  it("resyncs an existing owned test product instead of creating a new one", async () => {
    const updateProduct = vi.fn().mockReturnValue(Effect.succeed({ id: "prod_1" }));
    const updateListing = vi.fn().mockReturnValue(Effect.succeed({ id: "prod_1" }));
    const upsert = vi.fn();

    const existingProduct = {
      id: "prod_1",
      slug: "provider-test-printful",
      title: "Existing Test Product",
      publicKey: "provider-test-key",
      name: "Existing Test Product",
      price: 25,
      currency: "USD",
      tags: [],
      options: [],
      images: [],
      variants: [
        {
          id: "variant_1",
          name: "Existing Variant",
          price: 25,
          currency: "USD",
          attributes: [],
          inStock: true,
        },
      ],
      designFiles: [],
      fulfillmentProvider: "printful",
      source: "provider-test:printful",
      metadata: { fees: [] },
    } as const;

    const stateStore = {
      getState: vi.fn().mockReturnValue(
        Effect.succeed({
          provider: "printful",
          testProductId: "prod_1",
          selectedRates: undefined,
          scenario: { quantity: 1, product: {} },
          latestOrderId: null,
          latestStepResults: undefined,
          latestWebhookPayloads: undefined,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      ),
      upsertState: vi.fn().mockReturnValue(Effect.succeed(null)),
    };

    const productStore = {
      findById: vi.fn().mockReturnValue(Effect.succeed(existingProduct)),
      findBySource: vi.fn(),
      findBySlug: vi.fn(),
      upsert: upsert as any,
      updateProduct,
      updateListing,
    };

    await resolveTestProduct({
      provider: "printful",
      scenario: { quantity: 1, product: {} },
      productStore: productStore as never,
      stateStore: stateStore as never,
    });

    expect(productStore.upsert).not.toHaveBeenCalled();
    expect(updateProduct).toHaveBeenCalledWith(
      "prod_1",
      expect.objectContaining({
        name: "printful provider test product",
        price: 25,
        thumbnailImage: undefined,
      }),
    );
    expect(updateListing).toHaveBeenCalledWith("prod_1", false);
  });
});
