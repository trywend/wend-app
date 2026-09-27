/**
 * Wend — artifacts library hook. Stale-while-revalidate over GET /artifacts:
 * renders the cached list instantly, refreshes on mount and foreground, and
 * re-resolves the rendezvous URL once when a stale tunnel fails the fetch.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { useResolvedDaemonURL } from "@/lib/dispatch/useResolvedDaemonURL";
import {
  deleteLibraryArtifact,
  fetchArtifactsLibrary,
  type LibraryArtifact,
} from "@/lib/artifacts/api";
import { useArtifactsCache } from "@/store/artifactsCacheSlice";

export type ArtifactsStatus = "not-ready" | "loading" | "ready" | "error";

export function useArtifactsLibrary() {
  const daemon = useResolvedDaemonURL();
  const daemonRef = useRef(daemon);
  daemonRef.current = daemon;

  const artifacts = useArtifactsCache((s) => s.list);
  const storedBytes = useArtifactsCache((s) => s.storedBytes);
  const syncedAt = useArtifactsCache((s) => s.syncedAt);

  const [status, setStatus] = useState<ArtifactsStatus>(
    syncedAt ? "ready" : daemon.isReady ? "loading" : "not-ready",
  );
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      const d = daemonRef.current;
      if (!d.isReady) {
        if (!useArtifactsCache.getState().syncedAt) setStatus("not-ready");
        return;
      }
      const cold = !useArtifactsCache.getState().syncedAt;
      if (mode === "refresh") setRefreshing(true);
      else if (cold) setStatus("loading");
      try {
        let payload;
        try {
          payload = await fetchArtifactsLibrary({ url: d.url, token: d.token });
        } catch (err) {
          const fresh = d.deviceId ? await d.refresh().catch(() => null) : null;
          if (!fresh) throw err;
          payload = await fetchArtifactsLibrary({ url: fresh, token: d.token });
        }
        useArtifactsCache.getState().setLibrary(payload.artifacts, payload.storedBytes);
        setError(null);
        setStatus("ready");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus(cold ? "error" : "ready");
      } finally {
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load("initial");
  }, [load, daemon.isReady]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void load("refresh");
    });
    return () => sub.remove();
  }, [load]);

  const refresh = useCallback(() => load("refresh"), [load]);

  const remove = useCallback(async (a: LibraryArtifact) => {
    const d = daemonRef.current;
    await deleteLibraryArtifact({ url: d.url, token: d.token, runId: a.runId, id: a.id });
    useArtifactsCache.getState().remove(a.runId, a.id);
  }, []);

  return { artifacts, storedBytes, status, error, refreshing, refresh, remove };
}
