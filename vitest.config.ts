// Config de testes ISOLADA da build principal (vite.config.ts usa o preset
// completo do TanStack Start/Cloudflare, que não é necessário — nem seguro,
// por trazer plugins de servidor/router — para testar módulos puros).
// Só resolve o alias "@/*" (mesmo do tsconfig.json) pra importar os módulos
// exatamente como o resto do app importa.
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: { dedupe: ["zod"] },
  ssr: { noExternal: ["zod"] },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    server: { deps: { inline: ["zod"] } },
  },
});
