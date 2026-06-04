/**
 * Wend — onboarding state.
 *
 * Tracks the "have we walked this user through pair-your-Mac yet?"
 * question. Distinct from auth: a user signs in, lands on onboarding,
 * pairs (or skips), then enters the notes app.
 *
 * The flow:
 *
 *   Anon            → /(auth)/sign-in
 *   Authed + !paired + !skipped → /(app)/onboarding
 *   Authed + (paired | skipped) → /(app)         (notes home)
 *
 * Persisted so we don't replay onboarding on every app launch — only
 * after sign-out (which calls `reset()` to clear it).
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { zustandStorage } from "./storage";

interface OnboardingState {
  /** True once the user explicitly tapped "I'll do this later" on the
   *  pair-Mac step. Lets us send them to the notes app without
   *  re-prompting. Cleared on sign-out so the next user starts fresh. */
  pairSkipped: boolean;
  /** ms epoch when onboarding was first shown — used for telemetry
   *  ("time to first pair") later. */
  firstShownAt: number;

  markFirstShown: () => void;
  skipPairing: () => void;
  /** Wipe everything. Call this on sign-out. */
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      pairSkipped: false,
      firstShownAt: 0,
      markFirstShown: () =>
        set((s) => (s.firstShownAt > 0 ? s : { firstShownAt: Date.now() })),
      skipPairing: () => set({ pairSkipped: true }),
      reset: () =>
        set({
          pairSkipped: false,
          firstShownAt: 0,
        }),
    }),
    {
      name: "wend.onboarding.v1",
      storage: createJSONStorage(() => zustandStorage),
    },
  ),
);
