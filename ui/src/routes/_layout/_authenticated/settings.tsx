import { createFileRoute, Outlet } from "@tanstack/react-router";
import { sessionQueryOptions } from "@/app";

export const Route = createFileRoute("/_layout/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings | auth.everything.dev" },
      { name: "description", content: "Manage your account identity and security." },
    ],
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(
      sessionQueryOptions(context.authClient, context.session),
    );
  },
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5 sm:px-6 sm:py-3">
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
