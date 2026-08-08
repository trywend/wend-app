/**
 * Wend — sessions cache slice.
 *
 * Persists the last sessions list and a bounded set of recently-opened
 * transcripts so the Sessions tab and each conversation open render from
 * cache instantly, then refresh in the background (stale-while-revalidate).
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { zustandStorage } from "@/store/storage";
import type { SessionSummary, SessionDetail } from "@/lib/sessions/api";

const TRANSCRIPT_CAP = 8;

interface CachedTranscript {
  detail: SessionDetail;
  syncedAt: number;
}

interface SessionsCacheState {
  list: SessionSummary[];
  listSyncedAt: number | null;
  transcripts: Record<string, CachedTranscript>;
  setList(sessions: SessionSummary[]): void;
  setTranscript(id: string, detail: SessionDetail): void;
}

export const useSessionsCache = create<SessionsCacheState>()(
  persist(
    (set) => ({
      list: [],
      listSyncedAt: null,
      transcripts: {},
      setList: (sessions) => set({ list: sessions, listSyncedAt: Date.now() }),
      setTranscript: (id, detail) =>
        set((s) => {
          const next: Record<string, CachedTranscript> = {
            ...s.transcripts,
            [id]: { detail, syncedAt: Date.now() },
          };
          const ids = Object.keys(next);
          if (ids.length > TRANSCRIPT_CAP) {
            ids
              .sort((a, b) => next[a].syncedAt - next[b].syncedAt)
              .slice(0, ids.length - TRANSCRIPT_CAP)
              .forEach((stale) => delete next[stale]);
          }
          return { transcripts: next };
        }),
    }),
    {
      name: "wend:sessions-cache",
      storage: createJSONStorage(() => zustandStorage),
    },
  ),
);

export function cachedTranscript(id: string): SessionDetail | null {
  return useSessionsCache.getState().transcripts[id]?.detail ?? null;
}
