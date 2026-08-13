import { createFileRoute, redirect } from "@tanstack/react-router";

// "Início" foi unificada com "Meu Perfil" (mesma página, todas as
// funcionalidades juntas) — /app continua válido, só redireciona.
export const Route = createFileRoute("/app/")({
  beforeLoad: () => {
    throw redirect({ to: "/app/perfil" });
  },
});
