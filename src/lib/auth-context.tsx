// Single source of truth for auth state across the app.
// Use useAuth() in pages/layouts instead of calling supabase.auth.getUser()
// or subscribing to onAuthStateChange in multiple places (causes race
// conditions and redirect loops).
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type DebugEntry = {
  at: string;
  event: string;
  detail?: string;
};

type AuthState = {
  // ready = initial session check resolved (success or null). Drives every guard.
  isReady: boolean;
  session: Session | null;
  user: User | null;
  // adminReady = role lookup finished for the current user (always true when !user).
  isAdminReady: boolean;
  isAdmin: boolean;
  // Last reason a guard redirected — surfaced in /admin/auth-debug.
  lastRedirectReason: string | null;
  recordRedirect: (reason: string) => void;
  debugLog: DebugEntry[];
  refreshAdmin: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const MAX_LOG = 50;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [checkedUserId, setCheckedUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [lastRedirectReason, setLastRedirectReason] = useState<string | null>(null);
  const [debugLog, setDebugLog] = useState<DebugEntry[]>([]);
  const inFlightRef = useRef<string | null>(null);

  const push = (event: string, detail?: string) => {
    setDebugLog((prev) => {
      const next = [{ at: new Date().toISOString(), event, detail }, ...prev];
      return next.slice(0, MAX_LOG);
    });
  };

  // 1) Initial session restore + subscribe to changes (ONE place only).
  useEffect(() => {
    let mounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (!mounted) return;
      setSession(s);
      push("auth_state_change", `${event} → user=${s?.user?.id ?? "null"}`);
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      setIsReady(true);
      push("initial_session", data.session?.user?.id ?? "null");
    }).catch((err) => {
      if (!mounted) return;
      setIsReady(true);
      push("initial_session_error", String(err?.message ?? err));
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const user = session?.user ?? null;

  // Derived: admin lookup is ready when checkedUserId matches current user (or no user).
  // This avoids a race where the role-check effect hasn't yet flipped isAdminReady
  // to false after a sign-in — children would briefly see admin=false and redirect wrong.
  const isAdminReady = !user || checkedUserId === user.id;

  const runAdminCheck = async (uid: string) => {
    if (inFlightRef.current === uid) return;
    inFlightRef.current = uid;
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", uid)
      .eq("role", "admin")
      .maybeSingle();
    if (inFlightRef.current !== uid) return;
    setIsAdmin(!!data && !error);
    setCheckedUserId(uid);
    push("admin_check", `${uid} → ${!!data && !error}`);
  };

  const refreshAdmin = async () => {
    if (!user) { setIsAdmin(false); setCheckedUserId(null); return; }
    inFlightRef.current = null;
    await runAdminCheck(user.id);
  };

  useEffect(() => {
    if (!isReady) return;
    if (!user) {
      setIsAdmin(false);
      setCheckedUserId(null);
      inFlightRef.current = null;
      return;
    }
    if (checkedUserId === user.id) return;
    void runAdminCheck(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, user?.id]);

  const recordRedirect = (reason: string) => {
    setLastRedirectReason(reason);
    push("redirect", reason);
  };

  const value = useMemo<AuthState>(() => ({
    isReady,
    session,
    user,
    isAdminReady,
    isAdmin,
    lastRedirectReason,
    recordRedirect,
    debugLog,
    refreshAdmin,
  }), [isReady, session, user, isAdminReady, isAdmin, lastRedirectReason, debugLog]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
