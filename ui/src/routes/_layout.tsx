import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { getAccount, getActiveRuntime, getAppName, sessionQueryOptions } from "@/app";
import builtOn from "@/assets/built_on.png";
import builtOnRev from "@/assets/built_on_rev.png";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserNav } from "@/components/user-nav";

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
  const { runtimeConfig, session } = Route.useRouteContext();
  const appName = getAppName(runtimeConfig);
  const runtime = getActiveRuntime(runtimeConfig);
  const account = getAccount(runtimeConfig);
  const isAuthenticated = !!session?.user;
  const gatewayId = runtime?.gatewayId;

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-background text-foreground">
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <div className="shrink-0 flex items-center justify-center py-1.5 px-3 bg-yellow-300 border-b border-yellow-400">
          <span className="text-[11px] font-bold tracking-wide text-yellow-950 text-center">
            Beta database will be wiped periodically. Do not save data you want to keep.
          </span>
        </div>

        <header
          className={`shrink-0 bg-card/50 ${isAuthenticated ? "border-b border-border animate-fade-in" : ""}`}
        >
          {isNavigating && (
            <div className="absolute top-0 left-0 right-0 h-[2px] z-50 overflow-hidden">
              <div
                className="h-full bg-foreground animate-progress-bar"
                style={{ width: "100%" }}
              />
            </div>
          )}

          <div className="flex items-center justify-between px-4 sm:px-6 h-12">
            {isAuthenticated ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono min-w-0">
                <Link
                  aria-label={`${appName} home`}
                  className="sm:hidden flex items-center justify-center w-8 h-8 border-2 border-outset border-border-strong bg-card shadow-sm transition-shadow duration-200 hover:shadow-md"
                  to="/"
                  preload="intent"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-4 h-4 text-foreground"
                    aria-label={`${appName} logo`}
                  >
                    <title>{appName}</title>
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                </Link>

                <div className="hidden sm:flex items-center gap-2">
                  {gatewayId && (
                    <>
                      <span>{gatewayId}</span>
                      <span>/</span>
                    </>
                  )}
                  <span>{runtime?.accountId ?? account}</span>
                  <span>/</span>
                  <span className="truncate">
                    {pathname === "/" ? "home" : pathname.slice(1).split("/").join(" / ")}
                  </span>
                </div>
              </div>
            ) : (
              <Link
                to="/login"
                aria-label={`${appName} home`}
                className="flex items-center justify-center w-10 h-10 transition-opacity duration-200 hover:opacity-70"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-5 h-5 text-foreground"
                  aria-label={`${appName} logo`}
                >
                  <title>{appName}</title>
                  <circle cx="12" cy="12" r="10" />
                </svg>
              </Link>
            )}

            <div className="flex items-center gap-2">
              {isAuthenticated && <ThemeToggle />}
              <UserNav />
            </div>
          </div>
        </header>

        <main className="flex-1 w-full min-h-0 overflow-hidden animate-fade-in-up">
          <Outlet />
        </main>

        <footer className="shrink-0 flex justify-center py-6 pb-20 sm:pb-6">
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

        {!isAuthenticated && (
          <div className="fixed bottom-4 left-4 z-40">
            <ThemeToggle />
          </div>
        )}
      </div>
    </div>
  );
}
