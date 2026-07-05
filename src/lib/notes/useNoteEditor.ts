/**
 * Wend — useNoteEditor hook.
 *
 * Editor-screen-facing wrapper around `src/lib/notes-storage.ts`. Owns:
 *   - resolving / creating the draft note on mount
 *   - the in-memory title + body state + the chronological `runs` array
 *   - 400ms debounced persistence on every keystroke / run mutation
 *   - dirty / lastSavedAt bookkeeping
 *   - a final flush on unmount so an in-flight debounce isn't lost when
 *     the user navigates away
 *
 * The multi-block editor model:
 *   - `body` is the user's free text BEFORE the first run.
 *   - `runs[i].response` is Claude's readonly streamed answer for run i.
 *   - `runs[i].followUp` is the free text the user types AFTER run i. That
 *     follow-up becomes the prompt for run i+1.
 *
 * userId is read from `useAuthStore` (`src/store/authSlice.ts`). If the
 * user isn't authed yet, the hook stays in `isLoading: true` until they
 * are — the route gate should prevent this screen from rendering for an
 * anon user, but we guard anyway.
 *
 * Server sync (future): swap the inner saveNote() call for an optimistic
 * fetch with rollback. The hook contract (title/body/runs/setters/
 * isDirty/lastSavedAt) is independent of where persistence lands.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/store/authSlice";
import { useNotesCache } from "@/store/notesCacheSlice";
import {
  getNote,
  loadOrCreateDraftNote,
  saveNote,
  type PersistedRun,
} from "@/lib/notes-storage";

const DEBOUNCE_MS = 400;

export interface UseNoteEditorResult {
  title: string;
  body: string;
  runs: PersistedRun[];
  /** Per-note dispatch CWD. Null falls back to EXPO_PUBLIC_DAEMON_CWD. */
  cwd: string | null;
  setTitle: (s: string) => void;
  setBody: (s: string) => void;
  /** Set this note's dispatch target. Pass null to clear (use env default). */
  setCwd: (cwd: string | null) => void;
  /** Append a completed run to the chronological history. */
  appendRun: (run: PersistedRun) => void;
  /** Update the follow-up text typed under the run at index `idx`. */
  updateRunFollowUp: (idx: number, text: string) => void;
  /** Drop the run at index `idx` from history — used by Retry so the
   *  re-dispatch replaces the failed run instead of stacking a new one. */
  removeRun: (idx: number) => void;
  isLoading: boolean;
  isDirty: boolean;
  lastSavedAt: number | null;
  /** Empty string until the load completes. */
  noteId: string;
}

export function useNoteEditor(noteId?: string): UseNoteEditorResult {
  const userId = useAuthStore((s) => s.user?.id);

  const [resolvedId, setResolvedId] = useState<string>("");
  const [title, setTitleState] = useState<string>("");
  const [body, setBodyState] = useState<string>("");
  const [runs, setRunsState] = useState<PersistedRun[]>([]);
  const [cwd, setCwdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // Tracks the *latest* values the user has typed. The debounced flush
  // reads these refs rather than capturing stale state in its closure.
  const titleRef = useRef<string>("");
  const bodyRef = useRef<string>("");
  const runsRef = useRef<PersistedRun[]>([]);
  const cwdRef = useRef<string | null>(null);
  const idRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks which fields have been touched since the last successful save —
  // we only send fields that actually changed to saveNote().
  const pendingTitleRef = useRef<boolean>(false);
  const pendingBodyRef = useRef<boolean>(false);
  const pendingRunsRef = useRef<boolean>(false);
  const pendingCwdRef = useRef<boolean>(false);
  // Prevents the unmount flush from running before initial load completes.
  const loadedRef = useRef<boolean>(false);

  /* ------------------------------------------------------------------- */
  /* Initial load                                                         */
  /* ------------------------------------------------------------------- */
  useEffect(() => {
    if (!userId) {
      // Not authed yet — stay in loading state. The route gate should
      // prevent this screen from rendering for anon users, but a defensive
      // wait here means we never call loadOrCreateDraftNote with an
      // undefined userId.
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    (async () => {
      try {
        if (noteId) {
          const result = await getNote(noteId);
          if (cancelled) return;
          if (result) {
            setResolvedId(result.note.id);
            setTitleState(result.note.title);
            setBodyState(result.bodyText);
            setRunsState(result.runs);
            setCwdState(result.note.cwd);
            titleRef.current = result.note.title;
            bodyRef.current = result.bodyText;
            runsRef.current = result.runs;
            cwdRef.current = result.note.cwd;
            idRef.current = result.note.id;
            setLastSavedAt(result.note.updatedAt);
          } else {
            // ID was passed but the note no longer exists — fall back to
            // creating/loading the draft. Keeps the editor usable rather
            // than wedged on a missing note.
            const fallback = await loadOrCreateDraftNote(userId);
            if (cancelled) return;
            setResolvedId(fallback.note.id);
            setTitleState(fallback.note.title);
            setBodyState(fallback.bodyText);
            setRunsState(fallback.runs);
            setCwdState(fallback.note.cwd);
            titleRef.current = fallback.note.title;
            bodyRef.current = fallback.bodyText;
            runsRef.current = fallback.runs;
            cwdRef.current = fallback.note.cwd;
            idRef.current = fallback.note.id;
            setLastSavedAt(fallback.note.updatedAt);
          }
        } else {
          const { note, bodyText, runs: loadedRuns } =
            await loadOrCreateDraftNote(userId);
          if (cancelled) return;
          setResolvedId(note.id);
          setTitleState(note.title);
          setBodyState(bodyText);
          setRunsState(loadedRuns);
          setCwdState(note.cwd);
          titleRef.current = note.title;
          bodyRef.current = bodyText;
          runsRef.current = loadedRuns;
          cwdRef.current = note.cwd;
          idRef.current = note.id;
          setLastSavedAt(note.updatedAt);
        }
      } catch (err) {
        console.warn("[useNoteEditor] load failed:", err);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          loadedRef.current = true;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, noteId]);

  // A background hydration (Mac/cloud catch-up) can merge runs into storage
  // for the note that's already open. The load effect above only reads on
  // mount, so without this the editor keeps its stale in-memory runs (and a
  // later flush would clobber the merged ones back out). On a cache bump,
  // re-read and APPEND any runs we don't have yet — never remove, never
  // touch title/body — so hydrated results appear without losing edits.
  const notesVersion = useNotesCache((s) => s.version);
  useEffect(() => {
    if (!loadedRef.current) return;
    const id = idRef.current;
    if (!id) return;
    let cancelled = false;
    void (async () => {
      const result = await getNote(id);
      if (cancelled || !result) return;
      const known = new Set(runsRef.current.map((r) => r.id));
      const added = result.runs.filter((r) => !known.has(r.id));
      if (added.length === 0) return;
      const merged = [...runsRef.current, ...added].sort(
        (a, b) => a.createdAt - b.createdAt,
      );
      runsRef.current = merged;
      setRunsState(merged);
    })();
    return () => {
      cancelled = true;
    };
  }, [notesVersion]);

  /* ------------------------------------------------------------------- */
  /* Debounced flush                                                      */
  /* ------------------------------------------------------------------- */
  const flush = useCallback(async () => {
    if (!loadedRef.current) return;
    const id = idRef.current;
    if (!id) return;

    const payload: {
      id: string;
      title?: string;
      bodyText?: string;
      runs?: PersistedRun[];
      cwd?: string | null;
    } = { id };
    if (pendingTitleRef.current) payload.title = titleRef.current;
    if (pendingBodyRef.current) payload.bodyText = bodyRef.current;
    if (pendingRunsRef.current) payload.runs = runsRef.current;
    if (pendingCwdRef.current) payload.cwd = cwdRef.current;

    if (
      payload.title === undefined &&
      payload.bodyText === undefined &&
      payload.runs === undefined &&
      payload.cwd === undefined
    )
      return;

    pendingTitleRef.current = false;
    pendingBodyRef.current = false;
    pendingRunsRef.current = false;
    pendingCwdRef.current = false;

    try {
      await saveNote(payload);
      setLastSavedAt(Date.now());
      setIsDirty(false);
    } catch (err) {
      console.warn("[useNoteEditor] save failed:", err);
      // Re-mark fields dirty so the next keystroke re-tries the save.
      if (payload.title !== undefined) pendingTitleRef.current = true;
      if (payload.bodyText !== undefined) pendingBodyRef.current = true;
      if (payload.runs !== undefined) pendingRunsRef.current = true;
      if (payload.cwd !== undefined) pendingCwdRef.current = true;
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, DEBOUNCE_MS);
  }, [flush]);

  /* ------------------------------------------------------------------- */
  /* Setters                                                              */
  /* ------------------------------------------------------------------- */
  const setTitle = useCallback(
    (s: string) => {
      titleRef.current = s;
      pendingTitleRef.current = true;
      setTitleState(s);
      setIsDirty(true);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const setBody = useCallback(
    (s: string) => {
      bodyRef.current = s;
      pendingBodyRef.current = true;
      setBodyState(s);
      setIsDirty(true);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const appendRun = useCallback(
    (run: PersistedRun) => {
      const next = [...runsRef.current, run];
      runsRef.current = next;
      pendingRunsRef.current = true;
      setRunsState(next);
      setIsDirty(true);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const setCwd = useCallback(
    (next: string | null) => {
      const trimmed = next === null ? null : next.trim() || null;
      cwdRef.current = trimmed;
      pendingCwdRef.current = true;
      setCwdState(trimmed);
      setIsDirty(true);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const updateRunFollowUp = useCallback(
    (idx: number, text: string) => {
      const current = runsRef.current;
      if (idx < 0 || idx >= current.length) return;
      const next = current.slice();
      next[idx] = { ...current[idx]!, followUp: text };
      runsRef.current = next;
      pendingRunsRef.current = true;
      setRunsState(next);
      setIsDirty(true);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const removeRun = useCallback(
    (idx: number) => {
      const current = runsRef.current;
      if (idx < 0 || idx >= current.length) return;
      const next = current.slice();
      next.splice(idx, 1);
      runsRef.current = next;
      pendingRunsRef.current = true;
      setRunsState(next);
      setIsDirty(true);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  /* ------------------------------------------------------------------- */
  /* Unmount — final flush so in-flight debounce isn't lost.              */
  /* ------------------------------------------------------------------- */
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // Fire-and-forget. If the user navigated away mid-keystroke, this
      // ensures the latest values land in AsyncStorage. We don't await —
      // the component is unmounting.
      if (
        pendingTitleRef.current ||
        pendingBodyRef.current ||
        pendingRunsRef.current ||
        pendingCwdRef.current
      ) {
        void flush();
      }
    };
  }, [flush]);

  return {
    title,
    body,
    runs,
    cwd,
    setTitle,
    setBody,
    setCwd,
    appendRun,
    updateRunFollowUp,
    removeRun,
    isLoading,
    isDirty,
    lastSavedAt,
    noteId: resolvedId,
  };
}
