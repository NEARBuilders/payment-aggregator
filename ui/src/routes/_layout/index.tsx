import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CreditCard, Repeat } from "lucide-react";

export const Route = createFileRoute("/_layout/")({
  component: LandingPage,
});

const DEMOS = [
  {
    to: "/payments",
    title: "Payments",
    tagline: "One checkout, every provider.",
    description:
      "One-time payments routed through a single contract — pick Stripe or PingPay and the aggregator creates the session, verifies the webhook, and tracks status.",
    icon: CreditCard,
    accent: "#7C5CF6",
    glow: "rgba(124,92,246,0.14)",
  },
  {
    to: "/subscriptions",
    title: "Subscriptions",
    tagline: "Pay with yield, not principal.",
    description:
      "Recurring plans behind the same contract — stake NEAR and let validator rewards cover your subscription, or pay by card through Stripe Billing.",
    icon: Repeat,
    accent: "#00C08B",
    glow: "rgba(0,192,139,0.14)",
  },
] as const;

function LandingPage() {
  return (
    <div className="relative flex min-h-[calc(100vh-3.5rem)] flex-col overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_50%_at_50%_0%,rgba(124,92,246,0.10),transparent_70%)]" />

      <main className="relative flex flex-1 items-center px-5 py-12 sm:px-8">
        <div className="mx-auto w-full max-w-4xl">
          <div className="mb-12 text-center">
            <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
              pay.everything.dev
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-[2.75rem] sm:leading-[1.1]">
              Every payment provider,
              <br />
              one contract.
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground text-sm leading-relaxed">
              A payment aggregator built on everything.dev — providers are plugins behind shared
              oRPC contracts, discovered at runtime. Pick a demo.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {DEMOS.map((demo) => (
              <Link
                key={demo.to}
                to={demo.to}
                className="group relative flex flex-col rounded-2xl border border-border bg-card p-6 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg"
                style={{ boxShadow: `0 12px 40px -18px ${demo.glow}` }}
              >
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-white"
                  style={{ backgroundColor: demo.accent }}
                >
                  <demo.icon size={20} />
                </span>
                <p className="mt-4 text-lg font-semibold">{demo.title}</p>
                <p className="text-sm font-medium" style={{ color: demo.accent }}>
                  {demo.tagline}
                </p>
                <p className="mt-2 flex-1 text-muted-foreground text-sm leading-relaxed">
                  {demo.description}
                </p>
                <span
                  className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium transition-transform duration-150 group-hover:translate-x-0.5"
                  style={{ color: demo.accent }}
                >
                  Open demo
                  <ArrowRight size={15} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
