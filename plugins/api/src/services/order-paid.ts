import { Effect, Schedule } from "every-plugin/effect";
import type { MarketplaceRuntime } from "../runtime";
import type { OrderStatus, OrderWithItems, ProviderConfig } from "../schema";
import { OrderStore, ProviderConfigStore } from "../store";
import { resolveNotificationEmails } from "../utils/near-account";
import { EmailService } from "./email";

interface HandleOrderPaidResult {
  allProviderConfirmationsSucceeded: boolean;
  confirmationResults: Record<string, { success: boolean; error?: string }>;
}

export function handleOrderPaidEffect(options: {
  runtime: MarketplaceRuntime;
  order: OrderWithItems;
}): Effect.Effect<HandleOrderPaidResult, Error, OrderStore | ProviderConfigStore | EmailService> {
  const { runtime, order } = options;

  return Effect.gen(function* () {
    const orderStore = yield* OrderStore;
    const providerConfigStore = yield* ProviderConfigStore;
    const emailService = yield* EmailService;

    const confirmationResults: Record<string, { success: boolean; error?: string }> = {};
    const draftOrderIds = order.draftOrderIds || {};
    let manualNotificationSucceeded = true;

    for (const [providerName, draftId] of Object.entries(draftOrderIds)) {
      if (providerName === "manual") {
        confirmationResults[providerName] = { success: true };
        continue;
      }

      const provider = runtime.getProvider(providerName);
      if (!provider) {
        confirmationResults[providerName] = { success: false, error: "Provider not configured" };
        continue;
      }

      const confirmEffect = Effect.tryPromise({
        try: () => provider.client.confirmOrder({ id: draftId as string }),
        catch: (error: unknown) => {
          const errorMsg = `Failed to confirm order at ${providerName}: ${error instanceof Error ? error.message : String(error)}`;
          console.error(`[handleOrderPaid] ${errorMsg}`, { providerName, draftId });
          return new Error(errorMsg);
        },
      }).pipe(Effect.retry({ times: 3, schedule: Schedule.exponential("100 millis") }));

      const result = yield* confirmEffect.pipe(
        Effect.map(() => ({ success: true }) as const),
        Effect.catchAll((error: unknown) => {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`[handleOrderPaid] Order confirmation failed`, {
            providerName,
            draftId,
            error: errorMsg,
          });
          return Effect.succeed({ success: false as const, error: errorMsg });
        }),
      );

      confirmationResults[providerName] = result;
    }

    const hasManualItems = (order.items ?? []).some(
      (item) => item.fulfillmentProvider === "manual",
    );

    if (hasManualItems) {
      let notificationOutcome: "sent" | "failed" | "skipped_disabled" | "skipped_no_recipients" =
        "skipped_no_recipients";
      let notificationMetadata: Record<string, unknown> = {};

      try {
        const manualConfig = yield* providerConfigStore.getConfig("manual");

        if (!manualConfig?.enabled) {
          manualNotificationSucceeded = false;
          notificationOutcome = "skipped_disabled";
          notificationMetadata = { reason: "manual provider disabled" };
          console.warn("[handleOrderPaid] Manual notifications skipped", {
            orderId: order.id,
            reason: "manual provider disabled",
          });
        } else {
          const settings = manualConfig?.settings as Record<string, unknown> | undefined;
          const globalEmails: string[] = Array.isArray(settings?.notificationEmails)
            ? (settings!.notificationEmails as string[])
            : [];
          const globalOwnerIds: string[] = Array.isArray(settings?.ownerAccountIds)
            ? (settings!.ownerAccountIds as string[])
            : [];
          const replyTo: string | undefined =
            typeof settings?.replyToEmail === "string" ? settings.replyToEmail : undefined;
          const fromEmail = runtime.fulfillmentConfig.manual?.fromEmail ?? "orders@nearmerch.com";
          const orderLink = runtime.hostUrl
            ? new URL(
                `/dashboard/orders?orderId=${encodeURIComponent(order.id)}`,
                runtime.hostUrl,
              ).toString()
            : `/dashboard/orders?orderId=${encodeURIComponent(order.id)}`;

          const productEmailEntries = (order.items ?? [])
            .filter((item) => item.fulfillmentProvider === "manual")
            .map((item) => {
              const fulfillmentConfig = item.fulfillmentConfig as
                | Record<string, unknown>
                | undefined;
              const providerConfig = fulfillmentConfig?.providerConfig as
                | Record<string, unknown>
                | undefined;
              const manualDetails = providerConfig?.manualNotification as
                | Record<string, unknown>
                | undefined;
              return {
                notificationEmails: Array.isArray(manualDetails?.notificationEmails)
                  ? (manualDetails!.notificationEmails as string[])
                  : [],
                ownerAccountIds: Array.isArray(manualDetails?.ownerAccountIds)
                  ? (manualDetails!.ownerAccountIds as string[])
                  : [],
              };
            });

          const notificationEmails = resolveNotificationEmails(
            globalEmails,
            globalOwnerIds,
            productEmailEntries,
          );

          if (notificationEmails.length > 0) {
            const itemSummary = (order.items ?? [])
              .map(
                (item) =>
                  `- ${item.productName}${item.variantName ? ` (${item.variantName})` : ""} x${item.quantity}`,
              )
              .join("\n");

            yield* emailService
              .sendNotification({
                to: notificationEmails,
                subject: `New order received: ${order.id}`,
                body: `A new order has been placed and paid.\n\nOrder ID: ${order.id}\nTotal: ${order.currency.toUpperCase()} ${order.totalAmount.toFixed(2)}\n\nItems:\n${itemSummary}\n\nView the order in the admin dashboard:\n${orderLink}`,
                replyTo,
              })
              .pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    notificationOutcome = "sent";
                    notificationMetadata = {
                      fromEmail,
                      recipientCount: notificationEmails.length,
                    };
                    console.log("[handleOrderPaid] Sent manual notification email", {
                      orderId: order.id,
                      fromEmail,
                      recipientCount: notificationEmails.length,
                    });
                  }),
                ),
                Effect.catchAll((emailError: unknown) =>
                  Effect.sync(() => {
                    manualNotificationSucceeded = false;
                    notificationOutcome = "failed";
                    const errorMsg =
                      emailError instanceof Error ? emailError.message : String(emailError);
                    notificationMetadata = {
                      fromEmail,
                      recipientCount: notificationEmails.length,
                      error: errorMsg,
                    };
                    console.error("[handleOrderPaid] Failed to send manual notification email", {
                      orderId: order.id,
                      fromEmail,
                      error: errorMsg,
                    });
                  }),
                ),
              );
          } else {
            manualNotificationSucceeded = false;
            notificationOutcome = "skipped_no_recipients";
            notificationMetadata = { reason: "no recipients configured" };
            console.warn("[handleOrderPaid] Manual notifications skipped", {
              orderId: order.id,
              reason: "no recipients configured",
            });
          }
        }
      } catch (emailError) {
        manualNotificationSucceeded = false;
        notificationOutcome = "failed";
        notificationMetadata = {
          error: emailError instanceof Error ? emailError.message : String(emailError),
        };
        console.error("[handleOrderPaid] Failed to process manual notification configuration", {
          orderId: order.id,
          error: emailError instanceof Error ? emailError.message : String(emailError),
        });
      }

      yield* orderStore
        .createAuditLog({
          orderId: order.id,
          actor: "service:order-paid",
          action: "notification",
          field: "manualNotification",
          newValue: notificationOutcome,
          metadata: notificationMetadata,
        })
        .pipe(
          Effect.catchAll((error: unknown) =>
            Effect.sync(() => {
              console.warn("[handleOrderPaid] Failed to write manual notification audit log", {
                orderId: order.id,
                error: error instanceof Error ? error.message : String(error),
              });
            }),
          ),
        );
    }

    const allSuccess =
      Object.values(confirmationResults).every((r) => r.success) && manualNotificationSucceeded;

    return {
      allProviderConfirmationsSucceeded: allSuccess,
      confirmationResults,
    };
  });
}
