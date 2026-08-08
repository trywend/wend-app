/**
 * Wend — durable dispatch queue retry driver.
 *
 * Mount once (in the home screen). Flushes the persisted queue whenever the
 * Mac becomes reachable (useResolvedDaemonURL.isReady flips true), on AppState
 * 'active', and when a new item is parked. Bounded concurrency, deduped so a
 * queued item never double-fires:
 *
 *   - an in-flight Set keyed by item id gates re-entry while a POST is open;
 *   - a runs-match guard drops an item whose exact prompt already recorded a
 *     run on the note (it landed via another path / hydrated from the Mac).
 *
 * Accepted → removed from the queue; the result hydrates via the existing
 * catch-up. Network failure → attempt bumped + backed off. App-level rejection
 * or revoked pairing → removed (retrying won't help).
 */
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

import { getNote } from "@/lib/notes-storage";
import { bumpNotesVersion } from "@/store/notesCacheSlice";
import { useResolvedDaemonURL } from "@/lib/dispatch/useResolvedDaemonURL";
import { useNotificationsStore } from "@/store/notificationsSlice";
import { getInstallId } from "@/lib/installId";
import { postRunToDaemon } from "@/lib/dispatch/postRun";
import {
  selectDueItems,
  useDispatchQueueStore,
  type QueuedDispatch,
} from "@/store/dispatchQueueSlice";

const MAX_CONCURRENCY = 2;

export function useDispatchQueue(): void {
  const resolved = useResolvedDaemonURL();
  const pushToken = useNotificationsStore((s) => s.token);
  const itemCount = useDispatchQueueStore((s) => s.items.length);

  const inFlight = useRef<Set<string>>(new Set());
  const flushing = useRef(false);

  const fireOne = useCallback(
    async (item: QueuedDispatch, url: string, token: string) => {
      inFlight.current.add(item.id);
      const store = useDispatchQueueStore.getState();
      try {
        // Runs-match guard: if this note already recorded a run with this exact
        // prompt, the dispatch landed some other way — drop it, never re-fire.
        const local = await getNote(item.noteId);
        if (
          local &&
          local.runs.some((r) => r.prompt.trim() === item.prompt.trim())
        ) {
          store.remove(item.id);
          return;
        }

        const installId = await getInstallId();
        const result = await postRunToDaemon({
          url,
          token,
          prompt: item.prompt,
          cwd: item.cwd,
          sessionId: item.sessionId,
          noteId: item.noteId,
          noteTitle: item.noteTitle,
          pushToken: pushToken || undefined,
          installId,
        });

        if (result.status === "accepted") {
          store.remove(item.id);
          bumpNotesVersion();
        } else if (result.status === "network") {
          store.markAttempt(item.id);
        } else {
          // revoked (pairing cleared) or app-level rejection — won't succeed.
          store.remove(item.id);
        }
      } finally {
        inFlight.current.delete(item.id);
      }
    },
    [pushToken],
  );

  const flush = useCallback(async () => {
    if (flushing.current) return;
    if (!resolved.isReady) return;
    flushing.current = true;
    try {
      // Resolve a live URL once per flush — the tunnel may have rotated with
      // the same wake that made the Mac reachable again.
      let url = resolved.url;
      if (resolved.deviceId) {
        const fresh = await resolved.refresh().catch(() => null);
        if (fresh && fresh.length > 0) url = fresh;
      }
      const token = resolved.token;

      const due = selectDueItems(
        useDispatchQueueStore.getState().items,
        Date.now(),
      ).filter((it) => !inFlight.current.has(it.id));

      for (let i = 0; i < due.length; i += MAX_CONCURRENCY) {
        const batch = due.slice(i, i + MAX_CONCURRENCY);
        await Promise.all(batch.map((it) => fireOne(it, url, token)));
      }
    } finally {
      flushing.current = false;
    }
  }, [resolved, fireOne]);

  // Reachability flip + newly-parked items + first mount.
  useEffect(() => {
    void flush();
  }, [resolved.isReady, itemCount, flush]);

  // Foreground: a note parked while the app was backgrounded fires on return.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void flush();
    });
    return () => sub.remove();
  }, [flush]);
}
