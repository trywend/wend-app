/**
 * Wend — useDaemonHealth hook.
 *
 * Lightweight background pinger for the spike daemon. Polls `/index` (the
 * daemon's index endpoint — a cheap GET that returns 200 when the process is
 * up and the token matches) on a 20s cadence and exposes a coarse health
 * signal the inbox + settings can render as a status dot.
 *
 * Uses the platform `fetch` (NOT `expo/fetch`) — we don't need streaming and
 * the platform fetch ships AbortController support that plays nice with our
 * 4s per-request timeout. `expo/fetch` is reserved for SSE consumption.
 *
 * Polling is skipped entirely when env vars are missing; no point burning a
 * timer when there's nothing to talk to.
 */
import { useEffect, useRef, useState } from "react";

import {
  daemonToken,
  daemonUrl,
  isDaemonConfigured,
} from "@/config/env";

export type DaemonHealthStatus = "ok" | "down" | "unknown" | "unconfigured";

export interface DaemonHealth {
  status: DaemonHealthStatus;
  /** Unix ms of the last completed (success or failure) check. */
  lastCheckedAt: number | null;
}

const POLL_INTERVAL_MS = 20_000;
const REQUEST_TIMEOUT_MS = 4_000;

export function useDaemonHealth(): DaemonHealth {
  const [status, setStatus] = useState<DaemonHealthStatus>(
    isDaemonConfigured ? "unknown" : "unconfigured",
  );
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);

  // Hold the mounted flag in a ref so a late-arriving fetch can't setState
  // after unmount and trigger a warning.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    if (!isDaemonConfigured) {
      setStatus("unconfigured");
      return () => {
        mountedRef.current = false;
      };
    }

    const ping = async () => {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );
      // Use /health (lightweight ~80-byte JSON). Older daemon revs only had
      // /index (full project list payload); if /health 404s we fall back so
      // health-checks don't lie about a perfectly-working daemon.
      const healthUrl = `${daemonUrl.replace(/\/$/, "")}/health?t=${encodeURIComponent(
        daemonToken,
      )}`;
      const indexUrl = `${daemonUrl.replace(/\/$/, "")}/index?t=${encodeURIComponent(
        daemonToken,
      )}`;
      const url = healthUrl;
      try {
        let res = await fetch(url, { signal: controller.signal });
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

    // Fire one immediately so the dot resolves quickly on mount, then poll.
    void ping();
    const interval = setInterval(ping, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  return { status, lastCheckedAt };
}
