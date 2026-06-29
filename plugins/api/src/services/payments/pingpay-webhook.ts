import { Effect } from 'every-plugin/effect';
import { ORPCError } from 'every-plugin/orpc';
import type { MarketplaceRuntime, PaymentProvider } from '../../runtime';
import { OrderStore } from '../../store/orders';
import { ProviderConfigStore } from '../../store/providers';
import { EmailService } from '../email';
import { processPaymentSuccessEffect } from './payment-success';

export function handlePingPayWebhookEffect(options: {
  runtime: MarketplaceRuntime;
  pingProvider: PaymentProvider;
  signature: string;
  timestamp: string;
  body: string;
}): Effect.Effect<{ received: true }, Error, OrderStore | ProviderConfigStore | EmailService> {
  const { runtime, pingProvider, signature, timestamp, body } = options;

  return Effect.gen(function* () {
    const webhookResult = yield* Effect.tryPromise({
      try: async () =>
        pingProvider.client.verifyWebhook({
          body,
          signature,
          timestamp,
        }),
      catch: (error) => {
        const errorMsg = `Webhook verification failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error('[PingPay Webhook]', errorMsg, { error: String(error) });
        return new ORPCError('UNAUTHORIZED', { message: errorMsg });
      },
    });

    const eventType = webhookResult.eventType;
    const { orderId, sessionId } = webhookResult;

    const store = yield* OrderStore;

    let order = orderId ? yield* store.find(orderId) : null;
    if (!order && sessionId) {
      order = yield* store.findByCheckoutSession(sessionId);
    }

    if (!order) {
      return { received: true } as const;
    }

    switch (eventType) {
      case 'payment.success':
      case 'checkout.session.completed': {
        if (order.status !== 'draft_created' && order.status !== 'pending' && order.status !== 'payment_pending') {
          return { received: true } as const;
        }

        const result = yield* processPaymentSuccessEffect({
          runtime,
          order,
          actor: 'service:pingpay',
          metadata: { sessionId, eventType },
        });
        break;
      }

      case 'payment.failed':
        yield* store.updateStatus(
          order.id,
          'payment_failed',
          'service:pingpay',
          eventType,
          { sessionId },
        );
        break;
    }

    return { received: true } as const;
  });
}
