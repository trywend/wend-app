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
  repo: string;
  ref: string;
  sessionId?: string;
  noteId?: string;
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
  return new Promise<void>((resolve) => {
    const ws = new WebSocket(url);
    let opened = false;
    let finished = false;

    function finish(error?: { type: "error"; message: string }) {
      if (finished) return;
      finished = true;
      if (error) args.onEvent(error);
      args.onEvent({ type: "done" });
      try { ws.close(); } catch { /* already closed */ }
      resolve();
    }

    if (args.signal) {
      if (args.signal.aborted) {
        finish({ type: "error", message: "Cancelled" });
        return;
      }
      args.signal.addEventListener("abort", () => {
        finish({ type: "error", message: "Cancelled" });
      });
    }

    ws.onopen = () => {
      opened = true;
      ws.send(JSON.stringify({
        action: "dispatch",
        prompt: args.prompt,
        repo: args.repo,
        ref: args.ref,
        sessionId: args.sessionId,
        noteId: args.noteId,
      }));
    };

    ws.onmessage = (msg) => {
      try {
        const payload = JSON.parse(typeof msg.data === "string" ? msg.data : "");
        const event = String(payload.event ?? "message");
        const data = payload.data ?? "";

        if (event === "ack") {
          // Initial provisioning ack; nothing to surface yet.
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
          try {
            const text = JSON.parse(data);
            args.onEvent({ type: "error", message: typeof text === "string" ? text : data });
          } catch {
            args.onEvent({ type: "error", message: data });
          }
          return;
        }
        if (event === "done") {
          finish();
          return;
        }
        // Default: a Claude stream-json line. Reuse the existing parser.
        parseClaudeFrame(data, args.onEvent);
      } catch {
        // Non-JSON message — ignore.
      }
    };

    ws.onerror = () => {
      finish({ type: "error", message: opened ? "Cloud stream error" : "Failed to connect to cloud" });
    };

    ws.onclose = (e) => {
      if (finished) return;
      const reason = e.reason || `closed (${e.code})`;
      finish({ type: "error", message: `Cloud connection ${reason}` });
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
