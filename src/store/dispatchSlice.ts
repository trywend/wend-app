/**
 * Wend — dispatch store slice (zustand).
 *
 * In-memory pubsub for the currently-streaming note id. The inbox cross-
 * references this against persisted note state to render the "running" pip,
 * which `useNotesList` can't infer on its own (storage only holds completed
 * runs). Cleared by `useDispatch` in its finally block.
 */
import { create } from "zustand";

interface DispatchState {
  /** The id of the note currently streaming a response, if any. */
  runningNoteId: string | null;
  setRunningNoteId: (id: string | null) => void;
}

export const useDispatchStore = create<DispatchState>((set) => ({
  runningNoteId: null,
  setRunningNoteId: (runningNoteId) => set({ runningNoteId }),
}));
