// SERVER-ONLY. Helper para executar trabalho em background dentro do
// runtime da Cloudflare (waitUntil). Sem isto, um fetch/Promise não
// aguardado é cancelado quando a Response principal é enviada.
//
// Estratégia:
//  1) `src/server.ts` executa cada request dentro de `waitUntilStorage.run`
//     armazenando `ctx.waitUntil`.
//  2) Handlers chamam `runInBackground(promise)` para prolongar o worker
//     até a promise resolver.
//  3) Fallback: se `waitUntil` não estiver disponível (ex.: dev local),
//     apenas aguardamos a promise inline (best-effort).

import { AsyncLocalStorage } from "node:async_hooks";

type WaitUntil = (promise: Promise<unknown>) => void;

export const waitUntilStorage = new AsyncLocalStorage<{ waitUntil?: WaitUntil }>();

export function runInBackground(task: Promise<unknown> | (() => Promise<unknown>)): void {
  const promise = typeof task === "function" ? task() : task;
  const store = waitUntilStorage.getStore();
  const safe = promise.catch((err) => {
    console.error("[wa-background] task failed", err);
  });
  if (store?.waitUntil) {
    try {
      store.waitUntil(safe);
      return;
    } catch (err) {
      console.warn("[wa-background] waitUntil failed, falling back to inline", err);
    }
  }
  // Fallback: no waitUntil available (dev or unknown runtime).
  // Void to signal fire-and-forget.
  void safe;
}
