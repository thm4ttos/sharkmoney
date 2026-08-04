import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/brinzap/AppLayout";

export const Route = createFileRoute("/app")({
  head: () => ({ meta: [{ title: "App · Shark Money" }, { name: "robots", content: "noindex" }] }),
  component: AppLayout,
});
