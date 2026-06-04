/**
 * Wend — push notifications store (zustand, persisted via AsyncStorage).
 *
 * Tracks which Expo push token we've registered for which userId so the
 * client doesn't re-POST `/api/notifications/register` on every cold
 * launch. The backend treats register as an idempotent upsert so a
 * redundant call is harmless — this is purely a roundtrip-saving cache.
 *
 * Persistence shape (versioned):
 *   {
 *     userId: string,          // Clerk user id we last registered for
 *     token: string,           // ExponentPushToken[…]
 *     lastRegisteredAt: number // ms epoch — debug-only, helps diagnose
 *     pendingToken: string     // token we have but couldn't POST yet
 *                              // (no JWT available — replays on next sign-in)
 *   }
 *
 * If either userId or token changes between calls (re-sign-in as a
 * different user, token rotation), `ensurePushNotificationsRegistered`
 * notices the mismatch and POSTs again.
 *
 * Follows the same persistence pattern as `daemonSlice.ts` — see that
 * file for the rationale around AsyncStorage vs. MMKV.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { zustandStorage } from "./storage";

interface NotificationsState {
  /** Clerk user id we last successfully registered a token for. Empty
   *  before the first registration. */
  userId: string;
  /** Currently-registered Expo push token. Empty before first reg. */
  token: string;
  /** Last successful register HTTP 2xx, ms epoch. 0 before first. */
  lastRegisteredAt: number;
  /** Token fetched locally that we couldn't POST to the backend (no
   *  JWT, or network blip). The bootstrap will retry on next call. */
  pendingToken: string;

  /** Mark a token as successfully registered for a user. Clears pending. */
  markRegistered: (userId: string, token: string) => void;
  /** Stash a token that we couldn't post yet. */
  setPendingToken: (token: string) => void;
  /** Wipe everything (sign-out path). */
  clear: () => void;
}

export const useNotificationsStore = create<NotificationsState>()(
  persist(
    (set) => ({
      userId: "",
      token: "",
      lastRegisteredAt: 0,
      pendingToken: "",
      markRegistered: (userId, token) =>
        set({
          userId,
          token,
          lastRegisteredAt: Date.now(),
          pendingToken: "",
        }),
      setPendingToken: (token) => set({ pendingToken: token }),
      clear: () =>
        set({
          userId: "",
          token: "",
          lastRegisteredAt: 0,
          pendingToken: "",
        }),
    }),
    {
      name: "wend.notifications.v1",
      storage: createJSONStorage(() => zustandStorage),
    },
  ),
);
