/**
 * Wend — claude.ai artifacts hook. Stale-while-revalidate over
 * GET /claude-artifacts: renders the cached list instantly, reloads on mount
 * and foreground, re-resolves a stale tunnel once, and polls while the Mac
 * reports a background refresh in flight.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { useResolvedDaemonURL } from "@/lib/dispatch/useResolvedDaemonURL";
import { fetchClaudeArtifacts, type ClaudeArtifactsPayload } from "@/lib/artifacts/claudeApi";
import { useClaudeArtifactsCache } from "@/store/claudeArtifactsCacheSlice";

export type ClaudeArtifactsStatus = "not-ready" | "loading" | "ready" | "error";

type LoadMode = "initial" | "pull" | "foreground" | "poll";

const POLL_MS = 4000;
const MAX_POLLS = 20;

export function useClaudeArtifacts() {
  const daemon = useResolvedDaemonURL();
  const daemonRef = useRef(daemon);
  daemonRef.current = daemon;

  const artifacts = useClaudeArtifactsCache((s) => s.list);
  const fetchedAt = useClaudeArtifactsCache((s) => s.fetchedAt);
  const syncedAt = useClaudeArtifactsCache((s) => s.syncedAt);

  const [status, setStatus] = useState<ClaudeArtifactsStatus>(
    syncedAt ? "ready" : daemon.isReady ? "loading" : "not-ready",
  );
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Each load bumps the generation; a response from a superseded load (or one
  // landing after unmount) is dropped so it cannot schedule a stray poll.
  const generation = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const polls = useRef(0);
  const loadRef = useRef<(mode: LoadMode) => Promise<void>>(async () => {});

  const load = useCallback(async (mode: LoadMode) => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
    if (mode !== "poll") polls.current = 0;
    const gen = ++generation.current;

    const d = daemonRef.current;
    if (!d.isReady) {
      setPulling(false);
      if (!useClaudeArtifactsCache.getState().syncedAt) setStatus("not-ready");
      return;
    }
    const cold = !useClaudeArtifactsCache.getState().syncedAt;
    if (mode === "pull") setPulling(true);
    if (cold && mode !== "poll") setStatus("loading");

    const get = async (refresh: boolean): Promise<ClaudeArtifactsPayload> => {
      try {
        return await fetchClaudeArtifacts({ url: d.url, token: d.token, refresh });
      } catch (err) {
        const fresh = d.deviceId ? await d.refresh().catch(() => null) : null;
        if (!fresh) throw err;
        return fetchClaudeArtifacts({ url: fresh, token: d.token, refresh });
      }
    };

    try {
      let payload = await get(mode === "pull");
      if (gen !== generation.current) return;
      if (mode === "initial" && payload.fetchedAt === null && !payload.refreshing && !payload.error) {
        payload = await get(true);
        if (gen !== generation.current) return;
      }
      // An empty list mid-refresh or on failure is the Mac's cold cache, not
      // an empty account; keep what the phone already has.
      if (payload.artifacts.length > 0 || (!payload.refreshing && !payload.error)) {
        useClaudeArtifactsCache.getState().setList(payload.artifacts, payload.fetchedAt);
      }
      setError(payload.error);
      setUnreachable(false);
      const keepPolling = payload.refreshing && polls.current < MAX_POLLS;
      setRefreshing(keepPolling);
      setStatus("ready");
      if (keepPolling) {
        polls.current += 1;
        pollTimer.current = setTimeout(() => void loadRef.current("poll"), POLL_MS);
      }
    } catch (err) {
      if (gen !== generation.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setUnreachable(true);
      setRefreshing(false);
      setStatus(cold ? "error" : "ready");
    } finally {
      if (gen === generation.current) setPulling(false);
    }
  }, []);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    void load("initial");
  }, [load, daemon.isReady]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void load("foreground");
    });
    return () => sub.remove();
  }, [load]);

  useEffect(
    () => () => {
      generation.current += 1;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    [],
  );

  const refresh = useCallback(() => load("pull"), [load]);

  return {
    artifacts,
    fetchedAt: fetchedAt ?? syncedAt,
    status,
    error,
    unreachable,
    pulling,
    refreshing,
    refresh,
  };
}
