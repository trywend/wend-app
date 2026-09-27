/**
 * Wend — artifacts library cache. Persists the last library payload so the
 * Artifacts screen renders instantly, then refreshes in the background.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { zustandStorage } from "@/store/storage";
import { libraryKey, type LibraryArtifact } from "@/lib/artifacts/api";

interface ArtifactsCacheState {
  list: LibraryArtifact[];
  storedBytes: number;
  syncedAt: number | null;
  setLibrary(list: LibraryArtifact[], storedBytes: number): void;
  remove(runId: string, id: string): void;
}

export const useArtifactsCache = create<ArtifactsCacheState>()(
  persist(
    (set) => ({
      list: [],
      storedBytes: 0,
      syncedAt: null,
      setLibrary: (list, storedBytes) =>
        set({ list, storedBytes, syncedAt: Date.now() }),
      remove: (runId, id) =>
        set((s) => ({
          list: s.list.filter((a) => libraryKey(a) !== libraryKey({ runId, id })),
        })),
    }),
    {
      name: "wend:artifacts-cache",
      storage: createJSONStorage(() => zustandStorage),
    },
  ),
);
