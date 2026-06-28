import { describe, expect, it, vi } from 'vitest';
import { Effect, Layer } from 'every-plugin/effect';
import { handleOrderPaidEffect } from '@/services/order-paid';
import { EmailService } from '@/services/email';
import { OrderStore, ProviderConfigStore } from '@/store';
import type { OrderWithItems } from '@/schema';
import type { MarketplaceRuntime } from '@/runtime';

function createOrder(): OrderWithItems {
  return {
    id: 'order_123',
    userId: 'buyer.near',
    status: 'paid',
    totalAmount: 42,
    currency: 'usd',
    draftOrderIds: {
      manual: 'manual_draft_123',
      printful: 'printful_draft_123',
    },
    shippingAddress: {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      addressLine1: '123 Main St',
      city: 'Los Angeles',
      state: 'CA',
      postCode: '90001',
      country: 'US',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: [
      {
        id: 'order_123-item-1',
        orderId: 'order_123',
        productId: 'manual_product',
        productName: 'Manual Product',
        quantity: 1,
        unitPrice: 42,
        fulfillmentProvider: 'manual',
        fulfillmentConfig: {
          providerName: 'manual',
          providerConfig: {
            manualNotification: {
              notificationEmails: ['artist@nearmerch.com'],
              ownerAccountIds: ['creator.near'],
            },
          },
          files: [],
        },
      },
      {
        id: 'order_123-item-2',
        orderId: 'order_123',
        productId: 'printful_product',
        productName: 'Printful Product',
        quantity: 1,
        unitPrice: 10,
        fulfillmentProvider: 'printful',
      },
    ],
  };
}

function createRuntime(confirmOrder: ReturnType<typeof vi.fn>): MarketplaceRuntime {
  return {
    providers: [],
    paymentProviders: [],
    exclusiveCheckProviders: [],
    storageProviders: [],
    hostUrl: 'https://nearmerch.com',
    fulfillmentConfig: {
      manual: {
        fromEmail: 'orders@nearmerch.com',
      },
    },
    getProvider: (name: string) => {
      if (name !== 'printful') {
        return null;
      }

      return {
        name: 'printful',
        client: {
          confirmOrder,
        },
        router: {},
      } as any;
    },
    getPaymentProvider: () => null,
    getExclusiveCheckProvider: () => null,
    getStorageProvider: () => null,
    shutdown: async () => {},
  };
}

describe('handleOrderPaidEffect', () => {
  it('confirms non-manual drafts and sends manual notifications to global and product recipients', async () => {
    const confirmOrder = vi.fn().mockResolvedValue({ id: 'printful_draft_123' });
    const auditLogs: Array<Record<string, unknown>> = [];
    const notifications: Array<{
      to: string[];
      subject: string;
      body: string;
      replyTo?: string;
    }> = [];

    const layer = Layer.mergeAll(
      Layer.succeed(OrderStore, {
        createAuditLog: (input: Record<string, unknown>) =>
          Effect.sync(() => {
            auditLogs.push(input);
          }),
      } as any),
      Layer.succeed(ProviderConfigStore, {
        getConfig: () =>
          Effect.succeed({
            provider: 'manual',
            enabled: true,
            webhookUrl: null,
            webhookUrlOverride: null,
            enabledEvents: [],
            publicKey: null,
            secretKey: null,
            settings: {
              notificationEmails: ['ops@nearmerch.com'],
              ownerAccountIds: ['owner.near'],
              replyToEmail: 'support@nearmerch.com',
            },
            lastConfiguredAt: null,
            expiresAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
      } as any),
      Layer.succeed(EmailService, {
        sendNotification: (notification) =>
          Effect.sync(() => {
            notifications.push(notification);
          }),
      }),
    );

    const result = await Effect.runPromise(
      handleOrderPaidEffect({
        runtime: createRuntime(confirmOrder),
        order: createOrder(),
      }).pipe(Effect.provide(layer)),
    );

    expect(confirmOrder).toHaveBeenCalledWith({ id: 'printful_draft_123' });
    expect(result).toEqual({
      allProviderConfirmationsSucceeded: true,
      confirmationResults: {
        manual: { success: true },
        printful: { success: true },
      },
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      to: [
        'ops@nearmerch.com',
        'owner.near@near.email',
        'artist@nearmerch.com',
        'creator.near@near.email',
      ],
      subject: 'New order received: order_123',
      replyTo: 'support@nearmerch.com',
    });
    expect(notifications[0]?.body).toContain('Manual Product x1');
    expect(notifications[0]?.body).toContain('https://nearmerch.com/dashboard/orders?orderId=order_123');
    expect(notifications[0]?.body).not.toContain('123 Main St');
    expect(notifications[0]?.body).not.toContain('john@example.com');
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({
      actor: 'service:order-paid',
      action: 'notification',
      field: 'manualNotification',
      newValue: 'sent',
    });
  });

  it('does not send manual notifications when the manual provider is disabled', async () => {
    const confirmOrder = vi.fn().mockResolvedValue({ id: 'printful_draft_123' });
    const auditLogs: Array<Record<string, unknown>> = [];
    const notifications: Array<{
      to: string[];
      subject: string;
      body: string;
      replyTo?: string;
    }> = [];

    const layer = Layer.mergeAll(
      Layer.succeed(OrderStore, {
        createAuditLog: (input: Record<string, unknown>) =>
          Effect.sync(() => {
            auditLogs.push(input);
          }),
      } as any),
      Layer.succeed(ProviderConfigStore, {
        getConfig: () =>
          Effect.succeed({
            provider: 'manual',
            enabled: false,
            webhookUrl: null,
            webhookUrlOverride: null,
            enabledEvents: [],
            publicKey: null,
            secretKey: null,
            settings: {
              notificationEmails: ['ops@nearmerch.com'],
              ownerAccountIds: ['owner.near'],
              replyToEmail: 'support@nearmerch.com',
            },
            lastConfiguredAt: null,
            expiresAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
      } as any),
      Layer.succeed(EmailService, {
        sendNotification: (notification) =>
          Effect.sync(() => {
            notifications.push(notification);
          }),
      }),
    );

    const result = await Effect.runPromise(
      handleOrderPaidEffect({
        runtime: createRuntime(confirmOrder),
        order: createOrder(),
      }).pipe(Effect.provide(layer)),
    );

    expect(confirmOrder).toHaveBeenCalledWith({ id: 'printful_draft_123' });
    expect(result).toEqual({
      allProviderConfirmationsSucceeded: false,
      confirmationResults: {
        manual: { success: true },
        printful: { success: true },
      },
    });
    expect(notifications).toHaveLength(0);
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({
      actor: 'service:order-paid',
      action: 'notification',
      field: 'manualNotification',
      newValue: 'skipped_disabled',
    });
  });

  it('fails the paid-order result when manual notification sending fails', async () => {
    const confirmOrder = vi.fn().mockResolvedValue({ id: 'printful_draft_123' });
    const auditLogs: Array<Record<string, unknown>> = [];

    const layer = Layer.mergeAll(
      Layer.succeed(OrderStore, {
        createAuditLog: (input: Record<string, unknown>) =>
          Effect.sync(() => {
            auditLogs.push(input);
          }),
      } as any),
      Layer.succeed(ProviderConfigStore, {
        getConfig: () =>
          Effect.succeed({
            provider: 'manual',
            enabled: true,
            webhookUrl: null,
            webhookUrlOverride: null,
            enabledEvents: [],
            publicKey: null,
            secretKey: null,
            settings: {
              notificationEmails: ['ops@nearmerch.com'],
              ownerAccountIds: ['owner.near'],
              replyToEmail: 'support@nearmerch.com',
            },
            lastConfiguredAt: null,
            expiresAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
      } as any),
      Layer.succeed(EmailService, {
        sendNotification: () => Effect.fail(new Error('resend unavailable')),
      }),
    );

    const result = await Effect.runPromise(
      handleOrderPaidEffect({
        runtime: createRuntime(confirmOrder),
        order: createOrder(),
      }).pipe(Effect.provide(layer)),
    );

    expect(confirmOrder).toHaveBeenCalledWith({ id: 'printful_draft_123' });
    expect(result).toEqual({
      allProviderConfirmationsSucceeded: false,
      confirmationResults: {
        manual: { success: true },
        printful: { success: true },
      },
    });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({
      actor: 'service:order-paid',
      action: 'notification',
      field: 'manualNotification',
      newValue: 'failed',
    });
  });
});
