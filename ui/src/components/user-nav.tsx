import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Coins } from "lucide-react";
import { toast } from "sonner";
import type { Organization } from "@/app";
import { useApiClient, useAuthClient, useAuthState } from "@/app";
import { OrgSwitcher } from "@/components";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type CreditBalance = {
  creditType: string;
  balance: string;
};

export function UserNav() {
  const auth = useAuthClient();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user, activeOrgId, isEffectivelyAnonymous } = useAuthState();

  const { data: organizations } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data } = await auth.organization.list();
      return (data || []) as Organization[];
    },
    staleTime: 30 * 1000,
    enabled: !!user,
  });

  const { data: balances } = useQuery({
    queryKey: ["credits", activeOrgId],
    queryFn: () => apiClient.creditList() as Promise<CreditBalance[]>,
    enabled: !!user,
    staleTime: 30 * 1000,
  });
  const creditBalance = balances?.find((b) => b.creditType === "default")?.balance ?? null;
  const hasCredits = creditBalance !== null && creditBalance !== "0";

  const signOutMutation = useMutation({
    mutationFn: async () => {
      const { error } = await auth.signOut();
      if (error) {
        throw new Error(error.message || "Failed to sign out");
      }
      await auth.near.disconnect().catch(() => {});
    },
    onSuccess: async () => {
      toast.success("Signed out");
      queryClient.setQueryData(["session"], null);
      queryClient.removeQueries({ queryKey: ["organizations"] });
      queryClient.removeQueries({ queryKey: ["credits"] });
      await navigate({ to: "/", replace: true });
    },
    onError: (error: Error) => {
      console.error("Sign out error:", error);
    },
  });

  const linkNearMutation = useMutation({
    mutationFn: async () => {
      await auth.near.link();
    },
    onSuccess: async () => {
      toast.success("NEAR wallet connected — your credits are preserved");
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to connect NEAR wallet");
    },
  });

  if (!user) {
    return (
      <Button asChild variant="outline">
        <Link to="/login">connect</Link>
      </Button>
    );
  }

  const handleOrgSwitch = async () => {
    await queryClient.invalidateQueries({ queryKey: ["session"] });
    await queryClient.invalidateQueries({ queryKey: ["organizations"] });
    await queryClient.invalidateQueries({ queryKey: ["credits"] });
  };

  return (
    <div className="flex items-center gap-2">
      {hasCredits && (
        <Link
          to="/subscriptions/stake2pay"
          className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
        >
          <Coins size={11} />
          {creditBalance}
        </Link>
      )}

      {organizations && organizations.length > 0 && (
        <OrgSwitcher
          organizations={organizations}
          activeOrgId={activeOrgId}
          onSwitch={handleOrgSwitch}
        />
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="w-6 h-6 rounded-full! bg-foreground transition-all duration-200 ease-out hover:shadow-lg hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            title="menu"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <p className="text-xs text-muted-foreground">signed in as</p>
                {isEffectivelyAnonymous && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    guest
                  </span>
                )}
              </div>
              <p className="truncate text-sm font-normal">{user?.email || user?.id}</p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {isEffectivelyAnonymous && (
            <>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  linkNearMutation.mutate();
                }}
                disabled={linkNearMutation.isPending}
                className="text-emerald-600 dark:text-emerald-400 focus:text-emerald-600"
              >
                {linkNearMutation.isPending ? "connecting..." : "Connect NEAR to keep credits"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem asChild>
            <Link to="/home">workspace</Link>
          </DropdownMenuItem>
          {activeOrgId &&
            organizations &&
            (() => {
              const activeOrg = organizations.find((o) => o.id === activeOrgId);
              return activeOrg ? (
                <DropdownMenuItem asChild>
                  <Link to="/organizations/$slug" params={{ slug: activeOrg.slug }}>
                    {activeOrg.name}
                  </Link>
                </DropdownMenuItem>
              ) : null;
            })()}
          <DropdownMenuItem asChild>
            <Link to="/settings">settings</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
              signOutMutation.mutate();
            }}
            disabled={signOutMutation.isPending}
          >
            {signOutMutation.isPending ? "signing out..." : "sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
