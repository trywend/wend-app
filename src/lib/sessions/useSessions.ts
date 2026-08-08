/**
 * Wend — sessions list hook.
 *
 * Resolves the Mac daemon URL, then serves the sessions list with a
 * persisted stale-while-revalidate policy: the tab renders the cached list
 * instantly and refreshes in the background. The loading state is shown only
 * on the true first-ever load, when no cache exists yet. Server already sorts
 * by lastModified desc — we never re-sort.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { useResolvedDaemonURL } from "@/lib/dispatch/useResolvedDaemonURL";
import { fetchSessions, type SessionSummary } from "@/lib/sessions/api";
import { useSessionsCache } from "@/store/sessionsCacheSlice";

export type SessionsStatus = "not-ready" | "loading" | "ready" | "error";

export interface UseSessionsResult {
  sessions: SessionSummary[];
  status: SessionsStatus;
  error: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

const PREFETCH_INTERVAL_MS = 15_000;
let lastPrefetchAt = 0;

export async function prefetchSessions(args: {
  url: string;
  token: string;
  isReady: boolean;
}): Promise<void> {
  if (!args.isReady) return;
  if (Date.now() - lastPrefetchAt < PREFETCH_INTERVAL_MS) return;
  lastPrefetchAt = Date.now();
  try {
    const next = await fetchSessions({ url: args.url, token: args.token });
    useSessionsCache.getState().setList(next);
  } catch {
    lastPrefetchAt = 0;
  }
}

export function useSessions(): UseSessionsResult {
  const daemon = useResolvedDaemonURL();
  const sessions = useSessionsCache((s) => s.list);
  const setList = useSessionsCache((s) => s.setList);

  const hasCache = sessions.length > 0;
  const [status, setStatus] = useState<SessionsStatus>(
    hasCache ? "ready" : daemon.isReady ? "loading" : "not-ready",
  );
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadedOnceRef = useRef(false);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!daemon.isReady) {
        if (useSessionsCache.getState().list.length === 0) setStatus("not-ready");
        return;
      }
      const cold =
        useSessionsCache.getState().list.length === 0 && !loadedOnceRef.current;
      if (mode === "refresh") setRefreshing(true);
      else if (cold) setStatus("loading");
      try {
        const next = await fetchSessions({
          url: daemon.url,
          token: daemon.token,
        });
        lastPrefetchAt = Date.now();
        setList(next);
        setError(null);
        setStatus("ready");
        loadedOnceRef.current = true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        if (cold) setStatus("error");
        else setStatus("ready");
      } finally {
        setRefreshing(false);
      }
    },
    [daemon.isReady, daemon.url, daemon.token, setList],
  );

  useEffect(() => {
    void load("initial");
  }, [load]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void load("refresh");
    });
    return () => sub.remove();
  }, [load]);

  const refresh = useCallback(() => load("refresh"), [load]);

  return { sessions, status, error, refreshing, refresh };
}
