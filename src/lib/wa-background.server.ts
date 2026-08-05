// SERVER-ONLY. Helper para executar trabalho em background dentro do
// runtime da Cloudflare (waitUntil). Sem isto, um fetch/Promise não
// aguardado é cancelado quando a Response principal é enviada.
//
// Estratégia (duas fontes, a mais confiável vence):
//  1) `attachWaitUntil(request, waitUntil)` — chamado em `src/server.ts` —
//     associa o waitUntil diretamente ao objeto Request (que é preservado
//     por referência através de todo o pipeline do Nitro/h3, ao contrário
//     do AsyncLocalStorage, que pode perder o contexto em alguns pontos
//     internos do framework). Handlers passam a mesma `request` que já têm
//     em mãos para `runInBackground(task, request)`.
//  2) `waitUntilStorage` (AsyncLocalStorage) — mantido como fallback caso
//     o handler não tenha acesso à request.
//  3) Se nenhuma das duas estiver disponível (ex.: dev local), apenas
//     aguardamos a promise inline (best-effort).

import { AsyncLocalStorage } from "node:async_hooks";

type WaitUntil = (promise: Promise<unknown>) => void;

export const waitUntilStorage = new AsyncLocalStorage<{ waitUntil?: WaitUntil }>();

const requestWaitUntil = new WeakMap<Request, WaitUntil>();

export function attachWaitUntil(request: Request, waitUntil: WaitUntil | undefined): void {
  if (waitUntil) requestWaitUntil.set(request, waitUntil);
}

export function runInBackground(
  task: Promise<unknown> | (() => Promise<unknown>),
  request?: Request,
): void {
  const promise = typeof task === "function" ? task() : task;
  const fromRequest = request ? requestWaitUntil.get(request) : undefined;
  const fromStorage = waitUntilStorage.getStore()?.waitUntil;
  const waitUntil = fromRequest ?? fromStorage;
  const safe = promise.catch((err) => {
    console.error("[wa-background] task failed", err);
  });
  if (waitUntil) {
    try {
      waitUntil(safe);
      return;
    } catch (err) {
      console.warn("[wa-background] waitUntil failed, falling back to inline", err);
    }
  }
  // Fallback: no waitUntil available (dev or unknown runtime).
  // Void to signal fire-and-forget.
  void safe;
}
