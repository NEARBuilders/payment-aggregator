import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';
import { getPluginClient, runMigrations, teardown } from '../setup';
import {
  clearOrders,
  clearProducts,
  clearProviderConfigs,
  createTestProduct,
  createTestProductVariant,
} from '../helpers';

const TEST_USER = 'test-user.near';

const ADMIN_CONTEXT = {
  nearAccountId: 'admin.near',
  user: {
    id: 'admin-user',
    role: 'admin' as const,
    email: 'admin@nearmerch.com',
    name: 'Admin User',
  },
};

const TEST_WEBHOOK_SECRET = 'whsec_test_secret_key';

const mockShippingAddress = {
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  addressLine1: '123 Main St',
  city: 'Los Angeles',
  state: 'CA',
  postCode: '90001',
  country: 'US',
};

function generatePingPaySignature(timestamp: string, payload: string, secret: string): string {
  const signaturePayload = `${timestamp}.${payload}`;
  return createHmac('sha256', secret)
    .update(signaturePayload)
    .digest('hex');
}

function createWebhookHeaders(signature: string, timestamp: string): Headers {
  const headers = new Headers();
  headers.set('x-ping-signature', signature);
  headers.set('x-ping-timestamp', timestamp);
  return headers;
}

describe('Manual email flow', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await teardown();
  });

  beforeEach(async () => {
    await clearOrders();
    await clearProducts();
    await clearProviderConfigs();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearOrders();
    await clearProducts();
    await clearProviderConfigs();
  });

  it('persists manual provider settings when configured for the first time', async () => {
    const adminClient = await getPluginClient(ADMIN_CONTEXT);

    await adminClient.configureWebhook({
      provider: 'manual',
      settings: {
        notificationEmails: ['ops@nearmerch.com'],
        ownerAccountIds: ['owner.near'],
        replyToEmail: 'support@nearmerch.com',
      },
    });

    const result = await adminClient.getProviderConfig({ provider: 'manual' });

    expect(result.config?.settings).toEqual({
      notificationEmails: ['ops@nearmerch.com'],
      ownerAccountIds: ['owner.near'],
      replyToEmail: 'support@nearmerch.com',
    });
  });

  it('logs a manual notification email after payment success with provider and product recipients', async () => {
    await createTestProduct('prod_manual', {
      name: 'Manual Product',
      fulfillmentProvider: 'manual',
      metadata: {
        fees: [],
        providerDetails: {
          manual: {
            notificationEmails: ['artist@nearmerch.com'],
            ownerAccountIds: ['creator.near'],
          },
        },
      },
    });
    await createTestProductVariant('var_manual', 'prod_manual');

    const adminClient = await getPluginClient(ADMIN_CONTEXT);
    await adminClient.configureWebhook({
      provider: 'manual',
      settings: {
        notificationEmails: ['ops@nearmerch.com'],
        ownerAccountIds: ['owner.near'],
        replyToEmail: 'support@nearmerch.com',
      },
    });

    const client = await getPluginClient({ nearAccountId: TEST_USER });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const quoteResult = await client.quote({
      items: [{ productId: 'prod_manual', variantId: 'var_manual', quantity: 1 }],
      shippingAddress: mockShippingAddress,
    });

    const selectedRates: Record<string, string> = {};
    quoteResult.providerBreakdown.forEach((provider) => {
      selectedRates[provider.provider] = provider.selectedShipping.rateId;
    });

    const checkoutResult = await client.createCheckout({
      items: [{ productId: 'prod_manual', variantId: 'var_manual', quantity: 1 }],
      shippingAddress: mockShippingAddress,
      selectedRates,
      shippingCost: quoteResult.shippingCost,
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      paymentProvider: 'pingpay',
    });

    const createdOrder = await client.getOrder({ id: checkoutResult.orderId });
    expect(createdOrder.order.shippingAddress).toEqual(mockShippingAddress);

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const webhookPayload = {
      id: 'whevt_manual123',
      type: 'payment.success',
      created: new Date().toISOString(),
      data: {
        paymentId: 'pay_manual123',
        status: 'SUCCESS',
        amount: '1000000',
        assetId: 'NEAR:USDC',
        payerAddress: 'user.near',
        recipientAddress: 'near-merch-store.near',
        merchantId: 'merch_test',
      },
      sessionId: checkoutResult.checkoutSessionId,
      metadata: {
        orderId: checkoutResult.orderId,
      },
    };

    const payloadString = JSON.stringify(webhookPayload);
    const signature = generatePingPaySignature(timestamp, payloadString, TEST_WEBHOOK_SECRET);
    const webhookHeaders = createWebhookHeaders(signature, timestamp);
    const webhookClient = await getPluginClient({
      nearAccountId: TEST_USER,
      reqHeaders: webhookHeaders,
    });

    const webhookResult = await webhookClient.pingWebhook(webhookPayload);
    expect(webhookResult.received).toBe(true);

    const paidOrder = await client.getOrder({ id: checkoutResult.orderId });
    expect(paidOrder.order.status).toBe('processing');
    expect(paidOrder.order.shippingAddress).toEqual(mockShippingAddress);

    const emailLog = logSpy.mock.calls
      .map(([message]) => String(message))
      .find((message) => message.includes('[EmailService] No Resend API key configured'));

    expect(emailLog).toBeDefined();
    expect(emailLog).toContain('To: ops@nearmerch.com, owner.near@near.email, artist@nearmerch.com, creator.near@near.email');
    expect(emailLog).toContain('From: orders@nearmerch.com');
    expect(emailLog).toContain('Reply-To: support@nearmerch.com');
    expect(emailLog).toContain(`Order ID: ${checkoutResult.orderId}`);
    expect(emailLog).toContain('Manual Product');
    expect(emailLog).toContain(`/dashboard/orders?orderId=${checkoutResult.orderId}`);
    expect(emailLog).not.toContain('123 Main St');
    expect(emailLog).not.toContain('john@example.com');
  });
});
