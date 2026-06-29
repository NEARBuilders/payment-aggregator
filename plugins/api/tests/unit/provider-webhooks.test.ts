import { describe, expect, it, vi } from 'vitest';
import { Effect, Layer } from 'every-plugin/effect';
import { processPaymentSuccessEffect } from '../../src/services/payments/payment-success';
import { processManualWebhookEffect } from '../../src/services/webhooks/manual';
import { processLuluWebhookEffect, processPrintfulWebhookEffect } from '../../src/services/fulfillment/webhook';
import { LuluService } from '../../src/services/fulfillment/lulu/service';
import { EmailService } from '../../src/services/email';
import { OrderStore, ProviderConfigStore } from '../../src/store';

function createRuntime(confirmOrder: ReturnType<typeof vi.fn>) {
  return {
    getProvider: (name: string) => {
      if (name !== 'printful') return null;
      return {
        name: 'printful',
        client: {
          confirmOrder,
        },
      };
    },
    getPaymentProvider: () => null,
    getExclusiveCheckProvider: () => null,
    getStorageProvider: () => null,
    fulfillmentConfig: {},
    providers: [],
    paymentProviders: [],
    exclusiveCheckProviders: [],
    storageProviders: [],
    shutdown: async () => {},
  } as any;
}

describe('shared webhook processors', () => {
  it('processes a printful shipment webhook through the shared fulfillment helper', async () => {
    const updateStatusCalls: Array<[string, string, string | undefined, string | undefined, Record<string, unknown> | undefined]> = [];
    const updateTrackingCalls: Array<[string, unknown[], string | undefined, Record<string, unknown> | undefined]> = [];

    let orderState = {
      id: 'order_123',
      status: 'processing',
      draftOrderIds: {},
    } as any;

    const layer = Layer.succeed(OrderStore, {
      updateStatus: (orderId: string, status: string, actor?: string, reason?: string, metadata?: Record<string, unknown>) =>
        Effect.sync(() => {
          updateStatusCalls.push([orderId, status, actor, reason, metadata]);
          orderState = { ...orderState, status };
          return { ...orderState } as any;
        }),
      updateTracking: (orderId: string, trackingInfo: unknown[], actor?: string, metadata?: Record<string, unknown>) =>
        Effect.sync(() => {
          updateTrackingCalls.push([orderId, trackingInfo, actor, metadata]);
          orderState = { ...orderState, trackingInfo };
          return { ...orderState } as any;
        }),
    } as any);

    const result = await Effect.runPromise(
      processPrintfulWebhookEffect({
        runtime: createRuntime(vi.fn()),
        order: orderState,
        eventType: 'shipment_sent',
        data: {
          shipment: {
            tracking_number: 'TRACK-123',
            tracking_url: 'https://tracking.example.com/123',
            service: 'Express',
          },
        },
        actor: 'service:printful',
        metadata: { externalId: 'ext_123' },
      }).pipe(Effect.provide(layer)),
    );

    expect(updateStatusCalls[0]?.[1]).toBe('shipped');
    expect(updateTrackingCalls).toHaveLength(1);
    expect(result.order.status).toBe('shipped');
    expect(result.order.trackingInfo).toHaveLength(1);
  });

  it('processes a lulu shipment webhook through the shared fulfillment helper', async () => {
    const updateStatusCalls: Array<[string, string, string | undefined, string | undefined, Record<string, unknown> | undefined]> = [];
    const updateTrackingCalls: Array<[string, unknown[], string | undefined, Record<string, unknown> | undefined]> = [];

    let orderState = {
      id: 'order_456',
      status: 'processing',
    } as any;

    const layer = Layer.succeed(OrderStore, {
      updateStatus: (orderId: string, status: string, actor?: string, reason?: string, metadata?: Record<string, unknown>) =>
        Effect.sync(() => {
          updateStatusCalls.push([orderId, status, actor, reason, metadata]);
          orderState = { ...orderState, status };
          return { ...orderState } as any;
        }),
      updateTracking: (orderId: string, trackingInfo: unknown[], actor?: string, metadata?: Record<string, unknown>) =>
        Effect.sync(() => {
          updateTrackingCalls.push([orderId, trackingInfo, actor, metadata]);
          orderState = { ...orderState, trackingInfo };
          return { ...orderState } as any;
        }),
    } as any);

    const result = await Effect.runPromise(
      processLuluWebhookEffect({
        order: orderState,
        eventType: 'PRINT_JOB_STATUS_CHANGED',
        data: {
          id: 'print_1',
          status: 'SHIPPED',
          created_at: new Date().toISOString(),
          line_items: [
            {
              tracking_id: 'LULU-TRACK-1',
              tracking_urls: ['https://tracking.example.com/lulu'],
              carrier_name: 'Lulu Carrier',
            },
          ],
        },
        actor: 'service:lulu',
        luluService: new LuluService({ clientKey: '', clientSecret: '', environment: 'sandbox' }),
        metadata: { externalId: 'ext_456' },
      }).pipe(Effect.provide(layer)),
    );

    expect(updateStatusCalls[0]?.[1]).toBe('shipped');
    expect(updateTrackingCalls).toHaveLength(1);
    expect(result.order.status).toBe('shipped');
    expect(result.order.trackingInfo).toHaveLength(1);
  });

  it('processes a payment success through the shared payment helper', async () => {
    const confirmOrder = vi.fn().mockResolvedValue({ id: 'printful_draft_123' });
    const updateStatusCalls: Array<[string, string]> = [];
    const auditLogs: Array<Record<string, unknown>> = [];
    const notifications: Array<Record<string, unknown>> = [];

    let orderState = {
      id: 'order_123',
      status: 'draft_created',
      userId: 'test-user.near',
      totalAmount: 100,
      currency: 'USD',
      draftOrderIds: { printful: 'printful_draft_123' },
      items: [
        {
          id: 'item_1',
          orderId: 'order_123',
          productId: 'prod_1',
          productName: 'Manual Product',
          quantity: 1,
          unitPrice: 100,
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
      ],
    } as any;

    const layer = Layer.succeed(OrderStore, {
      updateStatus: (orderId: string, status: string) =>
        Effect.sync(() => {
          updateStatusCalls.push([orderId, status]);
          orderState = { ...orderState, status };
          return { ...orderState } as any;
        }),
      createAuditLog: (input: Record<string, unknown>) =>
        Effect.sync(() => {
          auditLogs.push(input);
        }),
    } as any);

    const layerWithDependencies = Layer.mergeAll(
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
        sendNotification: (notification: any) =>
          Effect.sync(() => {
            notifications.push(notification);
          }),
      }),
      layer,
    );

    const result = await Effect.runPromise(
      processPaymentSuccessEffect({
        runtime: createRuntime(confirmOrder),
        order: orderState as any,
        actor: 'service:stripe',
        metadata: { sessionId: 'sess_123' },
      }).pipe(Effect.provide(layerWithDependencies)),
    );

    expect(confirmOrder).toHaveBeenCalledWith({ id: 'printful_draft_123' });
    expect(updateStatusCalls.map(([, status]) => status)).toEqual(['paid', 'processing']);
    expect(result.order.status).toBe('processing');
    expect(notifications).toHaveLength(1);
    expect(auditLogs).toHaveLength(1);
  });

  it('processes a manual webhook through the shared manual helper', async () => {
    const updateStatus = vi.fn();
    const updateTracking = vi.fn();
    let orderState = { id: 'order_321', status: 'paid', trackingInfo: [] } as any;

    const layer = Layer.succeed(OrderStore, {
      updateStatus: (orderId: string, status: string) =>
        Effect.sync(() => {
          updateStatus.mock.calls.push([orderId, status]);
          orderState = { ...orderState, status };
          return { ...orderState } as any;
        }),
      updateTracking: (orderId: string, trackingInfo: unknown[]) =>
        Effect.sync(() => {
          updateTracking.mock.calls.push([orderId, trackingInfo]);
          orderState = { ...orderState, trackingInfo };
          return { ...orderState } as any;
        }),
    } as any);

    const result = await Effect.runPromise(
      processManualWebhookEffect({
        order: orderState,
        actor: 'service:manual',
        status: 'shipped' as any,
        trackingInfo: [
          {
            trackingCode: 'TRACK-1',
            trackingUrl: 'https://tracking.example.com/1',
            shipmentMethodName: 'Standard',
          },
        ],
      }).pipe(Effect.provide(layer)),
    );

    expect(updateTracking).toHaveBeenCalled();
    expect(updateStatus).toHaveBeenCalled();
    expect(result.order.status).toBe('shipped');
  });
});
