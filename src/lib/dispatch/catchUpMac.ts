/**
 * On note open, ask the Mac daemon (GET /note/<id>) for the runs it
 * recorded while the phone was disconnected — a fire-and-forget dispatch
 * where the app was backgrounded or killed before the stream finished.
 * Any run whose id isn't already local is merged in as a PersistedRun so
 * the user sees the result they were pushed about, instead of an empty
 * note that then re-fires.
 *
 * Mirror of catchUp.ts (which does the same against the cloud/Tempus).
 * Safe to call on every mount; no-ops when the daemon URL isn't ready.
 */
import {
  getNote,
  listNotes,
  saveNote,
  type PersistedRun,
} from "@/lib/notes-storage";
import { bumpNotesVersion } from "@/store/notesCacheSlice";

interface MacRun {
  id: string;
  prompt: string;
  response: string;
  sessionId?: string | null;
  status: "done" | "error";
  durationMs: number;
  costUsd?: number;
  toolUses: string[];
  createdAt: number;
}

export async function catchUpMacRunsForNote(args: {
  noteId: string;
  url: string;
  token: string;
}): Promise<number> {
  const { noteId, url, token } = args;
  if (!noteId || !url || !token) return 0;

  const local = await getNote(noteId);
  if (!local) return 0;
  const knownIds = new Set(local.runs.map((r) => r.id));

  let remote: { runs?: MacRun[] };
  try {
    const { fetch: expoFetch } = await import("expo/fetch");
    const target = `${url.replace(/\/$/, "")}/note/${encodeURIComponent(
      noteId,
    )}?t=${encodeURIComponent(token)}`;
    const res = await expoFetch(target, { method: "GET" });
    if (!res.ok) return 0;
    remote = (await res.json()) as { runs?: MacRun[] };
  } catch {
    return 0;
  }

  const fresh = (remote.runs ?? []).filter((r) => r?.id && !knownIds.has(r.id));
  if (fresh.length === 0) return 0;

  const newRuns: PersistedRun[] = fresh.map((r) => ({
    id: r.id,
    prompt: r.prompt ?? "",
    response: r.response ?? "",
    sessionId: r.sessionId || null,
    status: r.status === "error" ? "error" : "done",
    durationMs: r.durationMs ?? 0,
    costUsd: typeof r.costUsd === "number" ? r.costUsd : 0,
    toolUses: Array.isArray(r.toolUses) ? r.toolUses : [],
    toolCalls: (Array.isArray(r.toolUses) ? r.toolUses : []).map((name) => ({
      name,
    })),
    error: r.status === "error" ? r.response ?? "" : null,
    followUp: "",
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
  }));

  const merged = [...local.runs, ...newRuns].sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  await saveNote({ id: noteId, runs: merged });
  // Bump the shared cache so an OPEN editor (which loads runs into its own
  // state on mount and won't otherwise re-read) merges the fresh runs in,
  // and the inbox reflects the new status.
  bumpNotesVersion();
  return newRuns.length;
}

/**
 * Hydrate the inbox: pull completed Mac runs for the user's recent notes
 * so a fire-and-forget result shows in the list before the note is even
 * opened. Bounded fan-out; safe to call whenever the inbox opens.
 */
export async function hydrateNotesFromMac(args: {
  userId: string;
  url: string;
  token: string;
}): Promise<number> {
  const { userId, url, token } = args;
  if (!userId || !url || !token) return 0;
  let records;
  try {
    records = await listNotes(userId);
  } catch {
    return 0;
  }
  const recent = records.slice(0, 20);
  const results = await Promise.all(
    recent.map((n) => catchUpMacRunsForNote({ noteId: n.id, url, token })),
  );
  return results.reduce((a, b) => a + b, 0);
}
