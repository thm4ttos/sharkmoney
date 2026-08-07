import { createFileRoute } from "@tanstack/react-router";
import { AdminLayout } from "@/components/brinzap/AdminLayout";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin · Abio" }, { name: "robots", content: "noindex" }] }),
  component: AdminLayout,
});
