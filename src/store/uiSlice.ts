/**
 * Wend — UI store slice (zustand, persisted).
 *
 * Holds app-chrome state that should survive relaunch. Phase 1 only carries the
 * theme preference (Design Doc decision #10 — default System). Later phases add
 * things like last-active-filter, coachmark-seen flags, etc.
 *
 * Persisted via the storage adapter (AsyncStorage now, MMKV later).
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { zustandStorage } from "./storage";

export type ThemePreference = "system" | "light" | "dark";

interface UiState {
  themePreference: ThemePreference;
  setThemePreference: (p: ThemePreference) => void;
  /** Visual-only toggle in Settings → Preferences → Notifications. No real
   * notification plumbing yet; this just persists the switch state. */
  notificationsEnabled: boolean;
  setNotificationsEnabled: (v: boolean) => void;
  /** Visual-only toggle in Integrations → Linear. Persisted so the switch
   * survives relaunch; no actual workspace connection yet. */
  linearConnected: boolean;
  setLinearConnected: (v: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      // Default LIGHT. Every screen design handed over is the warm Paper &
      // Ember light treatment, so the app leads light. Dark variants come when
      // we design them per-screen + ship the appearance toggle (S26). Overrides
      // the Design Doc's earlier "system default" call for now.
      themePreference: "light",
      setThemePreference: (themePreference) => set({ themePreference }),
      notificationsEnabled: false,
      setNotificationsEnabled: (notificationsEnabled) =>
        set({ notificationsEnabled }),
      linearConnected: false,
      setLinearConnected: (linearConnected) => set({ linearConnected }),
    }),
    {
      // Bumped key — old "wend.ui" persisted "system" on first launch and would
      // rehydrate over the new default. v2 forces a clean light default.
      name: "wend.ui.v2",
      storage: createJSONStorage(() => zustandStorage),
    },
  ),
);
