/**
 * Wend — fire-and-forget POST /run for the durable queue.
 *
 * A lean sibling of useDispatch's Mac path: it POSTs a queued dispatch to the
 * daemon and reports whether the daemon ACCEPTED it. It does NOT stream the
 * response — once the daemon has the run it completes independently (journaled
 * + recorded in NoteStore) and the result hydrates on the phone via the
 * existing catch-up (catchUpMac). We cancel the SSE body as soon as we've
 * confirmed acceptance so the socket doesn't linger.
 *
 * Result vocabulary tells the retry driver what to do:
 *   accepted — remove from queue; result hydrates later.
 *   network  — Mac unreachable; keep the item, back off, retry.
 *   revoked  — this phone was disconnected; pairing cleared, drop the item.
 *   rejected — daemon responded with an app-level failure; retrying won't help.
 */
import { fetch as expoFetch } from "expo/fetch";

import { buildPrompt } from "@/lib/dispatch/buildPrompt";
import { useDaemonStore } from "@/store/daemonSlice";

const NETWORK_ERROR_RE =
  /Network request failed|Failed to fetch|Load failed|fetch failed|timed out|timeout|ECONN|ENOTFOUND|ETIMEDOUT|UnknownHost|Unable to resolve host|Could not connect|Connection refused|network|aborted/i;

/** True when an error message reads as "the Mac wasn't reachable" — the only
 *  class of failure that should enqueue for retry. Never matches "Cancelled",
 *  subscription copy, or an HTTP status the daemon actually returned. */
export function isNetworkError(message: string | null | undefined): boolean {
  const msg = (message ?? "").trim();
  if (!msg) return false;
  if (msg === "Cancelled") return false;
  return NETWORK_ERROR_RE.test(msg);
}

export interface PostRunArgs {
  url: string;
  token: string;
  /** Raw note text — framed here exactly as useDispatch frames it. */
  prompt: string;
  cwd?: string;
  sessionId?: string;
  noteId?: string;
  noteTitle?: string;
  pushToken?: string;
  installId: string;
  signal?: AbortSignal;
}

export type PostRunResult =
  | { status: "accepted" }
  | { status: "network" }
  | { status: "revoked" }
  | { status: "rejected"; message: string };

export async function postRunToDaemon(
  args: PostRunArgs,
): Promise<PostRunResult> {
  const built = buildPrompt(args.prompt, {
    followUp: Boolean(args.sessionId),
    sessionId: args.sessionId,
  });
  const target = `${args.url.replace(/\/$/, "")}/run?t=${encodeURIComponent(
    args.token,
  )}`;
  try {
    const res = await expoFetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: built.prompt,
        displayPrompt: args.prompt,
        cwd: args.cwd ?? undefined,
        sessionId: args.sessionId,
        pushToken: args.pushToken || undefined,
        installId: args.installId,
        noteId: args.noteId,
        noteTitle: args.noteTitle,
      }),
      signal: args.signal,
    });

    if (res.status === 403) {
      let revoked = false;
      try {
        revoked = (await res.text()).includes("revoked");
      } catch {
        revoked = false;
      }
      if (revoked) {
        useDaemonStore.getState().clear();
        return { status: "revoked" };
      }
      return { status: "rejected", message: "Forbidden" };
    }

    if (!res.ok) {
      return {
        status: "rejected",
        message: `Daemon returned ${res.status} ${res.statusText || ""}`.trim(),
      };
    }

    // Accepted — the daemon owns the run now. Release the stream; we hydrate
    // the result later via catch-up rather than reading it here.
    try {
      await res.body?.cancel();
    } catch {
      // best-effort — the run is already accepted server-side
    }
    return { status: "accepted" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isNetworkError(message)) return { status: "network" };
    return { status: "rejected", message };
  }
}
