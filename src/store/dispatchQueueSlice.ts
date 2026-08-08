/**
 * Wend — phone-side durable dispatch queue (zustand, persisted via AsyncStorage).
 *
 * When a Mac dispatch can't land (Mac asleep / offline / unreachable) the note
 * is parked here instead of vanishing behind a one-shot error. The retry driver
 * (`useDispatchQueue`) flushes the queue the moment the daemon is reachable
 * again and on every foreground, so "write and forget" holds even when the Mac
 * is down. Only unreachability enqueues — subscription gates and other app-level
 * rejections never do.
 *
 * Persistence shape (versioned): { items: QueuedDispatch[] }. Same AsyncStorage
 * adapter as cloudSlice / notificationsSlice.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import * as Crypto from "expo-crypto";

import { zustandStorage } from "./storage";

export interface QueuedDispatch {
  /** Stable queue-item id — the dedupe key the in-flight guard tracks. */
  id: string;
  noteId: string;
  /** The RAW note text (not the framed prompt). Re-framed at fire time. */
  prompt: string;
  cwd?: string;
  sessionId?: string;
  noteTitle?: string;
  createdAt: number;
  /** Failed flush attempts so far. 0 = never tried. */
  attempts: number;
  /** ms epoch of the last flush attempt, for backoff. */
  lastAttemptAt?: number;
}

/** Stop retrying after this many failures — the item stays in the queue (so the
 *  "queued" pill persists and the user knows it's parked) but the driver stops
 *  hammering a Mac that clearly isn't coming back this session. */
export const MAX_QUEUE_ATTEMPTS = 6;

/** Backoff between retries, indexed by attempt count. First retry is immediate. */
const BACKOFF_MS = [0, 5_000, 15_000, 30_000, 60_000, 120_000];

export function backoffFor(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)]!;
}

/** Items eligible to fire right now: under the attempt cap and past their
 *  backoff window. Pure — the driver calls this against the live store. */
export function selectDueItems(
  items: QueuedDispatch[],
  now: number,
): QueuedDispatch[] {
  return items.filter((it) => {
    if (it.attempts >= MAX_QUEUE_ATTEMPTS) return false;
    const since = now - (it.lastAttemptAt ?? 0);
    return since >= backoffFor(it.attempts);
  });
}

interface DispatchQueueState {
  items: QueuedDispatch[];
  /** Park a dispatch. No-op if an identical pending item (same note + prompt +
   *  session) is already queued — a repeated failed send never stacks twins. */
  enqueue: (
    item: Pick<
      QueuedDispatch,
      "noteId" | "prompt" | "cwd" | "sessionId" | "noteTitle"
    >,
  ) => void;
  remove: (id: string) => void;
  /** Record a failed attempt: bump the counter and stamp the time for backoff. */
  markAttempt: (id: string) => void;
  removeForNote: (noteId: string) => void;
  clear: () => void;
}

export const useDispatchQueueStore = create<DispatchQueueState>()(
  persist(
    (set) => ({
      items: [],
      enqueue: (item) =>
        set((s) => {
          const dup = s.items.some(
            (it) =>
              it.noteId === item.noteId &&
              it.prompt.trim() === item.prompt.trim() &&
              (it.sessionId ?? "") === (item.sessionId ?? ""),
          );
          if (dup) return s;
          return {
            items: [
              ...s.items,
              {
                ...item,
                id: Crypto.randomUUID(),
                createdAt: Date.now(),
                attempts: 0,
              },
            ],
          };
        }),
      remove: (id) =>
        set((s) => ({ items: s.items.filter((it) => it.id !== id) })),
      markAttempt: (id) =>
        set((s) => ({
          items: s.items.map((it) =>
            it.id === id
              ? { ...it, attempts: it.attempts + 1, lastAttemptAt: Date.now() }
              : it,
          ),
        })),
      removeForNote: (noteId) =>
        set((s) => ({ items: s.items.filter((it) => it.noteId !== noteId) })),
      clear: () => set({ items: [] }),
    }),
    {
      name: "wend.dispatchQueue.v1",
      storage: createJSONStorage(() => zustandStorage),
    },
  ),
);

/** True when a note has a dispatch parked in the queue — drives the "Queued"
 *  pill on the note screen and the inbox row. */
export function useIsNoteQueued(noteId: string | null | undefined): boolean {
  return useDispatchQueueStore((s) =>
    noteId ? s.items.some((it) => it.noteId === noteId) : false,
  );
}
