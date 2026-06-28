import { Effect } from 'every-plugin/effect';
import { FulfillmentError } from '../errors';
import type {
  PingOutput,
  BrowseCatalogOutput,
  CatalogProductDetailOutput,
  CatalogVariantsOutput,
  VariantPriceOutput,
  GenerateMockupsOutput,
  GetMockupResultOutput,
  OrderResult,
  FulfillmentOrder,
  ShippingQuoteOutput,
  TaxQuoteOutput,
  GetPlacementsOutput,
} from '../schema';

const UNSUPPORTED = (method: string) =>
  new FulfillmentError({
    message: `Manual provider does not support ${method}`,
    code: 'UNSUPPORTED_OPERATION',
    provider: 'manual',
  });

export class ManualService {
  ping(): Effect.Effect<PingOutput, FulfillmentError> {
    return Effect.succeed({
      provider: 'manual',
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  }

  browseCatalog(): Effect.Effect<BrowseCatalogOutput, FulfillmentError> {
    return Effect.succeed({ products: [], total: 0 });
  }

  getCatalogProduct(): Effect.Effect<CatalogProductDetailOutput, FulfillmentError> {
    return Effect.fail(UNSUPPORTED('getCatalogProduct'));
  }

  getCatalogProductVariants(): Effect.Effect<CatalogVariantsOutput, FulfillmentError> {
    return Effect.fail(UNSUPPORTED('getCatalogProductVariants'));
  }

  getVariantPrice(): Effect.Effect<VariantPriceOutput, FulfillmentError> {
    return Effect.fail(UNSUPPORTED('getVariantPrice'));
  }

  generateMockups(): Effect.Effect<GenerateMockupsOutput, FulfillmentError> {
    return Effect.succeed({ status: 'unsupported', images: [] });
  }

  getMockupResult(): Effect.Effect<GetMockupResultOutput, FulfillmentError> {
    return Effect.succeed({ status: 'unsupported', images: [] });
  }

  createOrder(input: {
    externalId: string;
  }): Effect.Effect<OrderResult, FulfillmentError> {
    return Effect.succeed({
      id: `manual-${input.externalId}-${Date.now()}`,
      status: 'draft',
    });
  }

  getOrder(input: { id: string }): Effect.Effect<{ order: FulfillmentOrder }, FulfillmentError> {
    return Effect.succeed({
      order: {
        id: input.id,
        externalId: input.id,
        status: 'pending',
        created: Date.now(),
        updated: Date.now(),
        recipient: {
          name: 'Manual Fulfillment',
          address1: '',
          city: '',
          countryCode: 'US',
          zip: '',
          email: 'manual@localhost',
        },
      },
    });
  }

  confirmOrder(input: { id: string }): Effect.Effect<OrderResult, FulfillmentError> {
    return Effect.succeed({ id: input.id, status: 'processing' });
  }

  cancelOrder(input: { id: string }): Effect.Effect<OrderResult, FulfillmentError> {
    return Effect.succeed({ id: input.id, status: 'cancelled' });
  }

  quoteShipping(): Effect.Effect<ShippingQuoteOutput, FulfillmentError> {
    return Effect.succeed({
      rates: [
        {
          id: 'manual-standard',
          name: 'Standard Shipping',
          rate: 0,
          currency: 'USD',
          minDeliveryDays: 5,
          maxDeliveryDays: 10,
        },
      ],
      currency: 'USD',
    });
  }

  calculateTax(): Effect.Effect<TaxQuoteOutput, FulfillmentError> {
    return Effect.succeed({
      required: false,
      rate: 0,
      shippingTaxable: false,
      exempt: true,
    });
  }

  getPlacements(): Effect.Effect<GetPlacementsOutput, FulfillmentError> {
    return Effect.succeed({ placements: [] });
  }

  configureWebhooks(): Effect.Effect<
    { webhookUrl: string; publicKey: string | null; enabledEvents: string[] },
    FulfillmentError
  > {
    return Effect.succeed({
      webhookUrl: '',
      publicKey: null,
      enabledEvents: [],
    });
  }

  disableWebhooks(): Effect.Effect<void, FulfillmentError> {
    return Effect.void;
  }
}