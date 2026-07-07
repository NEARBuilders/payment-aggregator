import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ChevronDown, Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { sessionQueryOptions, useApiClient } from "@/app";
import builtOn from "@/assets/built_on.png";
import builtOnRev from "@/assets/built_on_rev.png";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserNav } from "@/components/user-nav";

export const Route = createFileRoute("/payments")({
  beforeLoad: async ({ context, location }) => {
    const { queryClient, authClient } = context;
    const session = await queryClient.ensureQueryData(
      sessionQueryOptions(authClient, context.session),
    );
    if (!session?.user) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    return { session };
  },
  head: () => ({
    meta: [
      { title: "Payments — pay.everything.dev" },
      { name: "description", content: "One checkout, every provider." },
    ],
  }),
  component: PaymentsPage,
});

type ProviderInfo = {
  key: string;
  name: string;
  logo: string;
  description: string;
};

type CheckoutResult = {
  provider: ProviderInfo;
  sessionId: string;
  url: string;
  orderId: string;
};

const WEBHOOK_TEST_SECRET = "test_webhook_secret";
const WEBHOOK_EVENT_TYPES = [
  "payment.success",
  "payment.failed",
  "checkout.session.completed",
] as const;

async function computeHmacSignature(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function PaymentsPage() {
  const apiClient = useApiClient();
  const origin = typeof window !== "undefined" ? window.location.origin : "https://example.com";

  const [orderId, setOrderId] = useState(`order_${Date.now()}`);
  const [amount, setAmount] = useState("1.00");
  const [currency, setCurrency] = useState("USD");
  const [customerEmail, setCustomerEmail] = useState("");
  const [itemName, setItemName] = useState("Demo item");
  const [formOpen, setFormOpen] = useState(false);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [aggregationError, setAggregationError] = useState<string | null>(null);

  const amountInCents = Math.round(Number(amount) * 100);
  const displayAmount = Number.isFinite(amountInCents) ? (amountInCents / 100).toFixed(2) : "0.00";

  const { data: providers, isLoading } = useQuery({
    queryKey: ["payment-providers"],
    queryFn: () => apiClient.paymentProviders(),
  });

  const checkout = useMutation({
    mutationFn: async (provider: ProviderInfo) => {
      const response = await apiClient.paymentCheckout({
        provider: provider.key,
        orderId,
        amount: amountInCents,
        currency,
        customerEmail: customerEmail || undefined,
        successUrl: `${origin}/payments?result=success`,
        cancelUrl: `${origin}/payments?result=cancel`,
        items: [{ name: itemName, unitAmount: amountInCents, quantity: 1 }],
      });
      return { provider, response };
    },
    onSuccess: ({ provider, response }) => {
      setAggregationError(null);
      setResult({ provider, sessionId: response.sessionId, url: response.url, orderId });
      toast.success(`${provider.name} session created`);
    },
    onError: (error: Error, provider) => {
      setAggregationError(error.message || `${provider.name} is not available yet`);
    },
  });

  const pendingKey = checkout.isPending ? checkout.variables?.key : null;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between px-5 sm:px-8">
        <span className="font-mono text-muted-foreground text-sm">pay.everything.dev</span>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <UserNav />
        </div>
      </header>

      <main className="flex-1 px-5 py-10 sm:px-8 sm:py-14">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 max-w-xl">
            <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Payment aggregation
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              One checkout, every provider.
            </h1>
            <p className="mt-3 text-muted-foreground text-sm leading-relaxed">
              Every provider below is a plugin behind the same oRPC contract. Pick one — the
              aggregator routes the session, the raw responses land on the right.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[400px_1fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                <div className="flex items-baseline justify-between">
                  <div>
                    <p className="font-medium">{itemName}</p>
                    <p className="text-muted-foreground text-xs">Order {orderId.slice(-8)}</p>
                  </div>
                  <p className="text-2xl font-semibold tracking-tight">
                    ${displayAmount}
                    <span className="ml-1 text-muted-foreground text-xs font-normal">
                      {currency}
                    </span>
                  </p>
                </div>

                <div className="my-5 border-t border-border" />

                <div className="space-y-2.5">
                  {isLoading && (
                    <div className="space-y-2.5">
                      <div className="h-11 animate-pulse rounded-xl bg-muted" />
                      <div className="h-11 animate-pulse rounded-xl bg-muted" />
                    </div>
                  )}
                  {providers?.map((provider) => (
                    <button
                      key={provider.key}
                      type="button"
                      disabled={checkout.isPending}
                      onClick={() => checkout.mutate(provider)}
                      className="group flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-foreground font-medium text-background text-sm transition-all duration-150 hover:opacity-90 active:scale-[0.99] disabled:opacity-50"
                    >
                      {pendingKey === provider.key ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <img src={provider.logo} alt="" className="h-4.5 w-4.5 object-contain" />
                      )}
                      Pay with {provider.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled
                    className="flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-border bg-muted/50 font-medium text-muted-foreground text-sm"
                  >
                    Stake to Pay
                    <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Coming soon
                    </span>
                  </button>
                </div>

                {aggregationError && (
                  <p className="mt-3 text-muted-foreground text-xs">{aggregationError}</p>
                )}

                <button
                  type="button"
                  onClick={() => setFormOpen((open) => !open)}
                  className="mt-5 flex w-full items-center justify-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground"
                >
                  Edit order details
                  <ChevronDown
                    size={13}
                    className={`transition-transform duration-150 ${formOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {formOpen && (
                  <div className="mt-4 grid grid-cols-1 gap-3 border-t border-border pt-4">
                    <Field label="Order ID">
                      <Input value={orderId} onChange={(e) => setOrderId(e.target.value)} />
                    </Field>
                    <Field label="Item name">
                      <Input value={itemName} onChange={(e) => setItemName(e.target.value)} />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Amount (USD)">
                        <Input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                        />
                      </Field>
                      <Field label="Currency">
                        <Input value={currency} onChange={(e) => setCurrency(e.target.value)} />
                      </Field>
                    </div>
                    <Field label="Customer email (optional)">
                      <Input
                        type="email"
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                      />
                    </Field>
                    <p className="text-muted-foreground text-[11px]">
                      Sent as {amountInCents} minor units through the aggregator contract.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <ResponsePanel result={result} />
              <WebhookPanel result={result} />
            </div>
          </div>
        </div>
      </main>

      <footer className="flex shrink-0 justify-center py-8">
        <a
          href="https://near.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="relative h-6 w-[100px]"
        >
          <img
            src={builtOn}
            alt="Built on NEAR"
            className="absolute inset-0 h-full w-full object-contain dark:hidden"
          />
          <img
            src={builtOnRev}
            alt="Built on NEAR"
            className="absolute inset-0 hidden h-full w-full object-contain dark:block"
          />
        </a>
      </footer>
    </div>
  );
}

function ResponsePanel({ result }: { result: CheckoutResult | null }) {
  const apiClient = useApiClient();

  const sessionQuery = useQuery({
    queryKey: ["payment-session", result?.provider.key, result?.sessionId],
    queryFn: () =>
      apiClient.paymentSession({
        provider: result?.provider.key ?? "",
        sessionId: result?.sessionId ?? "",
      }),
    enabled: !!result,
    retry: false,
  });

  const session = sessionQuery.data?.session;

  const copySessionId = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.sessionId);
    toast.success("Session ID copied");
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Response
        </p>
        {result && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => sessionQuery.refetch()}
            disabled={sessionQuery.isFetching}
          >
            <RefreshCw size={13} className={sessionQuery.isFetching ? "animate-spin" : ""} />
            Refresh
          </Button>
        )}
      </div>

      {!result && (
        <div className="py-8 text-center">
          <p className="text-muted-foreground text-sm">
            Checkout responses and session state will appear here.
          </p>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="space-y-2">
            <InfoRow label="provider" value={result.provider.name} />
            <InfoRow label="session" value={result.sessionId} mono />
            <InfoRow label="order" value={result.orderId} mono />
            {session && (
              <>
                <InfoRow label="status" value={session.status} />
                <InfoRow label="payment" value={session.paymentStatus} />
                <InfoRow
                  label="amount"
                  value={
                    session.amountTotal !== undefined
                      ? `${(session.amountTotal / 100).toFixed(2)} ${session.currency?.toUpperCase() ?? ""}`.trim()
                      : "—"
                  }
                />
              </>
            )}
          </div>
          {sessionQuery.isError && (
            <p className="text-muted-foreground text-xs">
              Session lookup failed: {(sessionQuery.error as Error).message}
            </p>
          )}
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button variant="outline" size="sm" onClick={copySessionId}>
              <Copy size={13} />
              Copy ID
            </Button>
            <Button size="sm" asChild>
              <a href={result.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={13} />
                Open checkout
              </a>
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function WebhookPanel({ result }: { result: CheckoutResult | null }) {
  const apiClient = useApiClient();
  const [eventType, setEventType] = useState<string>(WEBHOOK_EVENT_TYPES[0]);

  const simulate = useMutation({
    mutationFn: async () => {
      if (!result) throw new Error("Create a checkout session first");
      const timestamp = String(Math.floor(Date.now() / 1000));
      const usesStripeScheme = result.provider.key === "stripe";
      const body = JSON.stringify(
        usesStripeScheme
          ? {
              type: eventType,
              data: { object: { id: result.sessionId, metadata: { orderId: result.orderId } } },
            }
          : { type: eventType, sessionId: result.sessionId, metadata: { orderId: result.orderId } },
      );
      const digest = await computeHmacSignature(WEBHOOK_TEST_SECRET, `${timestamp}.${body}`);
      return apiClient.paymentWebhook({
        provider: result.provider.key,
        body,
        signature: usesStripeScheme ? `t=${timestamp},v1=${digest}` : digest,
        timestamp,
      });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Webhook rejected");
    },
  });

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Webhooks
      </p>
      <p className="mt-2 text-muted-foreground text-xs leading-relaxed">
        Deliver a signed provider event to the aggregator — the same verification path production
        webhooks take.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          disabled={!result}
          className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-foreground text-sm disabled:opacity-50"
        >
          {WEBHOOK_EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <Button onClick={() => simulate.mutate()} disabled={!result || simulate.isPending}>
          {simulate.isPending && <Loader2 size={14} className="animate-spin" />}
          Run webhook
        </Button>
      </div>
      {simulate.data && (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          <InfoRow label="received" value={simulate.data.received ? "true" : "false"} />
          <InfoRow label="event" value={simulate.data.eventType ?? "—"} />
          <InfoRow label="order" value={simulate.data.orderId ?? "—"} />
          <InfoRow label="session" value={simulate.data.sessionId ?? "—"} mono />
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground text-[11px] font-medium">{label}</Label>
      {children}
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={`text-right text-sm ${mono ? "break-all font-mono text-xs" : ""}`}>
        {value}
      </span>
    </div>
  );
}
