/**
 * Wend — artifact fetching helpers.
 *
 * Artifacts live on the paired daemon at
 * `GET /run/<runId>/artifact/<id>?t=<token>`. The download URL is built from
 * the resolved daemon creds (rendezvous URL + bearer token). Text-kind
 * artifacts (diff, html) are fetched into memory for in-line rendering; the
 * fetch mirrors FileViewerModal's stale-tunnel guard (refresh the rendezvous
 * URL before the first read after a Mac restart).
 */
import { useEffect, useRef, useState } from "react";

import { useResolvedDaemonURL } from "@/lib/dispatch/useResolvedDaemonURL";

export function buildArtifactURL(
  base: string,
  token: string,
  runId: string,
  artifactId: string,
): string {
  return (
    `${base.replace(/\/$/, "")}/run/${encodeURIComponent(runId)}` +
    `/artifact/${encodeURIComponent(artifactId)}?t=${encodeURIComponent(token)}`
  );
}

export type ArtifactTextState =
  | { phase: "unavailable" }
  | { phase: "loading" }
  | { phase: "ready"; text: string }
  | { phase: "gone" }
  | { phase: "error" };

/** Resolved daemon creds + a ready-made URL builder for a given run. */
export function useArtifactSource(runId: string | undefined) {
  const resolved = useResolvedDaemonURL();
  const urlFor = (artifactId: string): string | null => {
    if (!runId || !resolved.isReady) return null;
    return buildArtifactURL(resolved.url, resolved.token, runId, artifactId);
  };
  return { resolved, urlFor };
}

/** Fetch a text-kind artifact (diff / html) into memory. */
export function useArtifactText(
  runId: string | undefined,
  artifactId: string,
  enabled: boolean,
): ArtifactTextState {
  const resolved = useResolvedDaemonURL();
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;

  const [state, setState] = useState<ArtifactTextState>({ phase: "loading" });

  useEffect(() => {
    if (!enabled) return;
    if (!runId || !resolved.isReady) {
      setState({ phase: "unavailable" });
      return;
    }
    let alive = true;
    setState({ phase: "loading" });
    (async () => {
      const r = resolvedRef.current;
      let base = r.url;
      if (r.deviceId) {
        const fresh = await r.refresh().catch(() => null);
        if (fresh && fresh.length > 0) base = fresh;
      }
      if (!alive) return;
      try {
        const res = await fetch(
          buildArtifactURL(base, r.token, runId, artifactId),
        );
        if (!alive) return;
        if (res.status === 404 || res.status === 410) {
          setState({ phase: "gone" });
          return;
        }
        if (!res.ok) {
          setState({ phase: "error" });
          return;
        }
        const text = await res.text();
        if (alive) setState({ phase: "ready", text });
      } catch {
        if (alive) setState({ phase: "error" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [runId, artifactId, enabled, resolved.isReady]);

  return state;
}

export function formatBytes(size: number): string {
  if (!size || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
