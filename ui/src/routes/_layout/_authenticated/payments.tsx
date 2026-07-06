import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useApiClient } from "@/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_layout/_authenticated/payments")({
  head: () => ({
    meta: [
      { title: "Payments | app" },
      { name: "description", content: "Test payment providers end to end." },
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
  sessionId: string;
  url: string;
  orderId: string;
};

type Step = "providers" | "checkout" | "session";

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
  const [step, setStep] = useState<Step>("providers");
  const [selectedProvider, setSelectedProvider] = useState<ProviderInfo | null>(null);
  const [checkoutResult, setCheckoutResult] = useState<CheckoutResult | null>(null);

  const resetToProviders = () => {
    setStep("providers");
    setSelectedProvider(null);
    setCheckoutResult(null);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5 sm:px-6 sm:py-3">
        <h1 className="text-xl font-semibold text-foreground">Payments</h1>
        {step !== "providers" && (
          <Button variant="outline" size="sm" onClick={resetToProviders}>
            <ArrowLeft size={14} />
            Back to Providers
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {step === "providers" && (
            <ProviderGrid
              onSelect={(provider) => {
                setSelectedProvider(provider);
                setStep("checkout");
              }}
            />
          )}
          {step === "checkout" && selectedProvider && (
            <CheckoutForm
              provider={selectedProvider}
              onSuccess={(result) => {
                setCheckoutResult(result);
                setStep("session");
              }}
            />
          )}
          {step === "session" && selectedProvider && checkoutResult && (
            <SessionViewer provider={selectedProvider} checkout={checkoutResult} />
          )}
        </div>
      </div>
    </div>
  );
}

function ProviderGrid({ onSelect }: { onSelect: (provider: ProviderInfo) => void }) {
  const apiClient = useApiClient();
  const {
    data: providers = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["payment-providers"],
    queryFn: () => apiClient.paymentProviders(),
  });

  if (isLoading) {
    return (
      <div className="text-muted-foreground text-center py-12 text-sm">Loading providers…</div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[12px] border border-border bg-card p-6 text-sm text-muted-foreground">
        Failed to load providers: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }

  if (providers.length === 0) {
    return (
      <div className="rounded-[12px] border border-border bg-card p-6 text-sm text-muted-foreground">
        No payment providers registered.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {providers.map((provider) => (
        <div
          key={provider.key}
          className="flex flex-col gap-3 rounded-[12px] border border-border bg-card p-6 hover:shadow-md transition-shadow"
        >
          <img
            src={provider.logo}
            alt={`${provider.name} logo`}
            className="h-10 w-10 rounded-[8px] object-contain"
          />
          <div>
            <h2 className="text-foreground text-lg font-semibold">{provider.name}</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">{provider.description}</p>
          </div>
          <Button className="mt-auto justify-center" onClick={() => onSelect(provider)}>
            Test Provider
          </Button>
        </div>
      ))}
    </div>
  );
}

function CheckoutForm({
  provider,
  onSuccess,
}: {
  provider: ProviderInfo;
  onSuccess: (result: CheckoutResult) => void;
}) {
  const apiClient = useApiClient();
  const origin = typeof window !== "undefined" ? window.location.origin : "https://example.com";
  const [orderId, setOrderId] = useState(`order_${Date.now()}`);
  const [amount, setAmount] = useState("1.00");
  const [currency, setCurrency] = useState("USD");
  const [customerEmail, setCustomerEmail] = useState("");
  const [successUrl, setSuccessUrl] = useState(`${origin}/payments?result=success`);
  const [cancelUrl, setCancelUrl] = useState(`${origin}/payments?result=cancel`);
  const [itemName, setItemName] = useState("Test item");

  const amountInCents = Math.round(Number(amount) * 100);

  const checkout = useMutation({
    mutationFn: () =>
      apiClient.paymentCheckout({
        provider: provider.key,
        orderId,
        amount: amountInCents,
        currency,
        customerEmail: customerEmail || undefined,
        successUrl,
        cancelUrl,
        items: [{ name: itemName, unitAmount: amountInCents, quantity: 1 }],
      }),
    onSuccess: (result) => {
      toast.success("Checkout session created");
      onSuccess({ sessionId: result.sessionId, url: result.url, orderId });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 rounded-[12px] border border-border bg-card p-4">
        <img
          src={provider.logo}
          alt={`${provider.name} logo`}
          className="h-8 w-8 rounded-[8px] object-contain"
        />
        <div>
          <div className="text-foreground text-sm font-semibold">{provider.name}</div>
          <div className="text-muted-foreground text-xs">Create a test checkout session</div>
        </div>
      </div>

      <form
        className="rounded-[12px] border border-border bg-card p-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          checkout.mutate();
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Order ID">
            <Input required value={orderId} onChange={(e) => setOrderId(e.target.value)} />
          </Field>
          <Field label="Item name">
            <Input required value={itemName} onChange={(e) => setItemName(e.target.value)} />
          </Field>
          <Field label="Amount (USD)">
            <Input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {Number.isFinite(amountInCents) && amountInCents > 0 && (
              <p className="text-muted-foreground text-xs">
                Sent as {amountInCents} minor units (cents)
              </p>
            )}
          </Field>
          <Field label="Currency">
            <Input required value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </Field>
          <Field label="Customer email (optional)">
            <Input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
            />
          </Field>
          <Field label="Success URL">
            <Input
              required
              type="url"
              value={successUrl}
              onChange={(e) => setSuccessUrl(e.target.value)}
            />
          </Field>
          <Field label="Cancel URL">
            <Input
              required
              type="url"
              value={cancelUrl}
              onChange={(e) => setCancelUrl(e.target.value)}
            />
          </Field>
        </div>

        {checkout.error && (
          <div className="rounded-[8px] border border-border bg-muted px-4 py-3 text-[13px] text-foreground">
            {checkout.error instanceof Error ? checkout.error.message : String(checkout.error)}
          </div>
        )}

        <Button type="submit" disabled={checkout.isPending}>
          {checkout.isPending ? "Creating session…" : "Create Checkout Session"}
        </Button>
      </form>
    </div>
  );
}

function SessionViewer({
  provider,
  checkout,
}: {
  provider: ProviderInfo;
  checkout: CheckoutResult;
}) {
  const apiClient = useApiClient();
  const [sessionId, setSessionId] = useState(checkout.sessionId);

  const sessionQuery = useQuery({
    queryKey: ["payment-session", provider.key, sessionId],
    queryFn: () => apiClient.paymentSession({ provider: provider.key, sessionId }),
    enabled: !!sessionId,
    retry: false,
  });

  const copySessionId = async () => {
    await navigator.clipboard.writeText(checkout.sessionId);
    toast.success("Session ID copied");
  };

  const session = sessionQuery.data?.session;

  return (
    <div className="space-y-6">
      <div className="rounded-[12px] border border-border bg-card p-6 space-y-3">
        <div className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
          Checkout Result — {provider.name}
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-[8px] border border-border bg-muted px-3 py-2 font-mono text-xs text-foreground break-all">
            {checkout.sessionId}
          </code>
          <Button variant="outline" size="sm" onClick={copySessionId}>
            <Copy size={14} />
            Copy
          </Button>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={checkout.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} />
            Open Checkout URL
          </a>
        </Button>
      </div>

      <div className="rounded-[12px] border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
            Session Status
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!sessionId || sessionQuery.isFetching}
            onClick={() => sessionQuery.refetch()}
          >
            <RefreshCw size={14} />
            {sessionQuery.isFetching ? "Refreshing…" : "View Session Status"}
          </Button>
        </div>
        <Field label="Session ID">
          <Input value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
        </Field>
        {sessionQuery.error && (
          <div className="rounded-[8px] border border-border bg-muted px-4 py-3 text-[13px] text-foreground">
            {sessionQuery.error instanceof Error
              ? sessionQuery.error.message
              : String(sessionQuery.error)}
          </div>
        )}
        {session && (
          <div className="flex flex-col gap-2">
            <InfoRow label="id" value={session.id} mono />
            <InfoRow label="status" value={session.status} />
            <InfoRow label="payment" value={session.paymentStatus} />
            <InfoRow
              label="amount"
              value={session.amountTotal !== undefined ? String(session.amountTotal) : "—"}
            />
            <InfoRow label="currency" value={session.currency ?? "—"} />
            {Object.entries(session.metadata ?? {}).map(([key, value]) => (
              <InfoRow key={key} label={key} value={value} />
            ))}
          </div>
        )}
      </div>

      <WebhookSimulator
        provider={provider}
        sessionId={sessionId}
        defaultOrderId={checkout.orderId}
      />
    </div>
  );
}

function WebhookSimulator({
  provider,
  sessionId,
  defaultOrderId,
}: {
  provider: ProviderInfo;
  sessionId: string;
  defaultOrderId: string;
}) {
  const apiClient = useApiClient();
  const [eventType, setEventType] = useState<string>(WEBHOOK_EVENT_TYPES[0]);
  const [orderId, setOrderId] = useState(defaultOrderId);

  const simulate = useMutation({
    mutationFn: async () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({
        type: eventType,
        sessionId,
        metadata: { orderId },
      });
      const signature = await computeHmacSignature(WEBHOOK_TEST_SECRET, `${timestamp}.${body}`);
      return apiClient.paymentWebhook({
        provider: provider.key,
        body,
        signature,
        timestamp,
      });
    },
  });

  return (
    <div className="rounded-[12px] border border-border bg-card p-6 space-y-4">
      <div className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
        Webhook Simulator
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Event type">
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="h-9 w-full rounded-[8px] border border-border bg-background px-3 text-sm text-foreground"
          >
            {WEBHOOK_EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Order ID">
          <Input value={orderId} onChange={(e) => setOrderId(e.target.value)} />
        </Field>
      </div>

      {simulate.error && (
        <div className="rounded-[8px] border border-border bg-muted px-4 py-3 text-[13px] text-foreground">
          {simulate.error instanceof Error ? simulate.error.message : String(simulate.error)}
        </div>
      )}

      {simulate.data && (
        <div className="flex flex-col gap-2">
          <InfoRow label="received" value={simulate.data.received ? "true" : "false"} />
          <InfoRow label="event" value={simulate.data.eventType ?? "—"} />
          <InfoRow label="order" value={simulate.data.orderId ?? "—"} />
          <InfoRow label="session" value={simulate.data.sessionId ?? "—"} mono />
        </div>
      )}

      <Button disabled={simulate.isPending} onClick={() => simulate.mutate()}>
        {simulate.isPending ? "Sending…" : "Simulate Webhook"}
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
        {label}
      </Label>
      {children}
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-4 rounded-[8px] border border-border bg-muted px-3.5 py-2.5 items-center">
      <span className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
        {label}
      </span>
      <span className={`text-foreground text-[13px] break-all ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </span>
    </div>
  );
}
