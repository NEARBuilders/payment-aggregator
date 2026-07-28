import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Loader2, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { sessionQueryOptions, useApiClient, useAuthClient } from "@/app";
import { AppFooter } from "@/components/app-footer";
import { TopNav } from "@/components/top-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { nearToYocto, yoctoToNear } from "@/lib/near-amount";
import { pollUntil } from "@/lib/poll";
import type { SubscriptionAction, SubscriptionInfo } from "@/lib/wallet-intent";
import { signWalletIntent } from "@/lib/wallet-intent";

const PROVIDER = "stake2pay";
// stake2pay's product has several price tiers (Starter/Basic/Pro at different
// NEAR ranges); this page only demos the smallest "Starter" tier, so it must
// pick that exact price rather than trust array order from listPlans.
const DEMO_STAKE_NEAR = "1";

type Plan = {
  id: string;
  name: string;
  minAmount: string;
  maxAmount: string;
};

type CreditBalance = {
  creditType: string;
  balance: string;
};

export const Route = createFileRoute("/subscriptions_/stake2pay")({
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
  const { session } = Route.useRouteContext();
  const activeOrganizationId = session.session?.activeOrganizationId ?? null;
  const creditsQueryKey = ["credits", activeOrganizationId];

  const [nearAccountId, setNearAccountId] = useState<string | null>(null);
  const [inputNear, setInputNear] = useState(DEMO_STAKE_NEAR);
  const [optimisticBalance, setOptimisticBalance] = useState<string | null>(null);

  useEffect(() => {
    const previousNetwork = authClient.near.getNetwork();
    authClient.near.setNetwork("testnet");
    setNearAccountId(authClient.near.getAccountId());
    return () => {
      authClient.near.setNetwork(previousNetwork);
    };
  }, [authClient]);

  const { data: plans } = useQuery({
    queryKey: ["subscription-plans", PROVIDER],
    queryFn: () => apiClient.subscriptionPlans({ provider: PROVIDER }),
  });
  const demoStakeYocto = nearToYocto(DEMO_STAKE_NEAR);
  const plan =
    (plans as Plan[] | undefined)?.find(
      (p) =>
        p.name === "Starter" &&
        demoStakeYocto !== null &&
        demoStakeYocto >= BigInt(p.minAmount) &&
        demoStakeYocto <= BigInt(p.maxAmount),
    ) ?? null;

  const { data: subscription, refetch: refetchSubscription } = useQuery({
    queryKey: ["subscription-status", PROVIDER, plan?.id, nearAccountId],
    queryFn: () =>
      apiClient.subscriptionGet({
        provider: PROVIDER,
        planId: plan?.id ?? "",
        payerRef: nearAccountId ?? undefined,
      }) as Promise<SubscriptionInfo>,
    enabled: !!plan && !!nearAccountId,
    retry: false,
  });
  const alreadyStaked = subscription
    ? subscription.status !== "none" && subscription.status !== "ended"
    : false;

  const { data: balances, refetch: refetchBalances } = useQuery({
    queryKey: creditsQueryKey,
    queryFn: () => apiClient.creditList() as Promise<CreditBalance[]>,
  });
  const defaultBalance = balances?.find((b) => b.creditType === "default")?.balance ?? "0";
  const displayBalance = optimisticBalance ?? defaultBalance;

  const connectWallet = useMutation({
    mutationFn: async () => {
      await authClient.signIn.near();
    },
    onSuccess: () => setNearAccountId(authClient.near.getAccountId()),
    onError: (error: Error) => toast.error(error.message || "Wallet connection failed"),
  });

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
      if (!plan) throw new Error("No plan to sync");
      const payerRef = authClient.near.getAccountId();
      if (!payerRef) throw new Error("Connect a NEAR wallet first");

      const sync = await apiClient.subscriptionCreditSync({
        provider: PROVIDER,
        planId: plan.id,
        payerRef,
      });
      queryClient.setQueryData(creditsQueryKey, sync.balances);
      return sync;
    },
    onSuccess: notifySyncResult,
    onError: (error: Error) => toast.error(error.message || "Sync failed"),
  });

  const amountYocto = plan ? nearToYocto(inputNear) : null;
  const amountValid =
    !!plan &&
    amountYocto !== null &&
    amountYocto >= BigInt(plan.minAmount) &&
    amountYocto <= BigInt(plan.maxAmount);

  const stake = useMutation({
    mutationFn: async () => {
      if (!plan || !amountYocto) throw new Error("Enter a valid stake amount");

      const action = (await apiClient.subscriptionCreate({
        provider: PROVIDER,
        planId: plan.id,
        amount: amountYocto.toString(),
      })) as SubscriptionAction;

      if (action.kind !== "wallet_intent") {
        throw new Error("Unexpected subscription action from stake2pay");
      }

      await signWalletIntent(authClient, action);

      const stakedYocto = amountYocto;
      const currentYocto = nearToYocto(defaultBalance) ?? 0n;
      setOptimisticBalance(yoctoToNear((currentYocto + stakedYocto).toString()));
      toast.info("Stake sent — waiting for the chain to confirm");

      const payerRef = authClient.near.getAccountId();
      if (!payerRef) throw new Error("Wallet disconnected before confirmation");

      const activeSubscription = await pollUntil(
        () =>
          apiClient.subscriptionGet({
            provider: PROVIDER,
            planId: plan.id,
            payerRef,
          }) as Promise<SubscriptionInfo>,
        (s) => s.status === "active",
      );
      queryClient.setQueryData(
        ["subscription-status", PROVIDER, plan.id, nearAccountId],
        activeSubscription,
      );

      const sync = await apiClient.subscriptionCreditSync({
        provider: PROVIDER,
        planId: plan.id,
        payerRef,
      });
      queryClient.setQueryData(creditsQueryKey, sync.balances);
      setOptimisticBalance(null);
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
      setOptimisticBalance(null);
      toast.error(error.message || "Stake failed");
    },
    onSettled: () => {
      refetchBalances();
      refetchSubscription();
    },
  });

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background text-foreground">
      <TopNav />
      <div className="pointer-events-none absolute inset-x-0 top-14 h-[480px] bg-[radial-gradient(65%_55%_at_50%_0%,rgba(0,192,139,0.12),transparent_70%)]" />

      <main className="relative flex-1 px-5 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-3xl">
          <div className="grid gap-6 sm:grid-cols-[1fr_auto] sm:items-start">
            <div>
              <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.25em] text-[#00A578] dark:text-[#38D9A9]">
                Stake2Pay
              </p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Stake NEAR, earn inference credits.
              </h1>
            </div>

            <div className="rounded-2xl border border-border bg-card px-5 py-4 text-right">
              <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                Credit balance
              </p>
              <p className="text-3xl font-semibold tabular-nums">{displayBalance}</p>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 inline-flex rounded-lg border border-border p-0.5 text-xs font-medium">
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

            {!nearAccountId ? (
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
            ) : alreadyStaked ? (
              <div className="space-y-3">
                <p className="text-muted-foreground text-sm">
                  You already have a {subscription?.status.replace(/_/g, " ")} stake for this plan.
                  Staking again is disabled — sync it into credits instead.
                </p>
                <Button
                  className="w-full text-white"
                  style={{ backgroundColor: "#00C08B" }}
                  disabled={syncCredits.isPending}
                  onClick={() => syncCredits.mutate()}
                >
                  {syncCredits.isPending && <Loader2 size={15} className="animate-spin" />}
                  Sync credits
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="stake-amount"
                    className="text-muted-foreground text-[11px] font-medium"
                  >
                    Stake amount (NEAR)
                  </label>
                  <Input
                    id="stake-amount"
                    inputMode="decimal"
                    value={inputNear}
                    onChange={(event) => setInputNear(event.target.value)}
                    disabled={stake.isPending}
                  />
                  {plan && !amountValid && (
                    <p className="text-red-500 text-xs">
                      Enter between {yoctoToNear(plan.minAmount)} and {yoctoToNear(plan.maxAmount)}{" "}
                      NEAR
                    </p>
                  )}
                </div>

                <Button
                  className="w-full text-white"
                  style={{ backgroundColor: "#00C08B" }}
                  disabled={!plan || !amountValid || stake.isPending}
                  onClick={() => stake.mutate()}
                >
                  {stake.isPending && <Loader2 size={15} className="animate-spin" />}
                  Stake
                </Button>
              </div>
            )}
          </div>
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
