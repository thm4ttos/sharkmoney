import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/app/resumo")({
  beforeLoad: () => {
    throw redirect({ to: "/app/dashboard" });
  },
});
