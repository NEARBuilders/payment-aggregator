import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useApiClient } from "@/app";

const BRAND_COLORS: Record<string, string> = {
  stake2pay: "#00C08B",
  stripe: "#635BFF",
};

const PROVIDER_PATHS = {
  stake2pay: "/subscriptions/stake2pay",
  stripe: "/subscriptions/stripe",
} as const;

type ProviderPath = (typeof PROVIDER_PATHS)[keyof typeof PROVIDER_PATHS];

export const Route = createFileRoute("/_layout/subscriptions")({
  head: () => ({
    meta: [
      { title: "Subscriptions — pay.everything.dev" },
      { name: "description", content: "Recurring payments from staking yield or card." },
    ],
  }),
  component: SubscriptionsLayout,
});

function SubscriptionsLayout() {
  const apiClient = useApiClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const { data: providers, isLoading } = useQuery({
    queryKey: ["subscription-providers"],
    queryFn: () => apiClient.subscriptionProviders(),
  });

  const knownProviders = (providers ?? []).filter((p) => p.key in PROVIDER_PATHS);

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-[radial-gradient(65%_55%_at_50%_0%,rgba(0,192,139,0.12),transparent_70%)]" />

      <div className="relative flex-1 px-5 sm:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="pt-8 pb-6 max-w-xl sm:pt-12 sm:pb-8">
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

          {isLoading ? (
            <div className="flex gap-1 border-b border-border">
              <div className="h-10 w-28 animate-pulse rounded-t-lg bg-muted" />
              <div className="h-10 w-24 animate-pulse rounded-t-lg bg-muted" />
            </div>
          ) : knownProviders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center">
              <p className="font-medium">No subscription providers registered</p>
              <p className="mt-1 text-muted-foreground text-sm">
                Register a plugin implementing the subscription contract in bos.config.json.
              </p>
            </div>
          ) : (
            <>
              <div className="flex gap-1 border-b border-border">
                {knownProviders.map((provider) => {
                  const to = PROVIDER_PATHS[provider.key as keyof typeof PROVIDER_PATHS] as
                    | ProviderPath
                    | undefined;
                  if (!to) return null;
                  const brand = BRAND_COLORS[provider.key] ?? "#18181B";
                  const isActive = pathname.startsWith(to);
                  return (
                    <Link
                      key={provider.key}
                      to={to}
                      preload="intent"
                      className={`flex items-center gap-2 px-4 py-2.5 -mb-px text-sm font-medium border-b-2 transition-colors ${
                        isActive
                          ? "border-current"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                      style={isActive ? { color: brand } : undefined}
                    >
                      <img src={provider.logo} alt="" className="h-4 w-4 object-contain" />
                      {provider.name}
                    </Link>
                  );
                })}
              </div>

              <div className="py-8 sm:py-10">
                <Outlet />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
