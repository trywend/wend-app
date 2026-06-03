/**
 * useResolvedDaemonURL — fetch the live tunnel URL from the rendezvous
 * backend (Phase 3 v2 architecture).
 *
 * Why this exists: the Mac's tunnel URL is ephemeral (Tailscale
 * reconnects, ngrok rotates, public IP changes). The phone shouldn't
 * have to re-pair every time. Instead, the Mac PUTs its current URL
 * to trywend.app/api/devices/:deviceId on every change, and the phone
 * GETs it on demand. The deviceId + token (from the pairing QR) are
 * the stable identifiers.
 *
 * Resolution priority:
 *   1. Rendezvous resolve (v2 — deviceId + token present)
 *   2. Cached `url` in the slice (v1 fallback, OR v2 with `urlHint`
 *      before the first resolve completes)
 *   3. Env-var URL (dev / hardcoded)
 *
 * Caching: 30s in-memory + persisted to the slice. We don't re-fetch on
 * every dispatch — the URL almost never changes mid-session. Force a
 * refresh by calling `refresh()`; dispatch errors call it automatically.
 *
 * Edge case: rendezvous backend down. Falls back to the cached URL.
 * If that also fails the dispatch surfaces a network error and the
 * user can retry — same UX as if the daemon itself were down.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useDaemonStore } from "@/store/daemonSlice";
import {
  daemonUrl as envDaemonUrl,
  daemonToken as envDaemonToken,
} from "@/config/env";

/** Production rendezvous backend (Vercel deployment of the landing).
 *  Override via EXPO_PUBLIC_RENDEZVOUS_BASE for local dev. */
const RENDEZVOUS_BASE =
  process.env.EXPO_PUBLIC_RENDEZVOUS_BASE ||
  "https://wend-landing.vercel.app";
const RESOLVE_TIMEOUT_MS = 4_000;
/** A resolved URL is considered fresh for this long before we'd re-fetch
 *  on the next dispatch. Cheap fetch — the cache is just to avoid one
 *  extra round-trip per send when the user's hammering the send button. */
const FRESH_FOR_MS = 30_000;

export interface ResolvedDaemon {
  /** Best-known URL right now. May be the rendezvous result, the
   *  cached URL hint, or the env fallback. Empty string when none. */
  url: string;
  /** Whichever token the dispatch should use as Authorization: Bearer.
   *  Pairing-store token wins; env fallback when not paired. */
  token: string;
  /** True iff we have actionable creds (url + token both non-empty). */
  isReady: boolean;
  /** Active rendezvous deviceId, if v2 paired. */
  deviceId: string | null;
  /** Force a fresh rendezvous resolve. Returns the new URL, or null on
   *  failure. Dispatch errors should call this then retry. */
  refresh: () => Promise<string | null>;
}

export function useResolvedDaemonURL(): ResolvedDaemon {
  const url = useDaemonStore((s) => s.url);
  const token = useDaemonStore((s) => s.token);
  const deviceId = useDaemonStore((s) => s.deviceId);
  const setResolvedURL = useDaemonStore((s) => s.setResolvedURL);

  // Tracks when we last finished a successful rendezvous resolve so we
  // can skip the network call within the freshness window.
  const lastResolvedAtRef = useRef<number>(0);

  const refresh = useCallback(async (): Promise<string | null> => {
    if (!deviceId || !token) return null;
    const target = `${RENDEZVOUS_BASE.replace(/\/$/, "")}/api/devices/${encodeURIComponent(deviceId)}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
      const res = await fetch(target, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const body = (await res.json()) as { currentUrl?: string | null };
      const fresh = body?.currentUrl ?? null;
      if (fresh && fresh.length > 0 && fresh !== url) {
        setResolvedURL(fresh);
      }
      lastResolvedAtRef.current = Date.now();
      return fresh ?? null;
    } catch {
      return null;
    }
  }, [deviceId, token, url, setResolvedURL]);

  // On first mount with v2 creds, resolve immediately. Also re-resolve
  // whenever the deviceId changes (user re-pairs to a different Mac).
  useEffect(() => {
    if (!deviceId || !token) return;
    if (Date.now() - lastResolvedAtRef.current < FRESH_FOR_MS) return;
    void refresh();
  }, [deviceId, token, refresh]);

  // Compose the public shape. v2 + resolved URL takes priority, then
  // cached URL (v2 hint or v1), then env fallback. Same logic for the
  // token.
  const resolvedUrl = url.length > 0 ? url : envDaemonUrl;
  const resolvedToken = token.length > 0 ? token : envDaemonToken;
  const isReady = resolvedUrl.length > 0 && resolvedToken.length > 0;

  return {
    url: resolvedUrl,
    token: resolvedToken,
    isReady,
    deviceId: deviceId.length > 0 ? deviceId : null,
    refresh,
  };
}
