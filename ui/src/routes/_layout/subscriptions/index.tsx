import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/subscriptions/")({
  beforeLoad: () => {
    throw redirect({ to: "/subscriptions/stake2pay", replace: true });
  },
});
