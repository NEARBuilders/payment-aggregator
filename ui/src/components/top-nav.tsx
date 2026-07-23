import { Link, useRouterState } from "@tanstack/react-router";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserNav } from "@/components/user-nav";

const NAV_LINKS = [
  { to: "/", label: "Home" },
  { to: "/payments", label: "Payments" },
  { to: "/subscriptions", label: "Subscriptions" },
] as const;

export function TopNav({ minimal = false }: { minimal?: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const isActive = (to: string) =>
    to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
        <div className="flex items-center gap-6 min-w-0">
          {!minimal && (
            <nav className="flex items-center gap-1">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  preload="intent"
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive(link.to)
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          )}
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {!minimal && <UserNav />}
        </div>
      </div>
    </header>
  );
}
