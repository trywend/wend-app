/**
 * Wend — useDispatch hook.
 *
 * Phase 2 dispatch primitive. POSTs a prompt to the spike daemon's `/run`
 * endpoint and parses the SSE stream of `claude -p --output-format=stream-json`
 * frames into a small, app-friendly event shape:
 *
 *   - text       — assistant tokens (accumulate to render streaming response)
 *   - tool_use   — Claude called a tool (we just surface the name; the daemon
 *                  doesn't yet route permission requests, that's Phase 5)
 *   - result     — terminal frame from Claude with session id + cost + ms
 *   - error      — anything went wrong (network, 401, daemon crash)
 *   - done       — stream ended cleanly
 *
 * Uses `expo/fetch` (not the global fetch) — only `expo/fetch` exposes the
 * WHATWG ReadableStream on response.body in Expo SDK 56, which we need to
 * incrementally read SSE frames as they arrive. React Native's built-in
 * fetch buffers the whole body.
 *
 * Phase 3+ swaps the URL/token for a per-device Tailscale endpoint, but the
 * event shape stays — callers won't have to change.
 */
import { useCallback, useRef, useState } from "react";
import { fetch as expoFetch } from "expo/fetch";

import {
  daemonCwd,
  daemonToken as envDaemonToken,
  daemonUrl as envDaemonUrl,
  isDaemonConfigured as envDaemonConfigured,
} from "@/config/env";
import { useDispatchStore } from "@/store/dispatchSlice";
import { useDaemonStore } from "@/store/daemonSlice";
import { useResolvedDaemonURL } from "@/lib/dispatch/useResolvedDaemonURL";

export type DispatchEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input?: unknown }
  | {
      type: "result";
      sessionId: string;
      durationMs: number;
      costUsd: number;
      isError: boolean;
    }
  | {
      /** Daemon resolved (or echoed) the project this run is happening in.
       *  Fired BEFORE any text frame, so the UI can render the project chip
       *  immediately. `source` distinguishes auto-routing from a caller pin
       *  vs the daemon's homedir fallback. */
      type: "route";
      cwd: string;
      name: string;
      confidence: number;
      source: "auto" | "pinned" | "fallback";
    }
  | { type: "error"; message: string }
  | { type: "done" };

export interface DispatchArgs {
  prompt: string;
  /** Override the daemon's working directory for this run. */
  cwd?: string;
  /** Continue a previous Claude session by id (enables --resume). */
  sessionId?: string;
  /** Note this dispatch belongs to. When provided, the hook publishes it to
   *  the dispatchSlice so the inbox can render a "running" pip while the
   *  stream is in flight. Cleared on completion (success or error). Optional
   *  to keep older callers working. */
  noteId?: string;
  /** Called for every SSE frame parsed off the wire. */
  onEvent: (event: DispatchEvent) => void;
  /** Abort signal — passed straight through to expo/fetch. */
  signal?: AbortSignal;
}

export interface UseDispatchResult {
  /** Send a prompt to the daemon. Resolves when the stream ends. */
  dispatch: (args: DispatchArgs) => Promise<void>;
  /** True while a dispatch is in flight. */
  running: boolean;
  /** Imperatively cancel the in-flight dispatch. No-op when idle. */
  cancel: () => void;
  /** True once env vars are set; false means "show a config error". */
  isConfigured: boolean;
}

export function useDispatch(): UseDispatchResult {
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Reconciler hook — resolves the live URL from the rendezvous backend
  // for v2 pairings, falls back to cached / env values. We re-read each
  // dispatch instead of capturing, so a slice update between renders
  // (e.g., user re-pairs mid-session) reflects on the next send.
  const resolved = useResolvedDaemonURL();

  const dispatch = useCallback(async (args: DispatchArgs) => {
    if (!resolved.isReady) {
      args.onEvent({
        type: "error",
        message:
          "No Mac paired — open Settings → Connectivity → Mac and scan the QR from Wend.app.",
      });
      args.onEvent({ type: "done" });
      return;
    }
    // Best-effort refresh if the cached URL is stale OR this is a v2
    // device that hasn't resolved yet. Non-blocking — we fire it and
    // immediately use the current url; the refreshed value lands in
    // the slice for the NEXT dispatch. Trading one extra round-trip
    // (only on the very first call after pairing) for guaranteed
    // freshness without coupling dispatch latency to the rendezvous.
    if (resolved.deviceId) {
      void resolved.refresh();
    }
    const creds = { url: resolved.url, token: resolved.token };

    const controller = new AbortController();
    abortRef.current = controller;
    // Chain caller's signal — if they abort, we abort our internal one too.
    if (args.signal) {
      if (args.signal.aborted) controller.abort();
      else args.signal.addEventListener("abort", () => controller.abort());
    }

    setRunning(true);
    // Publish the running note id so the inbox can light up its "running"
    // pip. We deliberately set this AFTER the early-return path above — an
    // un-configured daemon shouldn't flip the pip on at all.
    useDispatchStore.getState().setRunningNoteId(args.noteId ?? null);
    try {
      const url = `${creds.url.replace(/\/$/, "")}/run?t=${encodeURIComponent(
        creds.token,
      )}`;
      const res = await expoFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: args.prompt,
          cwd: args.cwd ?? daemonCwd ?? undefined,
          sessionId: args.sessionId,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        args.onEvent({
          type: "error",
          message: `Daemon returned ${res.status} ${res.statusText || ""}`.trim(),
        });
        args.onEvent({ type: "done" });
        return;
      }
      if (!res.body) {
        args.onEvent({ type: "error", message: "Daemon returned no body" });
        args.onEvent({ type: "done" });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) parseFrame(frame, args.onEvent);
      }
      // Flush any final frame the daemon wrote without a trailing blank line.
      if (buffer.trim()) parseFrame(buffer, args.onEvent);
    } catch (err) {
      if (controller.signal.aborted) {
        args.onEvent({ type: "error", message: "Cancelled" });
      } else {
        args.onEvent({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      args.onEvent({ type: "done" });
      setRunning(false);
      useDispatchStore.getState().setRunningNoteId(null);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // `resolved.isReady` already lives off the same store + env fallback,
  // so the banner / dot react the instant a QR scan completes.
  return { dispatch, running, cancel, isConfigured: resolved.isReady };
}

/* ───── Frame parser ─────────────────────────────────────────────────── */

/**
 * One SSE frame looks like:
 *
 *   event: stderr        ← optional; absent for default "message" events
 *   data: <json line>    ← mandatory; may be multi-line, joined with newlines
 *
 * The spike daemon emits Claude's stream-json events directly inside `data:`,
 * plus a final `event: done` frame. We unwrap to the typed events above.
 */
function parseFrame(rawFrame: string, onEvent: (e: DispatchEvent) => void) {
  const lines = rawFrame.split("\n");
  let eventType = "message";
  const dataParts: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event: ")) eventType = line.slice(7).trim();
    else if (line.startsWith("data: ")) dataParts.push(line.slice(6));
    else if (line.startsWith("data:")) dataParts.push(line.slice(5));
  }
  const data = dataParts.join("\n").trim();
  if (!data) return;

  if (eventType === "stderr") {
    // Surface stderr as an error event — usually noise during normal runs,
    // but if Claude blows up we want to see it.
    try {
      const text = JSON.parse(data);
      onEvent({
        type: "error",
        message: typeof text === "string" ? text : data,
      });
    } catch {
      onEvent({ type: "error", message: data });
    }
    return;
  }
  if (eventType === "done") {
    // Daemon signals end-of-stream; the outer reader loop will also exit on
    // EOF, so we don't fire `done` here (the finally block does).
    return;
  }
  if (eventType === "route") {
    // Smart routing payload from the daemon — emitted before any Claude
    // frame. Shape: { cwd, name, confidence, source }.
    try {
      const r = JSON.parse(data);
      if (typeof r.cwd === "string" && typeof r.name === "string") {
        onEvent({
          type: "route",
          cwd: r.cwd,
          name: r.name,
          confidence: typeof r.confidence === "number" ? r.confidence : 0,
          source:
            r.source === "auto" || r.source === "pinned" || r.source === "fallback"
              ? r.source
              : "auto",
        });
      }
    } catch {
      // bad route payload — ignore, the rest of the stream still works
    }
    return;
  }

  // Default `message` event — payload is one Claude stream-json line.
  let parsed: any;
  try {
    parsed = JSON.parse(data);
  } catch {
    return; // non-JSON; skip
  }

  if (parsed.type === "assistant" && parsed.message?.content) {
    for (const c of parsed.message.content) {
      if (c.type === "text" && typeof c.text === "string") {
        onEvent({ type: "text", text: c.text });
      } else if (c.type === "tool_use" && typeof c.name === "string") {
        onEvent({ type: "tool_use", name: c.name, input: c.input });
      }
    }
    return;
  }

  if (parsed.type === "result") {
    onEvent({
      type: "result",
      sessionId: String(parsed.session_id ?? ""),
      durationMs: Number(parsed.duration_ms ?? 0),
      costUsd: Number(parsed.total_cost_usd ?? 0),
      isError: Boolean(parsed.is_error),
    });
    return;
  }

  // system / user / tool_result frames: we ignore for now. The result frame
  // is what closes the run; intermediate types are just protocol scaffolding.
}
