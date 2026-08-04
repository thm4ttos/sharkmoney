// Client-side affiliate tracker. Reads ?ref= or ?af= from URL, sends to
// the server for click logging, and persists the ref code in localStorage
// for the signup flow to attach as user metadata.
import { useEffect } from "react";

const STORAGE_KEY = "abio_ref";
const STORAGE_EXP = "abio_ref_exp";
const DEFAULT_TTL_DAYS = 60;

export function readStoredRef(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const exp = Number(localStorage.getItem(STORAGE_EXP) || 0);
    if (exp && exp < Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_EXP);
      return null;
    }
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeRef(code: string) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
    localStorage.setItem(STORAGE_EXP, String(Date.now() + DEFAULT_TTL_DAYS * 86400_000));
  } catch {}
}

export function AffiliateTracker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref") || params.get("af");
    if (!ref) return;
    const campaign = params.get("c") || params.get("campaign") || null;
    const utm: Record<string, string> = {};
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
      const v = params.get(k);
      if (v) utm[k] = v;
    }

    fetch("/api/public/affiliate/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref,
        campaign,
        path: window.location.pathname,
        source: document.referrer ? new URL(document.referrer).hostname : null,
        utm: Object.keys(utm).length ? utm : null,
      }),
    })
      .then((r) => r.json())
      .then((r) => {
        if (r?.ok && r?.code) storeRef(r.code);
      })
      .catch(() => {});
  }, []);

  return null;
}
