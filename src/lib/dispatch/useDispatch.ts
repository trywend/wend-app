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
import { AppState } from "react-native";
import { fetch as expoFetch } from "expo/fetch";
import { useAuth } from "@clerk/clerk-expo";

import {
  daemonCwd,
  daemonToken as envDaemonToken,
  daemonUrl as envDaemonUrl,
  isDaemonConfigured as envDaemonConfigured,
} from "@/config/env";
import { useDispatchStore } from "@/store/dispatchSlice";
import { useDaemonStore } from "@/store/daemonSlice";
import { useResolvedDaemonURL } from "@/lib/dispatch/useResolvedDaemonURL";
import { buildPrompt } from "@/lib/dispatch/buildPrompt";
import { useCloudStore, effectiveDispatchTarget } from "@/store/cloudSlice";
import { useNotificationsStore } from "@/store/notificationsSlice";
import { getInstallId } from "@/lib/installId";
import { useSubscriptionStore, canDispatch } from "@/store/subscriptionSlice";
import { cloudDispatchViaWebSocket } from "@/lib/dispatch/cloudDispatch";
import { uploadAttachmentToDaemon } from "@/lib/attachments";

const TEMPUS_API_URL = (process.env.EXPO_PUBLIC_TEMPUS_API_URL || "").replace(/\/$/, "");
const TEMPUS_WS_URL = (process.env.EXPO_PUBLIC_TEMPUS_WS_URL || "").replace(/\/$/, "");

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
      source: "auto" | "pinned" | "fallback" | "cloud";
    }
  | {
      /** A line of claude's stderr. Usually harmless noise (hook failures,
       *  deprecation warnings) — consumers accumulate these as warnings and
       *  must NOT treat them as run failure. */
      type: "stderr";
      message: string;
    }
  | {
      /** Mac stream dropped mid-run; the hook is retrying against the
       *  daemon's resume endpoint. Purely informational — followed by
       *  normal events on success or an `error` on give-up. */
      type: "reconnecting";
    }
  | { type: "error"; message: string }
  | {
      /** Stream finished. On the Mac route this carries the daemon's own
       *  run id so the persisted run shares the id the daemon stored it
       *  under — otherwise a later /note/<id> hydration re-appends the
       *  same run under a fresh id and the card shows twice. */
      type: "done";
      runId?: string;
    };

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
  /** Note title for push-notification body. Sent to both Mac and Cloud
   *  routes so they can address the "your note ran" push correctly. */
  noteTitle?: string;
  /** Local attachments to deliver to the daemon before the run. Each is
   *  uploaded to /upload; the staged absolute paths are referenced in the
   *  dispatch so Claude can read them. Mac route only — cloud ignores. */
  attachments?: Array<{ localUri: string; name: string; mimeType: string }>;
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
  const { getToken } = useAuth();
  const dispatchMode = useCloudStore((s) => s.dispatchMode);
  const anthropicConnected = useCloudStore((s) => s.anthropicConnected);
  const githubConnected = useCloudStore((s) => s.githubConnected);
  const defaultRepo = useCloudStore((s) => s.defaultRepo);
  const defaultRef = useCloudStore((s) => s.defaultRef);

  const pushToken = useNotificationsStore((s) => s.token);
  const subscription = useSubscriptionStore();
  const target = effectiveDispatchTarget(
    { dispatchMode, anthropicConnected, githubConnected, defaultRepo, defaultRef } as never,
    { macPaired: resolved.isReady },
  );
  // Cloud is "configured" when both connections exist; the repo is
  // resolved server-side per dispatch so it doesn't gate readiness.
  const isCloudConfigured = anthropicConnected && githubConnected;
  const isConfigured = target === "cloud" ? isCloudConfigured && Boolean(TEMPUS_API_URL) : resolved.isReady;

  const dispatch = useCallback(async (args: DispatchArgs) => {
    // Subscription gate. The PaywallSheet host listens for `paywall`
    // events on onEvent and opens itself; if no listener handles it,
    // the dispatch just no-ops with a clear error event.
    if (!canDispatch(subscription, { mode: target })) {
      args.onEvent({
        type: "error",
        message: target === "mac"
          ? "Mac pairing requires Wend Pro. Open Settings → Subscription to upgrade."
          : "Cloud dispatches require a Wend subscription. Open Settings → Subscription to upgrade.",
      });
      args.onEvent({ type: "done" });
      return;
    }

    if (target === "cloud") {
      // WebSocket path = real streaming. Repo is resolved server-side
      // from the note content against the user's GitHub-App-accessible
      // repos; the phone sends only the prompt unless a caller has
      // explicitly pinned a repo via args.cwd (treated as "owner/name"
      // when in cloud mode for compatibility).
      const explicitRepo = args.cwd && args.cwd.includes("/") ? args.cwd : undefined;
      if (TEMPUS_WS_URL) {
        const controller = new AbortController();
        abortRef.current = controller;
        if (args.signal) {
          if (args.signal.aborted) controller.abort();
          else args.signal.addEventListener("abort", () => controller.abort());
        }
        setRunning(true);
        useDispatchStore.getState().setRunningNoteId(args.noteId ?? null);
        try {
          await cloudDispatchViaWebSocket({
            prompt: args.prompt,
            repo: explicitRepo,
            sessionId: args.sessionId,
            noteId: args.noteId,
            noteTitle: args.noteTitle,
            pushToken,
            getToken,
            onEvent: args.onEvent,
            signal: controller.signal,
          });
        } finally {
          setRunning(false);
          useDispatchStore.getState().setRunningNoteId(null);
          if (abortRef.current === controller) abortRef.current = null;
        }
        return;
      }
      return dispatchCloud(args, {
        repo: explicitRepo ?? "",
        ref: "main",
        getToken,
        abortRef,
        setRunning,
      });
    }
    if (!resolved.isReady) {
      args.onEvent({
        type: "error",
        message:
          "No Mac paired — open Settings → Connectivity → Mac and scan the QR from Wend.app.",
      });
      args.onEvent({ type: "done" });
      return;
    }
    // AWAIT a fresh resolve before dispatching. The earlier non-blocking
    // refresh pattern left the FIRST dispatch after any Mac tunnel
    // rotation (Mac restart, network change) firing at a stale URL —
    // the user got a `java.net.UnknownHostException` because the cached
    // trycloudflare host was already dead on Cloudflare's edge. The
    // 200-500ms rendezvous round-trip is invisible next to Claude's
    // multi-second response time and removes the entire class of
    // first-dispatch-after-restart failures.
    let liveUrl = resolved.url;
    if (resolved.deviceId) {
      const fresh = await resolved.refresh().catch(() => null);
      if (fresh && fresh.length > 0) liveUrl = fresh;
    }
    const creds = { url: liveUrl, token: resolved.token };

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

    // Resume-protocol bookkeeping. Daemons that speak the protocol stamp
    // every SSE frame with `id: <seq>` and put a runId in the route event;
    // when the socket dies mid-run ("Software caused connection abort")
    // we re-attach via GET /run/<runId>/stream?from=<lastSeq> instead of
    // failing a run that's still alive on the Mac. Older daemons never
    // surface a runId, so the resume branch is skipped entirely.
    const stream = { runId: null as string | null, lastSeq: 0, sawResult: false };
    const handleFrame = (frame: string) => {
      const seq = frameSeq(frame);
      if (seq !== null) {
        if (seq <= stream.lastSeq) return; // replayed duplicate
        stream.lastSeq = seq;
      }
      parseFrame(
        frame,
        (e) => {
          if (e.type === "result") stream.sawResult = true;
          args.onEvent(e);
        },
        { onRunId: (id) => { stream.runId = id; } },
      );
    };

    try {
      // Upload attachments first (if any) so the daemon has them staged
      // before claude spawns. Failures are non-fatal — we drop the file
      // and proceed so a flaky upload doesn't sink the whole dispatch.
      let uploadedAttachments: Array<{ path: string; name: string }> = [];
      if (args.attachments?.length) {
        const results = await Promise.all(
          args.attachments.map(async (att) => {
            try {
              return await uploadAttachmentToDaemon({
                baseUrl: creds.url,
                token: creds.token,
                noteId: args.noteId ?? "shared",
                attachment: att,
              });
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn("[wend] attachment upload failed:", att.name, e);
              return null;
            }
          }),
        );
        uploadedAttachments = results.filter(
          (r): r is { path: string; name: string } => r !== null,
        );
      }
      // Wrap the raw note in light deterministic framing so Claude has the
      // intent of a phone-sized message. Follow-up turns skip framing — the
      // resumed session already has the original framing in its history.
      const built = buildPrompt(args.prompt, {
        followUp: Boolean(args.sessionId),
        sessionId: args.sessionId,
      });
      const url = `${creds.url.replace(/\/$/, "")}/run?t=${encodeURIComponent(
        creds.token,
      )}`;
      const res = await expoFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: built.prompt,
          // The raw note the user wrote — what the Mac archives + displays.
          // `prompt` carries the deterministic system framing so claude has
          // phone-message intent; that framing must never resurface as a note.
          displayPrompt: args.prompt,
          cwd: args.cwd ?? daemonCwd ?? undefined,
          sessionId: args.sessionId,
          // Push notification context. The Mac daemon fires an Expo
          // push to this token when claude exits so the user knows the
          // run is done without keeping the app open.
          pushToken: pushToken || undefined,
          // Stable phone identity — the Mac hard-revokes a disconnected
          // phone by installId and 403s its dispatches.
          installId: await getInstallId(),
          noteId: args.noteId,
          noteTitle: args.noteTitle,
          attachments: uploadedAttachments.length ? uploadedAttachments : undefined,
        }),
        signal: controller.signal,
      });

      // Disconnected from this Mac: the daemon revoked this phone. Drop the
      // pairing so the app falls back to the pair-your-Mac flow.
      if (res.status === 403) {
        let revoked = false;
        try {
          revoked = (await res.text()).includes("revoked");
        } catch {
          revoked = false;
        }
        if (revoked) {
          useDaemonStore.getState().clear();
          args.onEvent({
            type: "error",
            message:
              "This phone was disconnected from your Mac. Pair again to keep Wending.",
          });
          return;
        }
      }

      if (!res.ok) {
        args.onEvent({
          type: "error",
          message: `Daemon returned ${res.status} ${res.statusText || ""}`.trim(),
        });
        return;
      }
      if (!res.body) {
        args.onEvent({ type: "error", message: "Daemon returned no body" });
        return;
      }

      let streamError: string | null = null;
      try {
        await readSseStream(res.body, handleFrame);
      } catch (err) {
        if (controller.signal.aborted) {
          args.onEvent({ type: "error", message: "Cancelled" });
          return;
        }
        streamError = err instanceof Error ? err.message : String(err);
      }

      // Clean finish — claude's result frame arrived before the stream
      // ended, so any trailing read error is just the socket closing.
      if (stream.sawResult) return;

      if (!stream.runId) {
        // Daemon predates the resume protocol — behave exactly as before.
        if (streamError) args.onEvent({ type: "error", message: streamError });
        return;
      }

      // Stream ended abnormally (error or EOF) without a result and
      // without a user abort: the run is likely still alive on the Mac.
      // Reconnect to the resume endpoint with backoff instead of erroring.
      const recovered = await resumeRunStream({
        runId: stream.runId,
        getLastSeq: () => stream.lastSeq,
        sawResult: () => stream.sawResult,
        handleFrame,
        baseUrl: creds.url,
        token: creds.token,
        refresh: resolved.refresh,
        signal: controller.signal,
        onEvent: args.onEvent,
      });
      if (controller.signal.aborted) {
        args.onEvent({ type: "error", message: "Cancelled" });
        return;
      }
      if (!recovered) {
        args.onEvent({
          type: "error",
          message: streamError ?? "Connection to your Mac was lost.",
        });
      }
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
      args.onEvent({ type: "done", runId: stream.runId ?? undefined });
      setRunning(false);
      useDispatchStore.getState().setRunningNoteId(null);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [target, resolved, getToken, pushToken]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { dispatch, running, cancel, isConfigured };
}

/** Cloud-dispatch path: hit the Tempus Lambda via API Gateway with the
 *  user's Clerk JWT. SSE event vocabulary matches the Mac daemon
 *  byte-for-byte (route, default JSONL frames, stderr, done) so the
 *  parser below works unchanged. */
async function dispatchCloud(
  args: DispatchArgs,
  ctx: {
    repo: string;
    ref: string;
    getToken: ReturnType<typeof useAuth>["getToken"];
    abortRef: { current: AbortController | null };
    setRunning: (b: boolean) => void;
  },
): Promise<void> {
  if (!TEMPUS_API_URL) {
    args.onEvent({
      type: "error",
      message: "Cloud API URL missing — set EXPO_PUBLIC_TEMPUS_API_URL and rebuild.",
    });
    args.onEvent({ type: "done" });
    return;
  }
  // The HTTP-fallback path still requires a repo because the legacy
  // /v1/cloud-dispatch endpoint doesn't do server-side resolution yet.
  // The WS path above handles auto-routing.
  if (!ctx.repo) {
    args.onEvent({
      type: "error",
      message: "Cloud streaming URL missing — set EXPO_PUBLIC_TEMPUS_WS_URL for repo auto-resolve.",
    });
    args.onEvent({ type: "done" });
    return;
  }

  const controller = new AbortController();
  ctx.abortRef.current = controller;
  if (args.signal) {
    if (args.signal.aborted) controller.abort();
    else args.signal.addEventListener("abort", () => controller.abort());
  }

  ctx.setRunning(true);
  useDispatchStore.getState().setRunningNoteId(args.noteId ?? null);
  try {
    const token = await ctx.getToken();
    if (!token) {
      args.onEvent({ type: "error", message: "Not signed in." });
      return;
    }
    const built = buildPrompt(args.prompt, {
      followUp: Boolean(args.sessionId),
      sessionId: args.sessionId,
    });
    const res = await expoFetch(`${TEMPUS_API_URL}/v1/cloud-dispatch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        prompt: built.prompt,
        repo: ctx.repo,
        ref: ctx.ref,
        sessionId: args.sessionId,
        noteId: args.noteId,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = `Cloud dispatch failed: HTTP ${res.status}`;
      try {
        const body = await res.text();
        const parsed = JSON.parse(body) as { detail?: string };
        if (parsed.detail) detail = parsed.detail;
      } catch { /* keep generic */ }
      args.onEvent({ type: "error", message: detail });
      return;
    }
    if (!res.body) {
      args.onEvent({ type: "error", message: "Cloud dispatch returned no body" });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) parseFrame(frame, args.onEvent);
    }
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
    ctx.setRunning(false);
    useDispatchStore.getState().setRunningNoteId(null);
    if (ctx.abortRef.current === controller) ctx.abortRef.current = null;
  }
}

/* ───── SSE stream reading + resume protocol ─────────────────────────── */

/** Backoff schedule for resume attempts (~3 min total before giving up).
 *  Cellular handoffs can take a while to settle, so we stay patient rather
 *  than surfacing a hard "connection lost" after ~30s. A foreground or
 *  network-regain event short-circuits the current wait (see
 *  waitForRetryWindow), so a user looking at the screen reconnects instantly. */
const RESUME_BACKOFF_MS = [
  1_000, 2_000, 4_000, 8_000, 12_000, 15_000, 20_000, 30_000, 30_000, 30_000,
  30_000,
];

/** ±25% jitter so many phones (or repeated attempts) don't all retry in
 *  lockstep into the same dead network window. */
function jitter(ms: number): number {
  return Math.round(ms * (0.875 + Math.random() * 0.25));
}

type SseBody = {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
  };
};

/** Read an SSE body to EOF, handing each blank-line-delimited frame to
 *  `handleFrame`. Throws whatever the underlying reader throws. */
async function readSseStream(
  body: SseBody,
  handleFrame: (frame: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) handleFrame(frame);
  }
  // Flush any final frame written without a trailing blank line.
  if (buffer.trim()) handleFrame(buffer);
}

/** Extract the SSE `id: <seq>` line from a raw frame, if present. */
function frameSeq(rawFrame: string): number | null {
  for (const line of rawFrame.split("\n")) {
    if (line.startsWith("id:")) {
      const n = Number(line.slice(3).trim());
      return Number.isFinite(n) && n > 0 ? n : null;
    }
  }
  return null;
}

/** Wait `ms`, but resolve early if the app returns to the foreground (the
 *  user is looking — retry now) or the dispatch is aborted. */
function waitForRetryWindow(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      appStateSub.remove();
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") finish();
    });
    signal.addEventListener("abort", finish);
  });
}

/** Re-attach to a dropped Mac run via the daemon's resume endpoint:
 *
 *    GET <daemonUrl>/run/<runId>/stream?from=<lastSeq>&t=<token>
 *
 *  Replays frames with seq > from, then live-tails until the run ends.
 *  404 = unknown/expired run, 410 = requested seq evicted — both are
 *  unrecoverable, so we stop immediately. Network failures walk the
 *  backoff schedule; the daemon URL is re-resolved before each attempt
 *  because the tunnel may have rotated with the same network blip that
 *  killed the stream. Returns true iff the run's result frame arrived. */
async function resumeRunStream(ctx: {
  runId: string;
  getLastSeq: () => number;
  sawResult: () => boolean;
  handleFrame: (frame: string) => void;
  baseUrl: string;
  token: string;
  refresh: () => Promise<string | null>;
  signal: AbortSignal;
  onEvent: (e: DispatchEvent) => void;
}): Promise<boolean> {
  let url = ctx.baseUrl;
  for (const backoffMs of RESUME_BACKOFF_MS) {
    // Re-announce before every attempt — a partially successful attempt
    // may have streamed frames that cleared the consumer's banner.
    ctx.onEvent({ type: "reconnecting" });
    await waitForRetryWindow(jitter(backoffMs), ctx.signal);
    if (ctx.signal.aborted) return false;

    const fresh = await ctx.refresh().catch(() => null);
    if (fresh && fresh.length > 0) url = fresh;

    const target =
      `${url.replace(/\/$/, "")}/run/${encodeURIComponent(ctx.runId)}/stream` +
      `?from=${ctx.getLastSeq()}&t=${encodeURIComponent(ctx.token)}`;
    try {
      const res = await expoFetch(target, { signal: ctx.signal });
      if (res.status === 404 || res.status === 410) return false;
      if (!res.ok || !res.body) continue;
      await readSseStream(res.body, ctx.handleFrame);
      if (ctx.sawResult()) return true;
      // Tailed to EOF without a result — the connection dropped again.
    } catch {
      if (ctx.signal.aborted) return false;
    }
  }
  return ctx.sawResult();
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
function parseFrame(
  rawFrame: string,
  onEvent: (e: DispatchEvent) => void,
  hooks?: { onRunId?: (runId: string) => void },
) {
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
    // Surface stderr as a WARNING, never an error — claude routinely emits
    // harmless noise here (hook failures, deprecation chatter) on runs that
    // succeed. Consumers accumulate these and only promote the last line to
    // an error detail if the run actually fails.
    try {
      const text = JSON.parse(data);
      onEvent({
        type: "stderr",
        message: typeof text === "string" ? text : data,
      });
    } catch {
      onEvent({ type: "stderr", message: data });
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
      if (typeof r.runId === "string" && r.runId.length > 0) {
        hooks?.onRunId?.(r.runId);
      }
      if (typeof r.cwd === "string" && typeof r.name === "string") {
        onEvent({
          type: "route",
          cwd: r.cwd,
          name: r.name,
          confidence: typeof r.confidence === "number" ? r.confidence : 0,
          source:
            r.source === "auto" || r.source === "pinned" || r.source === "fallback" || r.source === "cloud"
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
