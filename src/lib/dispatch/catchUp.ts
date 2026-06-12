/**
 * On note open, ask Tempus if any cloud runs completed while the phone
 * was offline. Any returned run whose id isn't already in the local
 * runs list gets appended as a PersistedRun so the user sees the
 * result they were notified about.
 *
 * Safe to call on every mount; if cloud isn't configured or the user
 * isn't online, the call no-ops.
 */
import { getNote, saveNote, type PersistedRun } from "@/lib/notes-storage";
import { extractFilePathsFromToolCalls } from "@/lib/agentMarkdown";
import { CloudApiError } from "@/lib/wend-cloud-api";

interface CatchUpDeps {
  noteId: string;
  api: {
    isConfigured: boolean;
    listRunsForNote: (noteId: string, since?: number) => Promise<{
      runs: Array<{
        runId: string;
        noteId: string;
        createdAt: number;
        response: string;
        sessionId: string;
        status: "done" | "error";
        durationMs: number;
        costUsd: number;
        toolUses: string[];
        toolCalls?: Array<{ name: string; input?: unknown }>;
        links?: string[];
        filesChanged?: string[];
        repo: string;
        agentId: string;
      }>;
    }>;
  };
}

export async function catchUpRunsForNote({ noteId, api }: CatchUpDeps): Promise<number> {
  if (!api.isConfigured) return 0;
  const local = await getNote(noteId);
  if (!local) return 0;

  // Find the latest known createdAt across persisted runs; only ask the
  // server for runs newer than that to keep the response small.
  const knownIds = new Set(local.runs.map((r) => r.id));
  const since = local.runs.reduce(
    (max, r) => (r.createdAt > max ? r.createdAt : max),
    0,
  );

  let remote;
  try {
    remote = await api.listRunsForNote(noteId, since > 0 ? since : undefined);
  } catch (err) {
    if (err instanceof CloudApiError && err.status === 401) return 0;
    console.warn("[catchUp] failed:", err);
    return 0;
  }

  const fresh = remote.runs.filter((r) => !knownIds.has(r.runId));
  if (fresh.length === 0) return 0;

  const newRuns: PersistedRun[] = fresh.map((r) => ({
    id: r.runId,
    prompt: "",
    response: r.response,
    sessionId: r.sessionId || null,
    status: r.status,
    durationMs: r.durationMs,
    costUsd: r.costUsd,
    toolUses: r.toolUses,
    toolCalls: buildToolCalls(r),
    links: r.links?.length ? r.links : undefined,
    error: r.status === "error" ? r.response : null,
    followUp: "",
    createdAt: r.createdAt,
  }));

  // Merge into the existing body block. saveNote with a runs param
  // replaces the array, so we concat first.
  const merged = [...local.runs, ...newRuns].sort((a, b) => a.createdAt - b.createdAt);
  await saveNote({ id: noteId, runs: merged });
  return newRuns.length;
}

/** Prefer real toolCalls from the backend; fall back to name-only mapping.
 *  `filesChanged` folds into rendering as synthetic Edit calls so
 *  FileChangesSummary surfaces them without a new PersistedRun field. */
function buildToolCalls(r: {
  toolUses: string[];
  toolCalls?: Array<{ name: string; input?: unknown }>;
  filesChanged?: string[];
}): Array<{ name: string; input?: unknown }> {
  const base = r.toolCalls?.length
    ? r.toolCalls
    : r.toolUses.map((name) => ({ name }));
  const changed = r.filesChanged ?? [];
  if (changed.length === 0) return base;
  const known = new Set(extractFilePathsFromToolCalls(base));
  const synthetic = changed
    .filter((p) => typeof p === "string" && p.length > 0 && !known.has(p))
    .map((p) => ({ name: "Edit", input: { file_path: p } }));
  return synthetic.length ? [...base, ...synthetic] : base;
}
