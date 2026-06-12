/**
 * Cloud dispatch via Tempus WebSocket API.
 *
 * Replaces the HTTP+BUFFERED path with a true streaming model:
 *   1. Open WS to wss://<api>.execute-api.<region>.amazonaws.com/prod with
 *      the Clerk JWT in the `token` query parameter.
 *   2. On open, send `{action: "dispatch", prompt, repo, ref, sessionId, noteId}`.
 *   3. The Lambda provisions a wend-agent container; the container's
 *      stream_claude pushes each SSE frame back as a JSON envelope:
 *         {event: "route" | "stderr" | "done" | "message", data: "<json>"}
 *      We map those onto the same DispatchEvent shape the Mac path emits.
 *   4. Close the WS on `done`.
 */
import type { DispatchEvent } from "@/lib/dispatch/useDispatch";

const WS_URL = (process.env.EXPO_PUBLIC_TEMPUS_WS_URL || "").replace(/\/$/, "");

export interface CloudDispatchArgs {
  prompt: string;
  /** Optional explicit repo pin (e.g. set via long-press send). When
   *  omitted, the backend resolves the repo from the note content
   *  against the user's GitHub-App-accessible repos. */
  repo?: string;
  ref?: string;
  sessionId?: string;
  noteId?: string;
  noteTitle?: string;
  /** Expo push token; passed to the cloud agent so the container can fire
   *  a "your run is done" push when claude exits. */
  pushToken?: string;
  getToken: () => Promise<string | null>;
  onEvent: (e: DispatchEvent) => void;
  signal?: AbortSignal;
}

export async function cloudDispatchViaWebSocket(args: CloudDispatchArgs): Promise<void> {
  if (!WS_URL) {
    args.onEvent({
      type: "error",
      message: "Cloud streaming URL missing — set EXPO_PUBLIC_TEMPUS_WS_URL and rebuild.",
    });
    args.onEvent({ type: "done" });
    return;
  }
  const token = await args.getToken();
  if (!token) {
    args.onEvent({ type: "error", message: "Not signed in." });
    args.onEvent({ type: "done" });
    return;
  }

  const url = `${WS_URL}?token=${encodeURIComponent(token)}`;
  // Up to 2 attempts: the first frequently fights a Lambda cold start
  // ($connect handler can take 2-3s to fire). If the WS closes before
  // `dispatch` is acknowledged we retry once with backoff. Subsequent
  // failures are surfaced.
  const MAX_ATTEMPTS = 2;
  const BACKOFF_MS = 800;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await runOneAttempt(url, args, attempt);
    if (result === "retry" && attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS));
      continue;
    }
    return;
  }
}

type AttemptResult = "done" | "retry";

function runOneAttempt(
  url: string,
  args: CloudDispatchArgs,
  attempt: number,
): Promise<AttemptResult> {
  return new Promise<AttemptResult>((resolve) => {
    const ws = new WebSocket(url);
    let opened = false;
    let dispatched = false;
    let receivedAck = false;
    let finished = false;

    function finishDone(error?: { type: "error"; message: string }) {
      if (finished) return;
      finished = true;
      if (error) args.onEvent(error);
      args.onEvent({ type: "done" });
      try { ws.close(); } catch { /* already closed */ }
      resolve("done");
    }

    function finishRetry() {
      if (finished) return;
      finished = true;
      try { ws.close(); } catch { /* already closed */ }
      resolve("retry");
    }

    if (args.signal) {
      if (args.signal.aborted) {
        finishDone({ type: "error", message: "Cancelled" });
        return;
      }
      args.signal.addEventListener("abort", () => {
        finishDone({ type: "error", message: "Cancelled" });
      });
    }

    ws.onopen = () => {
      opened = true;
      try {
        ws.send(JSON.stringify({
          action: "dispatch",
          prompt: args.prompt,
          repo: args.repo || undefined,
          ref: args.ref || undefined,
          sessionId: args.sessionId,
          noteId: args.noteId,
          noteTitle: args.noteTitle,
          pushToken: args.pushToken || undefined,
        }));
        dispatched = true;
      } catch (err) {
        finishDone({
          type: "error",
          message: `Failed to send dispatch: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    };

    ws.onmessage = (msg) => {
      try {
        const payload = JSON.parse(typeof msg.data === "string" ? msg.data : "");
        const event = String(payload.event ?? "message");
        const data = payload.data ?? "";

        if (event === "ack") {
          receivedAck = true;
          return;
        }
        if (event === "route") {
          try {
            const r = JSON.parse(data);
            args.onEvent({
              type: "route",
              cwd: String(r.cwd ?? ""),
              name: String(r.name ?? ""),
              confidence: typeof r.confidence === "number" ? r.confidence : 0,
              source:
                r.source === "auto" || r.source === "pinned" || r.source === "fallback" || r.source === "cloud"
                  ? r.source
                  : "cloud",
            });
          } catch { /* malformed route payload */ }
          return;
        }
        if (event === "stderr") {
          // Warning, not error — stderr noise must not fail a successful run.
          try {
            const text = JSON.parse(data);
            args.onEvent({ type: "stderr", message: typeof text === "string" ? text : data });
          } catch {
            args.onEvent({ type: "stderr", message: data });
          }
          return;
        }
        if (event === "done") {
          finishDone();
          return;
        }
        parseClaudeFrame(data, args.onEvent);
      } catch { /* non-JSON message */ }
    };

    ws.onerror = () => {
      // Errors before open and before any work means cold-start /
      // transient — eligible to retry. Errors after dispatch are real.
      if (!opened || !receivedAck) {
        finishRetry();
        return;
      }
      finishDone({ type: "error", message: "Cloud stream error" });
    };

    ws.onclose = (e) => {
      if (finished) return;
      // Pre-open close or close before any ack means the WS handshake
      // failed mid-flight. Cold-start lambdas occasionally drop the first
      // $connect — retry once.
      if (!receivedAck && attempt < 2) {
        finishRetry();
        return;
      }
      const reason = e.reason || `closed (${e.code})`;
      finishDone({ type: "error", message: `Cloud connection ${reason}` });
    };
  });
}

/** Mirrors parseFrame() in useDispatch.ts for the "default" event case:
 *  the Claude stream-json line carries assistant text + tool calls. */
function parseClaudeFrame(data: string, onEvent: (e: DispatchEvent) => void): void {
  if (!data) return;
  let obj: unknown;
  try {
    obj = JSON.parse(data);
  } catch {
    return;
  }
  if (!obj || typeof obj !== "object") return;
  const o = obj as Record<string, unknown>;

  if (o.type === "assistant" && o.message && typeof o.message === "object") {
    const content = (o.message as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") {
          onEvent({ type: "text", text: b.text });
        } else if (b.type === "tool_use" && typeof b.name === "string") {
          onEvent({ type: "tool_use", name: b.name, input: b.input });
        }
      }
    }
  } else if (o.type === "result") {
    onEvent({
      type: "result",
      sessionId: String(o.session_id ?? ""),
      durationMs: Number(o.duration_ms ?? 0),
      costUsd: Number(o.total_cost_usd ?? 0),
      isError: Boolean(o.is_error),
    });
  }
}
