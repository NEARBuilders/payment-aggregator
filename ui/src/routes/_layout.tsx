import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { sessionQueryOptions } from "@/app";
import { AppFooter } from "@/components/app-footer";
import { TopNav } from "@/components/top-nav";
import { TooltipProvider } from "@/components/ui/tooltip";

export const Route = createFileRoute("/_layout")({
  beforeLoad: async ({ context }) => {
    const { queryClient, authClient } = context;
    const session = await queryClient.ensureQueryData(
      sessionQueryOptions(authClient, context.session),
    );

    return {
      runtimeConfig: context.runtimeConfig,
      session,
    };
  },
  component: Layout,
});

function Layout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isNavigating = useRouterState({ select: (s) => s.status === "pending" });
  const isLogin = pathname === "/login";

  return (
    <TooltipProvider>
      <div className="relative flex min-h-dvh w-full flex-col bg-background text-foreground">
        {isNavigating && (
          <div className="fixed top-0 left-0 right-0 h-[2px] z-50 overflow-hidden">
            <div className="h-full bg-foreground animate-progress-bar" style={{ width: "100%" }} />
          </div>
        )}

        <TopNav minimal={isLogin} />

        <main className="flex-1 w-full animate-fade-in-up">
          <Outlet />
        </main>

        <AppFooter />
      </div>
    </TooltipProvider>
  );
}
