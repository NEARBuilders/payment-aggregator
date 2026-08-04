import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, RefreshCw, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useApiClient, useAuthClient, useAuthState } from "@/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPlanRange, nearToYocto, yoctoToNear } from "@/lib/near-amount";
import { pollUntil } from "@/lib/poll";
import type { SubscriptionAction, SubscriptionInfo } from "@/lib/wallet-intent";
import { signWalletIntent } from "@/lib/wallet-intent";

const PROVIDER = "stake2pay";

type Plan = {
  id: string;
  name: string;
  description?: string;
  period: string;
  currency: string;
  minAmount: string;
  maxAmount: string;
};

type CreditBalance = {
  creditType: string;
  balance: string;
};

const STATUS_LABELS: Record<SubscriptionInfo["status"], string> = {
  active: "Active",
  cancel_at_period_end: "Cancels at period end",
  pending_unstake: "Unstaking",
  ended: "Ended",
  none: "Not staked",
};

const STATUS_STYLES: Record<SubscriptionInfo["status"], string> = {
  active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  cancel_at_period_end: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  pending_unstake: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  ended: "bg-muted text-muted-foreground",
  none: "bg-muted text-muted-foreground",
};

export const Route = createFileRoute("/_layout/subscriptions/stake2pay")({
  head: () => ({
    meta: [
      { title: "Stake2Pay — pay.everything.dev" },
      { name: "description", content: "Stake NEAR, earn inference credits." },
    ],
  }),
  component: Stake2PayPage,
});

function Stake2PayPage() {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const queryClient = useQueryClient();

  const { activeOrgId, isAuthenticated } = useAuthState();

  const [nearAccountId, setNearAccountId] = useState<string | null>(null);
  const [optimisticBalance, setOptimisticBalance] = useState<string | null>(null);

  useEffect(() => {
    const previousNetwork = authClient.near.getNetwork();
    authClient.near.setNetwork("testnet");
    setNearAccountId(authClient.near.getAccountId());
    return () => {
      authClient.near.setNetwork(previousNetwork);
    };
  }, [authClient]);

  const { data: plans, isLoading: plansLoading } = useQuery({
    queryKey: ["subscription-plans", PROVIDER],
    queryFn: () => apiClient.subscriptionPlans({ provider: PROVIDER }),
  });

  const { data: balances, refetch: refetchBalances } = useQuery({
    queryKey: ["credits", activeOrgId],
    queryFn: () => apiClient.creditList() as Promise<CreditBalance[]>,
    enabled: !!nearAccountId,
  });
  const defaultBalance = balances?.find((b) => b.creditType === "default")?.balance ?? "0";
  const displayBalance = optimisticBalance ?? defaultBalance;

  const connectWallet = useMutation({
    mutationFn: async () => {
      if (isAuthenticated) {
        await authClient.near.link();
      } else {
        await authClient.signIn.near();
      }
    },
    onSuccess: () => {
      setNearAccountId(authClient.near.getAccountId());
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (error: Error) => toast.error(error.message || "Wallet connection failed"),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Stake NEAR, earn inference credits.
          </h2>
          {nearAccountId && (
            <p className="mt-1 text-sm text-muted-foreground font-mono truncate">{nearAccountId}</p>
          )}
        </div>
        {nearAccountId && (
          <div className="rounded-2xl border border-border bg-card px-5 py-4 text-right shrink-0">
            <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Credit balance
            </p>
            <p className="text-3xl font-semibold tabular-nums">{displayBalance}</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-lg border border-border p-0.5 text-xs font-medium">
          {(["testnet", "mainnet"] as const).map((option) => (
            <span
              key={option}
              title={option === "mainnet" ? "Mainnet staking is coming soon" : undefined}
              className={`rounded-md px-3 py-1.5 capitalize ${
                option === "testnet"
                  ? "bg-muted text-foreground"
                  : "cursor-not-allowed text-muted-foreground opacity-40"
              }`}
            >
              {option}
            </span>
          ))}
        </div>
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
          testnet
        </span>
      </div>

      {!nearAccountId ? (
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="mb-4 text-sm text-muted-foreground">
            Connect a NEAR testnet wallet to view plans and stake.
          </p>
          <Button
            className="w-full text-white"
            style={{ backgroundColor: "#00C08B" }}
            disabled={connectWallet.isPending}
            onClick={() => connectWallet.mutate()}
          >
            {connectWallet.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Wallet size={15} />
            )}
            Connect NEAR wallet
          </Button>
        </div>
      ) : plansLoading ? (
        <div className="h-48 animate-pulse rounded-2xl bg-muted" />
      ) : !plans?.length ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
          No stake2pay plans available right now.
        </div>
      ) : (
        <UnifiedStakeForm
          plans={plans as Plan[]}
          nearAccountId={nearAccountId}
          activeOrgId={activeOrgId}
          onOptimisticBalance={setOptimisticBalance}
          onRefetchBalances={() => void refetchBalances()}
        />
      )}
    </div>
  );
}

function UnifiedStakeForm({
  plans,
  nearAccountId,
  activeOrgId,
  onOptimisticBalance,
  onRefetchBalances,
}: {
  plans: Plan[];
  nearAccountId: string;
  activeOrgId: string | null;
  onOptimisticBalance: (balance: string | null) => void;
  onRefetchBalances: () => void;
}) {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const queryClient = useQueryClient();

  const overallMin = plans.reduce(
    (min, p) => (BigInt(p.minAmount) < min ? BigInt(p.minAmount) : min),
    BigInt(plans[0]?.minAmount ?? "0"),
  );
  const overallMax = plans.reduce(
    (max, p) => (BigInt(p.maxAmount) > max ? BigInt(p.maxAmount) : max),
    BigInt(plans[0]?.maxAmount ?? "0"),
  );

  const [inputNear, setInputNear] = useState(() => yoctoToNear(plans[0]?.minAmount ?? "0") ?? "");

  const amountYocto = nearToYocto(inputNear);
  const matchingPlan =
    amountYocto !== null
      ? (plans.find(
          (p) => amountYocto >= BigInt(p.minAmount) && amountYocto <= BigInt(p.maxAmount),
        ) ?? null)
      : null;
  const amountValid = matchingPlan !== null && amountYocto !== null;

  const statusQueries = useQueries({
    queries: plans.map((plan) => ({
      queryKey: ["subscription-status", PROVIDER, plan.id, nearAccountId],
      queryFn: () =>
        apiClient.subscriptionGet({
          provider: PROVIDER,
          planId: plan.id,
          payerRef: nearAccountId,
        }) as Promise<SubscriptionInfo>,
      enabled: !!nearAccountId,
      retry: false,
      staleTime: 15_000,
    })),
  });

  const activePlanIndex = statusQueries.findIndex((q) => {
    const s = q.data?.status;
    return s && s !== "none" && s !== "ended";
  });
  const activePlan = activePlanIndex >= 0 ? plans[activePlanIndex] : null;
  const activeSubscription =
    activePlanIndex >= 0 ? (statusQueries[activePlanIndex]?.data ?? null) : null;
  const status = activeSubscription?.status ?? "none";
  const isStaked = status !== "none" && status !== "ended";
  const isLoading = statusQueries.some((q) => q.isLoading);

  const activeSubscriptionQueryKey = activePlan
    ? ["subscription-status", PROVIDER, activePlan.id, nearAccountId]
    : null;

  const notifySyncResult = (sync: { granted: boolean; reason: string }) => {
    switch (sync.reason) {
      case "granted":
        toast.success("Credits synced");
        break;
      case "already_synced":
        toast.info("Already up to date — no new stake since your last sync");
        break;
      case "not_ready":
        toast.info("Stake confirmed on-chain, but credits haven't synced yet — try again shortly");
        break;
      default:
        toast.info("Nothing staked yet");
    }
  };

  const syncCredits = useMutation({
    mutationFn: async () => {
      if (!activePlan) throw new Error("No active plan to sync");
      const sync = await apiClient.subscriptionCreditSync({
        provider: PROVIDER,
        planId: activePlan.id,
        payerRef: nearAccountId,
      });
      queryClient.setQueryData(["credits", activeOrgId], sync.balances);
      return sync;
    },
    onSuccess: notifySyncResult,
    onError: (error: Error) => toast.error(error.message || "Sync failed"),
    onSettled: onRefetchBalances,
  });

  const stake = useMutation({
    mutationFn: async () => {
      if (!matchingPlan || !amountYocto) throw new Error("Enter a valid stake amount");

      const action = (await apiClient.subscriptionCreate({
        provider: PROVIDER,
        planId: matchingPlan.id,
        amount: amountYocto.toString(),
      })) as SubscriptionAction;

      if (action.kind !== "wallet_intent") {
        throw new Error("Unexpected subscription action from stake2pay");
      }

      await signWalletIntent(authClient, action);

      const currentBalances = queryClient.getQueryData<CreditBalance[]>(["credits", activeOrgId]);
      const currentYocto =
        nearToYocto(currentBalances?.find((b) => b.creditType === "default")?.balance ?? "0") ?? 0n;
      onOptimisticBalance(yoctoToNear((currentYocto + amountYocto).toString()));
      toast.info("Stake sent — waiting for the chain to confirm");

      const activeSubscription = await pollUntil(
        () =>
          apiClient.subscriptionGet({
            provider: PROVIDER,
            planId: matchingPlan.id,
            payerRef: nearAccountId,
          }) as Promise<SubscriptionInfo>,
        (s) => s.status === "active",
      );
      queryClient.setQueryData(
        ["subscription-status", PROVIDER, matchingPlan.id, nearAccountId],
        activeSubscription,
      );

      const sync = await apiClient.subscriptionCreditSync({
        provider: PROVIDER,
        planId: matchingPlan.id,
        payerRef: nearAccountId,
      });
      queryClient.setQueryData(["credits", activeOrgId], sync.balances);
      onOptimisticBalance(null);
      return sync;
    },
    onSuccess: (sync) => {
      if (sync.reason === "granted") {
        toast.success("Staked — credits updated");
      } else {
        notifySyncResult(sync);
      }
    },
    onError: (error: Error) => {
      onOptimisticBalance(null);
      toast.error(error.message || "Stake failed");
    },
    onSettled: () => {
      onRefetchBalances();
      void queryClient.invalidateQueries({ queryKey: ["subscription-status", PROVIDER] });
    },
  });

  const busy = stake.isPending || syncCredits.isPending;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">Stake NEAR</p>
          <p className="mt-0.5 text-muted-foreground text-xs">
            {yoctoToNear(overallMin.toString())}–{yoctoToNear(overallMax.toString())} NEAR /{" "}
            {plans[0]?.period.replace(/ly$/, "") ?? "month"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
          >
            {STATUS_LABELS[status]}
          </span>
          <button
            type="button"
            onClick={() =>
              void queryClient.invalidateQueries({
                queryKey: ["subscription-status", PROVIDER],
              })
            }
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Refresh status"
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {activeSubscription && isStaked && (
        <div className="space-y-1.5 rounded-lg bg-muted/40 px-3 py-2.5 text-xs">
          {activeSubscription.amount && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Locked</span>
              <span className="font-medium">{yoctoToNear(activeSubscription.amount)} NEAR</span>
            </div>
          )}
          {activePlan && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Plan</span>
              <span className="font-medium">
                {formatPlanRange(activePlan.minAmount, activePlan.maxAmount, activePlan.currency)}
              </span>
            </div>
          )}
          {activeSubscription.currentPeriodEnd && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Period ends</span>
              <span>{new Date(activeSubscription.currentPeriodEnd).toLocaleDateString()}</span>
            </div>
          )}
        </div>
      )}

      {!isStaked && (
        <div className="space-y-1.5">
          <label htmlFor="stake-amount" className="text-muted-foreground text-[11px] font-medium">
            Stake amount (NEAR)
          </label>
          <Input
            id="stake-amount"
            inputMode="decimal"
            value={inputNear}
            onChange={(e) => setInputNear(e.target.value)}
            disabled={busy}
          />
          {inputNear && !amountValid && (
            <p className="text-red-500 text-xs">
              Enter between {yoctoToNear(overallMin.toString())} and{" "}
              {yoctoToNear(overallMax.toString())} NEAR
            </p>
          )}
          {matchingPlan && amountValid && (
            <p className="text-muted-foreground text-[11px]">
              Qualifies for the{" "}
              <span className="font-medium text-foreground">{matchingPlan.name}</span> plan
            </p>
          )}
        </div>
      )}

      {activeSubscriptionQueryKey && isStaked ? (
        <Button
          className="w-full text-white"
          style={{ backgroundColor: "#00C08B" }}
          disabled={syncCredits.isPending}
          onClick={() => syncCredits.mutate()}
        >
          {syncCredits.isPending && <Loader2 size={15} className="animate-spin" />}
          Sync credits
        </Button>
      ) : (
        <Button
          className="w-full text-white"
          style={{ backgroundColor: "#00C08B" }}
          disabled={!amountValid || stake.isPending}
          onClick={() => stake.mutate()}
        >
          {stake.isPending ? <Loader2 size={15} className="animate-spin" /> : <Wallet size={15} />}
          Stake
        </Button>
      )}
    </div>
  );
}
