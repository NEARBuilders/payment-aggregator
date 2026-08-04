import { createFileRoute, Link } from "@tanstack/react-router";
import { Copy, Cpu, ExternalLink, Globe, Package } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_layout/integrate")({
  head: () => ({
    meta: [
      { title: "Integrate — pay.everything.dev" },
      { name: "description", content: "Add payments to your own app in one line." },
    ],
  }),
  component: IntegratePage,
});

const PATHS = [
  {
    title: "Client package",
    tagline: "One import, typed everywhere.",
    icon: Package,
    accent: "#7C5CF6",
    glow: "rgba(124,92,246,0.14)",
    code: `npm install @pay.everything/client

import { createPayClient } from "@pay.everything/client";

const pay = createPayClient("https://your-api.com");

const checkout = await pay.paymentCheckout({
  provider: "stripe",
  orderId: "order_123",
  amount: 1999,
  currency: "USD",
  successUrl: "https://myapp.com/success",
  cancelUrl: "https://myapp.com/cancel",
  items: [{ name: "Widget", unitAmount: 1999, quantity: 1 }],
});`,
  },
  {
    title: "HTTP / REST",
    tagline: "Any stack, any language.",
    icon: Globe,
    accent: "#00C08B",
    glow: "rgba(0,192,139,0.14)",
    code: `# List providers
curl https://your-api.com/api/payments/providers

# Create checkout
curl -X POST https://your-api.com/api/payments/checkout \\
  -H 'Content-Type: application/json' \\
  -d '{
    "provider": "stripe",
    "orderId": "order_123",
    "amount": 1999,
    "currency": "USD",
    "successUrl": "https://myapp.com/success",
    "cancelUrl": "https://myapp.com/cancel",
    "items": [{ "name": "Widget", "unitAmount": 1999, "quantity": 1 }]
  }'`,
  },
  {
    title: "everything-dev",
    tagline: "BOS ecosystem — drop in.",
    icon: Cpu,
    accent: "#6366F1",
    glow: "rgba(99,102,241,0.14)",
    code: `// bos.config.json
{
  "plugins": {
    "pay": {
      "production": "https://pay.everything.dev/api"
    }
  }
}

// Any route component
import { useApiClient } from "@/app";

function CheckoutPage() {
  const apiClient = useApiClient();
  const providers = await apiClient.pay.paymentProviders();
}`,
  },
  {
    title: "Deploy your own",
    tagline: "One-click Railway template.",
    icon: Cpu,
    accent: "#F59E0B",
    glow: "rgba(245,158,11,0.14)",
    code: `Host your own payment aggregator with
all providers pre-configured.

→ Deploy on Railway with one click
→ Bring your own API keys
→ All routes work out of the box
→ Full typed client support`,
    action: {
      label: "Deploy on Railway",
      href: "https://railway.com/deploy/everything-dev-template?referralCode=MuB_vg&utm_medium=integration&utm_source=template&utm_campaign=generic",
    },
  },
] as const;

function CodeBlock({ code }: { code: string }) {
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    toast.success("Copied");
  };

  return (
    <div className="relative mt-4 rounded-lg border border-border bg-background/60">
      <button
        type="button"
        onClick={copy}
        className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Copy code"
      >
        <Copy size={13} />
      </button>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed">{code}</pre>
    </div>
  );
}

function IntegratePage() {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-[radial-gradient(65%_55%_at_50%_0%,rgba(124,92,246,0.10),transparent_70%)]" />

      <div className="relative flex-1 px-5 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 max-w-xl">
            <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.25em] text-[#7C5CF6] dark:text-[#AF9EF9]">
              Integrate
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-[2.75rem] sm:leading-[1.1]">
              Add payments
              <br />
              to your app.
            </h1>
            <p className="mt-4 text-muted-foreground text-sm leading-relaxed">
              Pick the path that fits your stack — typed client, plain HTTP, everything-dev plugin,
              or deploy your own.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {PATHS.map((path) => (
              <div
                key={path.title}
                className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-[0_12px_40px_-18px_var(--glow-color)] transition-all duration-150 hover:shadow-lg"
                style={{ "--glow-color": path.glow } as React.CSSProperties}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
                        style={{ backgroundColor: path.accent }}
                      >
                        <path.icon size={16} />
                      </span>
                      <p className="font-semibold">{path.title}</p>
                    </div>
                    <p className="mt-1 text-muted-foreground text-xs">{path.tagline}</p>
                  </div>
                </div>

                <CodeBlock code={path.code} />

                {"action" in path && path.action && (
                  <div className="mt-4 flex items-center gap-3">
                    <Button size="sm" asChild>
                      <a href={path.action.href} target="_blank" rel="noreferrer">
                        <ExternalLink size={13} />
                        {path.action.label}
                      </a>
                    </Button>
                    <span className="text-muted-foreground text-[11px]">
                      Free credits available
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-12 flex items-center justify-center gap-2 text-center text-muted-foreground text-xs">
            Full endpoint reference and advanced examples in
            <Link
              to="/"
              className="font-medium text-foreground underline underline-offset-2 transition-colors hover:text-[#7C5CF6]"
            >
              docs/integration.md
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
