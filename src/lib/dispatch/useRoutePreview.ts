/**
 * Wend — routing preview for unpinned notes.
 *
 * Asks the Mac daemon (POST /resolve) where a note WOULD run, before it fires,
 * so a weak/home-dir match can ask the user to confirm instead of silently
 * running Claude in the wrong repo. Only meaningful for unpinned notes on the
 * Mac path; pinned notes already know their target. Debounced; never dispatches.
 */
import { useEffect, useState } from "react";

import { useResolvedDaemonURL } from "@/lib/dispatch/useResolvedDaemonURL";

export interface RoutePreview {
  /** Folder name the note would run in. */
  name: string;
  /** 0–1; low means the daemon isn't sure. */
  confidence: number;
  /** "auto" = matched a project, "fallback" = home dir (no match). */
  source: string;
}

/** Below this the match is too weak to auto-fire on — surface it for a tap. */
export const ROUTE_CONFIDENCE_MIN = 0.5;

export function useRoutePreview(
  prompt: string,
  enabled: boolean,
): RoutePreview | null {
  const resolved = useResolvedDaemonURL();
  const [preview, setPreview] = useState<RoutePreview | null>(null);

  useEffect(() => {
    if (!enabled || !resolved.isReady || prompt.trim().length < 12) {
      setPreview(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const { fetch: expoFetch } = await import("expo/fetch");
        const url = `${resolved.url.replace(/\/$/, "")}/resolve?t=${encodeURIComponent(
          resolved.token,
        )}`;
        const res = await expoFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt }),
        });
        if (!res.ok) {
          if (alive) setPreview(null);
          return;
        }
        const j = (await res.json()) as {
          name?: string;
          confidence?: number;
          source?: string;
        };
        if (!alive) return;
        setPreview({
          name: typeof j.name === "string" ? j.name : "",
          confidence: typeof j.confidence === "number" ? j.confidence : 0,
          source: typeof j.source === "string" ? j.source : "auto",
        });
      } catch {
        if (alive) setPreview(null);
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [prompt, enabled, resolved.isReady, resolved.url, resolved.token]);

  return preview;
}
