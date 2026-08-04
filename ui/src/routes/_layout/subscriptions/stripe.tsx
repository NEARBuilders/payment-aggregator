import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { sessionQueryOptions, useApiClient, useAuthClient } from "@/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPlanRange } from "@/lib/near-amount";
import type { SubscriptionAction, SubscriptionInfo } from "@/lib/wallet-intent";

const PROVIDER = "stripe";

type Plan = {
  id: string;
  name: string;
  description?: string;
  period: string;
  currency: string;
  minAmount: string;
  maxAmount: string;
};

function isValidEmail(value: string | null | undefined): value is string {
  return !!value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const STATUS_LABELS: Record<SubscriptionInfo["status"], string> = {
  active: "Active",
  cancel_at_period_end: "Cancels at period end",
  pending_unstake: "Pending",
  ended: "Ended",
  none: "Not subscribed",
};

const STATUS_STYLES: Record<SubscriptionInfo["status"], string> = {
  active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  cancel_at_period_end: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  pending_unstake: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  ended: "bg-muted text-muted-foreground",
  none: "bg-muted text-muted-foreground",
};

export const Route = createFileRoute("/_layout/subscriptions/stripe")({
  validateSearch: (search: Record<string, unknown>) => ({
    checkout: typeof search.checkout === "string" ? search.checkout : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Stripe Subscriptions — pay.everything.dev" },
      { name: "description", content: "Subscribe by card through Stripe Billing." },
    ],
  }),
  component: StripePage,
});

function StripePage() {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const { checkout } = Route.useSearch();
  const origin = typeof window !== "undefined" ? window.location.origin : "https://example.com";

  const { data: sessionData } = useQuery(sessionQueryOptions(authClient, undefined));
  const activeOrgId = sessionData?.session?.activeOrganizationId ?? null;

  const [emailInput, setEmailInput] = useState("");
  const effectiveEmail = isValidEmail(emailInput.trim()) ? emailInput.trim() : null;

  useEffect(() => {
    if (checkout === "success") {
      toast.success("Checkout complete — subscription status will update shortly");
    } else if (checkout === "cancel") {
      toast.info("Checkout cancelled");
    }
  }, [checkout]);

  const { data: plans, isLoading: plansLoading } = useQuery({
    queryKey: ["subscription-plans", PROVIDER],
    queryFn: () => apiClient.subscriptionPlans({ provider: PROVIDER }),
  });

  const statusQueries = useQueries({
    queries: (plans ?? []).map((plan) => ({
      queryKey: ["subscription-status", PROVIDER, plan.id, effectiveEmail],
      queryFn: () =>
        apiClient.subscriptionGet({
          provider: PROVIDER,
          planId: plan.id,
          payerRef: effectiveEmail ?? undefined,
        }) as Promise<SubscriptionInfo>,
      enabled: !!effectiveEmail,
      retry: false,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    })),
  });

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Subscribe with card</h2>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
            sandbox
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Stripe Billing — pay by card, cancel any time.
        </p>
      </div>

      <div className="max-w-md rounded-2xl border border-border bg-card p-5">
        <label htmlFor="billing-email" className="font-medium text-sm">
          Billing email
        </label>
        <p className="mt-0.5 text-muted-foreground text-xs">
          Enter your email to subscribe or check your current status.
        </p>
        <Input
          id="billing-email"
          type="email"
          inputMode="email"
          placeholder="you@example.com"
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
          className="mt-3"
        />
        {emailInput.trim() && !isValidEmail(emailInput.trim()) && (
          <p className="mt-1.5 text-red-500 text-xs">Enter a valid email address.</p>
        )}
      </div>

      {plansLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : !plans?.length ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
          No Stripe subscription plans available right now.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(plans as Plan[]).map((plan, index) => (
            <StripePlanCard
              key={plan.id}
              plan={plan}
              email={effectiveEmail}
              activeOrgId={activeOrgId}
              subscription={(statusQueries[index]?.data ?? null) as SubscriptionInfo | null}
              isFetching={statusQueries[index]?.isFetching ?? false}
              origin={origin}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StripePlanCard({
  plan,
  email,
  activeOrgId,
  subscription,
  isFetching,
  origin,
}: {
  plan: Plan;
  email: string | null;
  activeOrgId: string | null;
  subscription: SubscriptionInfo | null;
  isFetching: boolean;
  origin: string;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  const statusQueryKey = ["subscription-status", PROVIDER, plan.id, email];
  const status = subscription?.status ?? "none";
  const isActive = status === "active" || status === "cancel_at_period_end";

  const refreshStatus = () => queryClient.invalidateQueries({ queryKey: statusQueryKey });

  const notifySyncResult = (sync: { granted: boolean; reason: string }) => {
    switch (sync.reason) {
      case "granted":
        toast.success("Credits synced");
        break;
      case "already_synced":
        toast.info("Already up to date — no new billing cycle since last sync");
        break;
      case "not_ready":
        toast.info("Subscription active but billing details aren't ready yet — try again shortly");
        break;
      default:
        toast.info("No active subscription to sync");
    }
  };

  const syncCredits = useMutation({
    mutationFn: async () => {
      if (!email) throw new Error("Email required");
      const sync = await apiClient.subscriptionCreditSync({
        provider: PROVIDER,
        planId: plan.id,
        payerRef: email,
      });
      queryClient.setQueryData(["credits", activeOrgId], sync.balances);
      return sync;
    },
    onSuccess: notifySyncResult,
    onError: (error: Error) => toast.error(error.message || "Sync failed"),
  });

  const subscribe = useMutation({
    mutationFn: async () => {
      const action = (await apiClient.subscriptionCreate({
        provider: PROVIDER,
        planId: plan.id,
        payerRef: email ?? undefined,
        successUrl: `${origin}/subscriptions/stripe?checkout=success`,
        cancelUrl: `${origin}/subscriptions/stripe?checkout=cancel`,
      })) as SubscriptionAction;
      if (action.kind === "redirect") {
        window.location.assign(action.url);
      } else if (action.kind === "executed") {
        queryClient.setQueryData(statusQueryKey, action.subscription);
      }
    },
    onError: (error: Error) => toast.error(error.message || "Subscription failed"),
    onSettled: refreshStatus,
  });

  const cancel = useMutation({
    mutationFn: async () => {
      const action = (await apiClient.subscriptionCancel({
        provider: PROVIDER,
        planId: plan.id,
        payerRef: email ?? undefined,
      })) as SubscriptionAction;
      if (action.kind === "executed") {
        queryClient.setQueryData(statusQueryKey, action.subscription);
      }
    },
    onSuccess: () => toast.success("Subscription will end at the period boundary"),
    onError: (error: Error) => toast.error(error.message || "Cancel failed"),
    onSettled: refreshStatus,
  });

  const resume = useMutation({
    mutationFn: async () => {
      const action = (await apiClient.subscriptionResume({
        provider: PROVIDER,
        planId: plan.id,
        payerRef: email ?? undefined,
      })) as SubscriptionAction;
      if (action.kind === "executed") {
        queryClient.setQueryData(statusQueryKey, action.subscription);
      }
    },
    onSuccess: () => toast.success("Subscription resumed"),
    onError: (error: Error) => toast.error(error.message || "Resume failed"),
    onSettled: refreshStatus,
  });

  const busy = subscribe.isPending || cancel.isPending || resume.isPending || syncCredits.isPending;

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{plan.name}</p>
          {plan.description && (
            <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
              {plan.description}
            </p>
          )}
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
          {plan.period}
        </span>
      </div>

      <p className="mt-3 text-xl font-semibold tracking-tight">
        {formatPlanRange(plan.minAmount, plan.maxAmount, plan.currency)}
        <span className="ml-1 text-muted-foreground text-xs font-normal">
          / {plan.period.replace(/ly$/, "")}
        </span>
      </p>

      <div className="mt-3 flex items-center justify-between">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
          {STATUS_LABELS[status]}
        </span>
        {email && (
          <button
            type="button"
            onClick={refreshStatus}
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Refresh status"
          >
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          </button>
        )}
      </div>

      {subscription && status !== "none" && subscription.currentPeriodEnd && (
        <div className="mt-3 border-t border-border pt-3 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Period ends</span>
            <span>{new Date(subscription.currentPeriodEnd).toLocaleDateString()}</span>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2 flex-1 flex flex-col justify-end">
        {status === "none" && (
          <Button
            className="w-full text-white"
            style={{ backgroundColor: "#635BFF" }}
            disabled={busy || !email}
            onClick={() => subscribe.mutate()}
          >
            {subscribe.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <ArrowRight size={15} />
            )}
            Subscribe with card
          </Button>
        )}

        {status === "active" && (
          <Button
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => cancel.mutate()}
          >
            {cancel.isPending && <Loader2 size={15} className="animate-spin" />}
            Cancel at period end
          </Button>
        )}

        {status === "cancel_at_period_end" && (
          <Button
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => resume.mutate()}
          >
            {resume.isPending && <Loader2 size={15} className="animate-spin" />}
            Resume subscription
          </Button>
        )}

        {isActive && (
          <Button
            variant="ghost"
            className="w-full text-xs"
            disabled={busy || !email}
            onClick={() => syncCredits.mutate()}
          >
            {syncCredits.isPending && <Loader2 size={13} className="animate-spin" />}
            Sync credits
          </Button>
        )}

        {status === "none" && !email && (
          <p className="text-center text-muted-foreground text-[11px]">
            Enter a billing email above to subscribe.
          </p>
        )}
      </div>
    </div>
  );
}
