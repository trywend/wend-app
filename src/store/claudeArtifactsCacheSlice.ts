/**
 * Wend — claude.ai artifacts cache. Persists the last list the Mac returned
 * plus which Artifacts segment the user last had open.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { zustandStorage } from "@/store/storage";
import type { ClaudeArtifact } from "@/lib/artifacts/claudeApi";

export type ArtifactsSegment = "deliverables" | "claude";

interface ClaudeArtifactsCacheState {
  list: ClaudeArtifact[];
  /** When the Mac last pulled the list from claude.ai. */
  fetchedAt: number | null;
  syncedAt: number | null;
  segment: ArtifactsSegment;
  setList(list: ClaudeArtifact[], fetchedAt: number | null): void;
  setSegment(segment: ArtifactsSegment): void;
}

export const useClaudeArtifactsCache = create<ClaudeArtifactsCacheState>()(
  persist(
    (set) => ({
      list: [],
      fetchedAt: null,
      syncedAt: null,
      segment: "deliverables",
      setList: (list, fetchedAt) => set({ list, fetchedAt, syncedAt: Date.now() }),
      setSegment: (segment) => set({ segment }),
    }),
    {
      name: "wend:claude-artifacts-cache",
      storage: createJSONStorage(() => zustandStorage),
    },
  ),
);
