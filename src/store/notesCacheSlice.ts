/**
 * Wend — notes-cache slice.
 *
 * A tiny zustand store that holds a single integer: `version`. Every
 * mutation (create / archive / delete / append-run / save-draft) calls
 * `bumpNotesVersion()` which increments it. Every `useNotesList()`
 * subscribes to `version` and re-fetches when it changes.
 *
 * Why this instead of a proper shared-cache like TanStack Query: we
 * already have multiple `useNotesList()` instances mounted at the same
 * time (the home screen + the InboxSheet mounted within it). Each had
 * its own local state, so a `refresh()` call on one didn't update the
 * other — leading to the "I deleted a note and it's still in the
 * inbox until I close+reopen" bug.
 *
 * A 4-line zustand store is the smallest fix that solves the symptom
 * without dragging in a real cache. When the storage layer gets a
 * server-sync replacement (Phase 4), this slice goes away and
 * useNotesList subscribes directly to the sync stream.
 */
import { create } from "zustand";

interface NotesCacheState {
  /** Monotonic counter — re-derived list state on every change. Starts
   *  at 1 so the initial mount of useNotesList fires its refresh effect
   *  (the dep changes from undefined → 1 on first render). */
  version: number;
  bump: () => void;
}

export const useNotesCache = create<NotesCacheState>((set) => ({
  version: 1,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));

/** Convenience export — call from any mutation entry point. */
export function bumpNotesVersion() {
  useNotesCache.getState().bump();
}
