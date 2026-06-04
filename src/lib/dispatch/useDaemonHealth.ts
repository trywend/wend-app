/**
 * Wend — useDaemonHealth hook.
 *
 * Background pinger for the Mac daemon. Resolves the live URL through
 * the rendezvous backend (so we don't ping a stale URL the Mac
 * abandoned after a tunnel rotation), then GETs /health with the
 * paired bearer. 20s cadence, 4s per-request timeout.
 *
 * Crucially, we await `resolved.refresh()` BEFORE every ping. The
 * resolver's in-memory cache (30s TTL on success) would otherwise let
 * the dot stay red across Mac restarts that happen faster than the
 * cache TTL — exactly the case the user hits when iterating on the
 * Mac app. One extra round-trip to the rendezvous per poll is cheap
 * (~200ms typical) and removes the stale-cache class of bugs entirely.
 *
 * Uses the platform `fetch` (NOT `expo/fetch`) — we don't need
 * streaming and the platform fetch ships AbortController support that
 * plays nice with our timeout.
 */
import { useEffect, useRef, useState } from "react";

import { useResolvedDaemonURL } from "@/lib/dispatch/useResolvedDaemonURL";

export type DaemonHealthStatus = "ok" | "down" | "unknown" | "unconfigured";

export interface DaemonHealth {
  status: DaemonHealthStatus;
  /** Unix ms of the last completed (success or failure) check. */
  lastCheckedAt: number | null;
}

const POLL_INTERVAL_MS = 20_000;
const REQUEST_TIMEOUT_MS = 4_000;

export function useDaemonHealth(): DaemonHealth {
  const resolved = useResolvedDaemonURL();
  const isConfigured = resolved.isReady;

  const [status, setStatus] = useState<DaemonHealthStatus>(
    isConfigured ? "unknown" : "unconfigured",
  );
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);

  const mountedRef = useRef(true);
  // Stash the resolver in a ref so the polling closure always sees the
  // current refresh() function without re-running the effect on every
  // url/token change. The effect re-runs only on isConfigured change.
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;

  useEffect(() => {
    mountedRef.current = true;

    if (!isConfigured) {
      setStatus("unconfigured");
      return () => {
        mountedRef.current = false;
      };
    }

    const ping = async () => {
      // Force a live URL refresh before each ping. Catches the case
      // where the Mac restarted and minted a new cloudflared URL since
      // our last poll — without this, the dot stays red forever even
      // though the daemon is healthy at the new URL.
      const r = resolvedRef.current;
      if (r.deviceId) {
        await r.refresh().catch(() => null);
      }
      const url0 = resolvedRef.current.url;
      const token0 = resolvedRef.current.token;
      if (!url0 || !token0) {
        if (mountedRef.current) {
          setStatus("down");
          setLastCheckedAt(Date.now());
        }
        return;
      }

      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );
      const healthUrl = `${url0.replace(/\/$/, "")}/health?t=${encodeURIComponent(
        token0,
      )}`;
      const indexUrl = `${url0.replace(/\/$/, "")}/index?t=${encodeURIComponent(
        token0,
      )}`;
      try {
        let res = await fetch(healthUrl, { signal: controller.signal });
        if (res.status === 404) {
          // Fall back to /index for older daemons.
          res = await fetch(indexUrl, { signal: controller.signal });
        }
        if (!mountedRef.current) return;
        setStatus(res.ok ? "ok" : "down");
      } catch {
        if (!mountedRef.current) return;
        setStatus("down");
      } finally {
        clearTimeout(timer);
        if (mountedRef.current) setLastCheckedAt(Date.now());
      }
    };

    void ping();
    const interval = setInterval(ping, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [isConfigured]);

  return { status, lastCheckedAt };
}
