/**
 * Wend — notes store slice (zustand).
 *
 * SKELETON ONLY. The editor (Phase 2) and dispatch/streaming (Phase 4) fill
 * this in. For now it just holds the locally-cached note list and a currently
 * open note id, so the rest of the app can wire against a stable shape.
 *
 * Server state (the authoritative notes in Neon) lives in TanStack Query; this
 * slice is for client-side editor/session state and the offline-first cache
 * mirror. Not persisted yet — persistence arrives with the editor in Phase 2.
 */
import { create } from "zustand";

/** Mirrors the `notes` table row shape (src/db/schema.ts). Kept loose for now. */
export interface NoteSummary {
  id: string;
  title: string;
  updatedAt: string;
  archivedAt: string | null;
}

interface NotesState {
  notes: NoteSummary[];
  activeNoteId: string | null;
  setNotes: (notes: NoteSummary[]) => void;
  setActiveNote: (id: string | null) => void;
}

export const useNotesStore = create<NotesState>((set) => ({
  notes: [],
  activeNoteId: null,
  setNotes: (notes) => set({ notes }),
  setActiveNote: (activeNoteId) => set({ activeNoteId }),
}));
