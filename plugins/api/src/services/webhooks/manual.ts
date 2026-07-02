import { Effect } from "every-plugin/effect";
import type { OrderStatus, OrderWithItems, TrackingInfo } from "../../schema";
import { OrderStore } from "../../store";

export function processManualWebhookEffect(options: {
  order: OrderWithItems;
  actor: string;
  status: OrderStatus;
  trackingInfo?: TrackingInfo[];
  metadata?: Record<string, unknown>;
}): Effect.Effect<{ order: OrderWithItems }, Error, OrderStore> {
  const { order, actor, status, trackingInfo, metadata } = options;

  return Effect.gen(function* () {
    const orderStore = yield* OrderStore;

    const updatedOrder = trackingInfo?.length
      ? yield* orderStore.updateTracking(order.id, trackingInfo, actor, metadata)
      : yield* orderStore.updateStatus(order.id, status, actor, "ORDER_STATUS_CHANGED", metadata);

    if (trackingInfo?.length && updatedOrder.status !== status) {
      return yield* orderStore
        .updateStatus(order.id, status, actor, "ORDER_STATUS_CHANGED", metadata)
        .pipe(Effect.map((finalOrder) => ({ order: finalOrder })));
    }

    return { order: updatedOrder };
  });
}
