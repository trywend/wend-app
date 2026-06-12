/**
 * Wend — useNotesList hook.
 *
 * Subscribes the inbox sheet to the persisted notes index. For each note we
 * also need its body block — that's where completed runs live (see the
 * PersistedRun comment in `notes-storage.ts`). The status computation maps:
 *
 *   - no runs at all                  → "notes"
 *   - any run with status === "done"  → "done"
 *   - "running" is intentionally never produced here. Phase 2 only persists
 *     completed runs, so there is no on-disk signal for an in-flight run.
 *     The owning screen can override the status of the currently-streaming
 *     note imperatively when it wires this hook up. A real "running" signal
 *     needs a pubsub layer (Phase 4).
 *
 * The hook is intentionally pull-based: AsyncStorage has no change-stream API,
 * so we re-fetch on mount and expose `refresh()` for callers to invoke after
 * createNote / archiveNote / etc. A future server-sync layer (Phase 4) will
 * upgrade this to a real subscription.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuthStore } from "@/store/authSlice";
import { useDispatchStore } from "@/store/dispatchSlice";
import { useNotesCache } from "@/store/notesCacheSlice";
import {
  getNote,
  listNotes,
  type PersistedRun,
} from "@/lib/notes-storage";
import { deriveTitleFromBody } from "@/lib/notes/deriveTitle";

export interface NoteListItem {
  id: string;
  /** Raw title field (may be empty). */
  title: string;
  /** UI-ready title: title if non-empty, else first non-empty body line, else
   *  "Untitled". The InboxSheet should always render this, not raw `title`,
   *  to avoid the empty-card-title look on freshly-created notes. */
  displayTitle: string;
  updatedAt: number;
  /** See file header — "running" is never produced in Phase 2. */
  status: "running" | "done" | "notes";
  lastRun?: {
    durationMs: number;
    costUsd: number;
    error: string | null;
  };
  bodyLineCount: number;
}

export interface UseNotesListResult {
  notes: NoteListItem[];
  isLoading: boolean;
  refresh: () => Promise<void>;
}

function computeItem(
  id: string,
  title: string,
  updatedAt: number,
  bodyText: string,
  runs: PersistedRun[],
): NoteListItem {
  const hasRun = runs.length > 0;
  const lastRun = hasRun ? runs[runs.length - 1]! : null;

  // Phase 2: storage only ever holds completed runs (status "done" or "error").
  // Map either to the "done" pill — the card's error treatment lives elsewhere
  // (red accent border driven by lastRun.error). No "running" branch here.
  const status: NoteListItem["status"] = hasRun ? "done" : "notes";

  // Line count for the notes-state subline. Empty body still counts as 0
  // lines (the caller should hide the "N lines" pill when 0).
  const bodyLineCount = bodyText.length === 0 ? 0 : bodyText.split("\n").length;

  // Title fallback: empty title → derived from body (markdown stripped,
  // ≤4 words, ~32 chars) → "Untitled". Avoids blank cards when the user
  // hasn't named a note yet (which is most of them in this flow).
  const displayTitle =
    title.trim() || deriveTitleFromBody(bodyText) || "Untitled";

  return {
    id,
    title,
    displayTitle,
    updatedAt,
    status,
    lastRun: lastRun
      ? {
          durationMs: lastRun.durationMs,
          costUsd: lastRun.costUsd,
          error: lastRun.error,
        }
      : undefined,
    bodyLineCount,
  };
}

export function useNotesList(): UseNotesListResult {
  const userId = useAuthStore((s) => s.user?.id);
  const runningNoteId = useDispatchStore((s) => s.runningNoteId);
  // Shared cache-version counter. Bumped by any mutation
  // (createNote / archiveNote / deleteNote / etc.) — every
  // useNotesList instance re-fetches when it changes. Closes the
  // "delete didn't update inbox until close+reopen" bug.
  const cacheVersion = useNotesCache((s) => s.version);
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Tracks the latest in-flight refresh so an older one can't overwrite the
  // results of a newer one (a sub-second create -> refresh -> create -> refresh
  // sequence is plausible).
  const reqIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!userId) {
      setNotes([]);
      setIsLoading(false);
      return;
    }

    const myReq = ++reqIdRef.current;

    try {
      const all = await listNotes(userId);
      // Pull each note's body block in parallel so we can compute status +
      // line count. AsyncStorage reads are cheap and the index is bounded by
      // the user's note count — fine to fan out.
      const detailed = await Promise.all(
        all.map(async (n) => {
          const full = await getNote(n.id);
          if (!full) {
            return computeItem(n.id, n.title, n.updatedAt, "", []);
          }
          return computeItem(
            n.id,
            full.note.title,
            full.note.updatedAt,
            full.bodyText,
            full.runs,
          );
        }),
      );

      if (myReq !== reqIdRef.current) return; // a newer refresh superseded us
      setNotes(detailed);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[useNotesList] refresh failed:", err);
      if (myReq === reqIdRef.current) setNotes([]);
    } finally {
      if (myReq === reqIdRef.current) setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setIsLoading(true);
    void refresh();
    // cacheVersion is the trigger from mutations elsewhere — adding it
    // to deps makes every instance of this hook re-fetch the moment
    // ANY note mutates, not just the one whose owner called refresh().
  }, [refresh, cacheVersion]);

  // Overlay the live "running" signal from the dispatchSlice. Storage only
  // ever holds completed runs, so without this overlay the pip never flips
  // on. We preserve the persisted status when a completed run already exists
  // for that note (the "done" pill stays meaningful even mid-stream).
  const decorated = runningNoteId
    ? notes.map((n) =>
        n.id === runningNoteId && n.status === "notes"
          ? { ...n, status: "running" as const }
          : n,
      )
    : notes;

  return { notes: decorated, isLoading, refresh };
}
