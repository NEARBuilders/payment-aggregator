import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Loader2, RefreshCw, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { AuthClient } from "@/app";
import { sessionQueryOptions, useApiClient, useAuthClient } from "@/app";
import { AppFooter } from "@/components/app-footer";
import { TopNav } from "@/components/top-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPlanAmount, formatPlanRange, nearToYocto, yoctoToNear } from "@/lib/near-amount";
import { pollUntil } from "@/lib/poll";

export const Route = createFileRoute("/subscriptions")({
  validateSearch: (search: Record<string, unknown>) => ({
    checkout: typeof search.checkout === "string" ? search.checkout : undefined,
  }),
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
      { title: "Subscriptions — pay.everything.dev" },
      { name: "description", content: "Recurring payments from staking yield or card." },
    ],
  }),
  component: SubscriptionsPage,
});

type ProviderInfo = {
  key: string;
  name: string;
  logo: string;
  description: string;
};

type Plan = {
  id: string;
  name: string;
  description?: string;
  period: string;
  currency: string;
  minAmount: string;
  maxAmount: string;
  metadata?: Record<string, string>;
};

type SubscriptionInfo = {
  id?: string;
  planId: string;
  status: "active" | "cancel_at_period_end" | "pending_unstake" | "ended" | "none";
  amount?: string;
  currency?: string;
  currentPeriodEnd?: string;
  payerRef: string;
  metadata?: Record<string, string>;
};

type WalletIntent = {
  kind: "wallet_intent";
  networkId: string;
  contractId: string;
  actions: Array<{
    methodName: string;
    args: Record<string, unknown>;
    deposit: string;
    gas: string;
  }>;
};

type SubscriptionAction =
  | WalletIntent
  | { kind: "redirect"; url: string }
  | { kind: "executed"; subscription: SubscriptionInfo };

const BRAND_COLORS: Record<string, string> = {
  stake2pay: "#00C08B",
  stripe: "#635BFF",
};

const DEMO_PLANS: Record<string, Record<string, string | null>> = {
  stake2pay: { Starter: "1" },
  stripe: { "Demo Subscription": null },
};

const EMAIL_PAYER_PROVIDERS = new Set(["stripe"]);

function isValidEmail(value: string | null | undefined): value is string {
  return !!value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const STATUS_LABELS: Record<SubscriptionInfo["status"], string> = {
  active: "Active",
  cancel_at_period_end: "Cancels at period end",
  pending_unstake: "Unstaking",
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

async function signWalletIntent(authClient: AuthClient, intent: WalletIntent) {
  const connected = await authClient.near.ensureConnected();
  if (!connected) {
    throw new Error("Connect a NEAR wallet to sign this transaction");
  }
  const accountId = authClient.near.getAccountId();
  if (!accountId) {
    throw new Error("No NEAR account linked to this session");
  }
  const network = authClient.near.getNetwork();
  if (network !== intent.networkId) {
    throw new Error(`Wallet is on ${network}, but this subscription needs ${intent.networkId}`);
  }

  // max_total_prepaid_gas is 1000 Tgas as of protocol v84/v85 (verified via
  // EXPERIMENTAL_protocol_config); intents exceeding it sign as sequential txs.
  const totalGas = intent.actions.reduce((sum, action) => sum + BigInt(action.gas), 0n);
  const batches =
    totalGas <= 1_000_000_000_000_000n
      ? [intent.actions]
      : intent.actions.map((action) => [action]);

  for (const batch of batches) {
    let tx = authClient.near.client.transaction(accountId);
    for (const action of batch) {
      tx = tx.functionCall(intent.contractId, action.methodName, action.args, {
        gas: action.gas as `${number}`,
        attachedDeposit: BigInt(action.deposit),
      });
    }
    await tx.send();
  }
}

function SubscriptionsPage() {
  const { checkout } = Route.useSearch();
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const { session } = Route.useRouteContext();

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [nearAccountId, setNearAccountId] = useState<string | null>(null);

  useEffect(() => {
    setNearAccountId(authClient.near.getAccountId());
  }, [authClient]);

  useEffect(() => {
    if (checkout === "success") {
      toast.success("Checkout complete — subscription status will update shortly");
    }
  }, [checkout]);

  const emailRef = session?.user?.email ?? null;
  const payerRef = nearAccountId ?? emailRef;

  const { data: providers, isLoading } = useQuery({
    queryKey: ["subscription-providers"],
    queryFn: () => apiClient.subscriptionProviders(),
  });

  const selectedProvider =
    providers?.find((provider) => provider.key === selectedKey) ?? providers?.[0] ?? null;

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background text-foreground">
      <TopNav />
      <div className="pointer-events-none absolute inset-x-0 top-14 h-[480px] bg-[radial-gradient(65%_55%_at_50%_0%,rgba(0,192,139,0.12),transparent_70%)]" />

      <main className="relative flex-1 px-5 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 max-w-xl">
            <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.25em] text-[#00A578] dark:text-[#38D9A9]">
              Subscriptions
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-[2.75rem] sm:leading-[1.1]">
              Pay with yield,
              <br />
              not principal.
            </h1>
            <p className="mt-4 text-muted-foreground text-sm leading-relaxed">
              Stake NEAR and let validator rewards cover your plan — or pay by card through Stripe.
              Every provider speaks the same subscription contract.
            </p>
          </div>

          {isLoading && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="h-24 animate-pulse rounded-2xl bg-muted" />
              <div className="h-24 animate-pulse rounded-2xl bg-muted" />
            </div>
          )}

          {!isLoading && (!providers || providers.length === 0) && (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center">
              <p className="font-medium">No subscription providers registered</p>
              <p className="mt-1 text-muted-foreground text-sm">
                Register a plugin implementing the subscription contract in bos.config.json and it
                will appear here.
              </p>
            </div>
          )}

          {providers && providers.length > 0 && (
            <>
              <div className="mb-8 grid gap-3 sm:grid-cols-2">
                {providers.map((provider) => {
                  const selected = selectedProvider?.key === provider.key;
                  const brand = BRAND_COLORS[provider.key] ?? "#18181B";
                  return (
                    <button
                      key={provider.key}
                      type="button"
                      onClick={() => setSelectedKey(provider.key)}
                      style={selected ? { borderColor: brand } : undefined}
                      className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition-all duration-150 ${
                        selected ? "bg-muted/40 shadow-sm" : "border-border hover:bg-muted/30"
                      }`}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background">
                        <img src={provider.logo} alt="" className="h-5 w-5 object-contain" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{provider.name}</span>
                        <span className="block truncate text-muted-foreground text-xs">
                          {provider.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {selectedProvider && (
                <ProviderPlans
                  key={selectedProvider.key}
                  provider={selectedProvider}
                  payerRef={EMAIL_PAYER_PROVIDERS.has(selectedProvider.key) ? emailRef : payerRef}
                  hasNearWallet={!!nearAccountId}
                  isEmailPayer={EMAIL_PAYER_PROVIDERS.has(selectedProvider.key)}
                />
              )}
            </>
          )}
        </div>
      </main>

      <AppFooter />
    </div>
  );
}

function ProviderPlans({
  provider,
  payerRef,
  hasNearWallet,
  isEmailPayer,
}: {
  provider: ProviderInfo;
  payerRef: string | null;
  hasNearWallet: boolean;
  isEmailPayer: boolean;
}) {
  const apiClient = useApiClient();

  const [emailInput, setEmailInput] = useState("");
  const sessionEmail = isEmailPayer && isValidEmail(payerRef) ? payerRef : null;
  const effectivePayerRef = isEmailPayer
    ? (sessionEmail ?? (isValidEmail(emailInput.trim()) ? emailInput.trim() : null))
    : payerRef;
  const needsEmail = isEmailPayer && !sessionEmail;

  const { data: plans, isLoading } = useQuery({
    queryKey: ["subscription-plans", provider.key],
    queryFn: () => apiClient.subscriptionPlans({ provider: provider.key }),
  });

  const demoPlans = DEMO_PLANS[provider.key];
  const visiblePlans = useMemo(() => {
    if (!plans) return [];
    if (!demoPlans) return plans;
    return plans.filter((plan) => {
      if (!(plan.name in demoPlans)) return false;
      const fixedStake = demoPlans[plan.name];
      if (fixedStake === null) return true;
      const yocto = nearToYocto(fixedStake ?? "");
      return yocto !== null && yocto >= BigInt(plan.minAmount) && yocto <= BigInt(plan.maxAmount);
    });
  }, [plans, demoPlans]);

  const statusQueries = useQueries({
    queries: visiblePlans.map((plan) => ({
      queryKey: ["subscription-status", provider.key, plan.id, effectivePayerRef],
      queryFn: () =>
        apiClient.subscriptionGet({
          provider: provider.key,
          planId: plan.id,
          payerRef: effectivePayerRef ?? undefined,
        }),
      enabled: !!effectivePayerRef,
      retry: false,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    })),
  });

  // HoS subscriptions are keyed per product, so the same subscription comes
  // back for every price in the catalog — only the card whose plan matches
  // the subscription's actual price owns it.
  const subscriptions = visiblePlans.map((plan, index) => {
    const raw = (statusQueries[index]?.data ?? null) as SubscriptionInfo | null;
    if (!raw) return null;
    if (raw.status === "none" || raw.planId === plan.id) return raw;
    return { planId: plan.id, status: "none" as const, payerRef: raw.payerRef };
  });
  const activePlan =
    visiblePlans.find((_, index) => {
      const status = subscriptions[index]?.status;
      return status === "active" || status === "cancel_at_period_end";
    }) ?? null;

  if (isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-64 animate-pulse rounded-2xl bg-muted" />
        <div className="h-64 animate-pulse rounded-2xl bg-muted" />
        <div className="h-64 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  if (visiblePlans.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
        {provider.name} has no active plans right now.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {needsEmail && (
        <div className="max-w-md rounded-2xl border border-border bg-card p-5">
          <label htmlFor="payer-email" className="font-medium text-sm">
            Billing email
          </label>
          <p className="mt-0.5 text-muted-foreground text-xs">
            {provider.name} bills by email — enter one to subscribe or check your status.
          </p>
          <Input
            id="payer-email"
            type="email"
            inputMode="email"
            placeholder="you@example.com"
            value={emailInput}
            onChange={(event) => setEmailInput(event.target.value)}
            className="mt-3"
          />
          {emailInput.trim() && !isValidEmail(emailInput.trim()) && (
            <p className="mt-1.5 text-red-500 text-xs">Enter a valid email address.</p>
          )}
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        {visiblePlans.map((plan, index) => (
          <PlanCard
            key={plan.id}
            provider={provider}
            plan={plan}
            payerRef={effectivePayerRef}
            isEmailPayer={isEmailPayer}
            hasNearWallet={hasNearWallet}
            fixedStakeNear={demoPlans?.[plan.name] ?? null}
            subscription={subscriptions[index] ?? null}
            isFetching={statusQueries[index]?.isFetching ?? false}
            activeElsewherePlan={activePlan && activePlan.id !== plan.id ? activePlan : null}
          />
        ))}
      </div>
    </div>
  );
}

function PlanCard({
  provider,
  plan,
  payerRef,
  isEmailPayer,
  hasNearWallet,
  fixedStakeNear,
  subscription,
  isFetching,
  activeElsewherePlan,
}: {
  provider: ProviderInfo;
  plan: Plan;
  payerRef: string | null;
  isEmailPayer: boolean;
  hasNearWallet: boolean;
  fixedStakeNear: string | null;
  subscription: SubscriptionInfo | null;
  isFetching: boolean;
  activeElsewherePlan: Plan | null;
}) {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const origin = typeof window !== "undefined" ? window.location.origin : "https://example.com";

  const isRange = plan.minAmount !== plan.maxAmount;
  const [inputNear, setInputNear] = useState(() => yoctoToNear(plan.minAmount));
  const amountNear = fixedStakeNear ?? inputNear;

  const statusQueryKey = ["subscription-status", provider.key, plan.id, payerRef];
  const status = subscription?.status ?? "none";

  const amountYocto = plan.currency === "NEAR" ? nearToYocto(amountNear) : BigInt(plan.minAmount);
  const amountValid =
    amountYocto !== null &&
    amountYocto >= BigInt(plan.minAmount) &&
    amountYocto <= BigInt(plan.maxAmount);

  const refreshStatus = () => queryClient.invalidateQueries({ queryKey: statusQueryKey });

  const dispatchAction = async (
    action: SubscriptionAction,
    settled: (subscription: SubscriptionInfo) => boolean,
  ) => {
    if (action.kind === "redirect") {
      window.location.href = action.url;
      return;
    }
    if (action.kind === "executed") {
      queryClient.setQueryData(statusQueryKey, action.subscription);
      return;
    }
    await signWalletIntent(authClient, action);
    toast.info("Transaction sent — waiting for the chain to reflect it");
    const settledSubscription = await pollUntil(
      () =>
        apiClient.subscriptionGet({
          provider: provider.key,
          planId: plan.id,
          payerRef: payerRef ?? undefined,
        }) as Promise<SubscriptionInfo>,
      settled,
    );
    queryClient.setQueryData(statusQueryKey, settledSubscription);
  };

  const subscribe = useMutation({
    mutationFn: async () => {
      const action = (await apiClient.subscriptionCreate({
        provider: provider.key,
        planId: plan.id,
        amount: isRange || plan.currency === "NEAR" ? amountYocto?.toString() : undefined,
        payerRef: isEmailPayer ? (payerRef ?? undefined) : undefined,
        successUrl: `${origin}/subscriptions?checkout=success`,
        cancelUrl: `${origin}/subscriptions?checkout=cancel`,
      })) as SubscriptionAction;
      await dispatchAction(action, (s) => s.status === "active");
    },
    onSuccess: () => toast.success(`Subscribed to ${plan.name}`),
    onError: (error: Error) => toast.error(error.message || "Subscription failed"),
    onSettled: refreshStatus,
  });

  const cancel = useMutation({
    mutationFn: async () => {
      const action = (await apiClient.subscriptionCancel({
        provider: provider.key,
        planId: plan.id,
        payerRef: payerRef ?? undefined,
      })) as SubscriptionAction;
      await dispatchAction(action, (s) => s.status !== "active");
    },
    onSuccess: () => toast.success("Subscription will end at the period boundary"),
    onError: (error: Error) => toast.error(error.message || "Cancel failed"),
    onSettled: refreshStatus,
  });

  const resume = useMutation({
    mutationFn: async () => {
      const action = (await apiClient.subscriptionResume({
        provider: provider.key,
        planId: plan.id,
        payerRef: payerRef ?? undefined,
      })) as SubscriptionAction;
      await dispatchAction(action, (s) => s.status === "active");
    },
    onSuccess: () => toast.success("Subscription resumed"),
    onError: (error: Error) => toast.error(error.message || "Resume failed"),
    onSettled: refreshStatus,
  });

  const changePlan = useMutation({
    mutationFn: async (fromPlan: Plan) => {
      const action = (await apiClient.subscriptionChange({
        provider: provider.key,
        planId: fromPlan.id,
        newPlanId: plan.id,
        amount: plan.currency === "NEAR" ? amountYocto?.toString() : undefined,
        payerRef: payerRef ?? undefined,
      })) as SubscriptionAction;
      await dispatchAction(action, (s) => s.status !== "none");
      await queryClient.invalidateQueries({ queryKey: ["subscription-status", provider.key] });
    },
    onSuccess: () => toast.success(`Plan change to ${plan.name} submitted`),
    onError: (error: Error) => toast.error(error.message || "Plan change failed"),
  });

  const busy = subscribe.isPending || cancel.isPending || resume.isPending || changePlan.isPending;
  const brand = BRAND_COLORS[provider.key] ?? "#18181B";

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
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {plan.period}
        </span>
      </div>

      <p className="mt-4 text-xl font-semibold tracking-tight">
        {formatPlanRange(plan.minAmount, plan.maxAmount, plan.currency)}
        <span className="ml-1 text-muted-foreground text-xs font-normal">
          / {plan.period.replace(/ly$/, "")}
        </span>
      </p>

      {plan.currency === "NEAR" && fixedStakeNear && (
        <div className="mt-4 flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
          <span className="text-muted-foreground text-[11px] font-medium">Stake amount</span>
          <span className="font-semibold text-sm">{fixedStakeNear} NEAR</span>
        </div>
      )}

      {isRange && plan.currency === "NEAR" && !fixedStakeNear && (
        <div className="mt-4 space-y-1.5">
          <label
            htmlFor={`stake-${plan.id}`}
            className="text-muted-foreground text-[11px] font-medium"
          >
            Stake amount (NEAR)
          </label>
          <Input
            id={`stake-${plan.id}`}
            inputMode="decimal"
            value={inputNear}
            onChange={(event) => setInputNear(event.target.value)}
            disabled={busy || status !== "none"}
          />
          {!amountValid && (
            <p className="text-red-500 text-xs">
              Enter between {yoctoToNear(plan.minAmount)} and {yoctoToNear(plan.maxAmount)} NEAR
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
          {STATUS_LABELS[status]}
        </span>
        {payerRef && (
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

      {subscription && status !== "none" && (
        <div className="mt-3 space-y-1.5 border-t border-border pt-3 text-xs">
          {subscription.amount && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Locked</span>
              <span>{formatPlanAmount(subscription.amount, subscription.currency ?? "NEAR")}</span>
            </div>
          )}
          {subscription.currentPeriodEnd && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Period ends</span>
              <span>{new Date(subscription.currentPeriodEnd).toLocaleDateString()}</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-5 space-y-2">
        {status === "none" && (
          <Button
            className="w-full text-white"
            style={{ backgroundColor: brand }}
            disabled={
              busy ||
              !amountValid ||
              (!hasNearWallet && plan.currency === "NEAR") ||
              (isEmailPayer && !payerRef)
            }
            onClick={() => subscribe.mutate()}
          >
            {subscribe.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : plan.currency === "NEAR" ? (
              <Wallet size={15} />
            ) : (
              <ArrowRight size={15} />
            )}
            {plan.currency === "NEAR" ? "Stake & subscribe" : "Subscribe with card"}
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

        {status === "none" && activeElsewherePlan && (
          <Button
            variant="ghost"
            className="w-full text-xs"
            disabled={busy}
            onClick={() => changePlan.mutate(activeElsewherePlan)}
          >
            {changePlan.isPending && <Loader2 size={13} className="animate-spin" />}
            Switch here from {activeElsewherePlan.name}
          </Button>
        )}
      </div>

      {status === "none" && plan.currency === "NEAR" && !hasNearWallet && (
        <p className="mt-2 text-muted-foreground text-[11px]">
          Sign in with a NEAR wallet to stake for this plan.
        </p>
      )}

      {status === "pending_unstake" && (
        <p className="mt-2 flex items-center gap-1.5 text-muted-foreground text-[11px]">
          <CheckCircle2 size={12} />
          Funds return once the epoch unstake pipeline settles.
        </p>
      )}
    </div>
  );
}
