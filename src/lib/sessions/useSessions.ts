/**
 * Wend — sessions list hook.
 *
 * Resolves the Mac daemon URL, fetches the global session list, and exposes
 * loading / refreshing / error / daemon-not-ready states for the Sessions
 * screen. Server already sorts by lastModified desc — we never re-sort.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useResolvedDaemonURL } from "@/lib/dispatch/useResolvedDaemonURL";
import { fetchSessions, type SessionSummary } from "@/lib/sessions/api";

export type SessionsStatus =
  | "not-ready"
  | "loading"
  | "ready"
  | "error";

export interface UseSessionsResult {
  sessions: SessionSummary[];
  status: SessionsStatus;
  error: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export function useSessions(): UseSessionsResult {
  const daemon = useResolvedDaemonURL();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [status, setStatus] = useState<SessionsStatus>("not-ready");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadedOnceRef = useRef(false);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!daemon.isReady) {
        setStatus("not-ready");
        return;
      }
      if (mode === "refresh") setRefreshing(true);
      else if (!loadedOnceRef.current) setStatus("loading");
      try {
        const next = await fetchSessions({
          url: daemon.url,
          token: daemon.token,
        });
        setSessions(next);
        setError(null);
        setStatus("ready");
        loadedOnceRef.current = true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        if (!loadedOnceRef.current) setStatus("error");
      } finally {
        setRefreshing(false);
      }
    },
    [daemon.isReady, daemon.url, daemon.token],
  );

  useEffect(() => {
    void load("initial");
  }, [load]);

  const refresh = useCallback(() => load("refresh"), [load]);

  return { sessions, status, error, refreshing, refresh };
}
