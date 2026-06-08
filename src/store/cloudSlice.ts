/**
 * Wend Cloud connection state.
 *
 * Mirrors what the user has connected on the Tempus side: their
 * Anthropic API key (we never store the actual key on the phone after
 * upload; we just track whether one has been registered server-side)
 * and their GitHub App installation. Plus a chosen default repo for
 * cloud dispatches.
 *
 * The source of truth is Clerk's private_metadata, mediated by
 * Tempus. The phone caches the last known state to avoid a network
 * round-trip on every screen render. Refreshed via SettingsSheet on
 * mount and after each connect/disconnect action.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface CloudState {
  anthropicConnected: boolean;
  githubConnected: boolean;
  githubLogin: string | null;
  githubInstallationId: number | null;
  defaultRepo: string;
  defaultRef: string;
  lastSyncedAt: number | null;

  setAnthropic(connected: boolean): void;
  setGithub(args: {
    installed: boolean;
    login: string | null;
    installationId: number | null;
  }): void;
  setDefaultRepo(repo: string, ref?: string): void;
  reset(): void;
}

export const useCloudStore = create<CloudState>()(
  persist(
    (set) => ({
      anthropicConnected: false,
      githubConnected: false,
      githubLogin: null,
      githubInstallationId: null,
      defaultRepo: "",
      defaultRef: "main",
      lastSyncedAt: null,

      setAnthropic: (connected) =>
        set({ anthropicConnected: connected, lastSyncedAt: Date.now() }),
      setGithub: ({ installed, login, installationId }) =>
        set({
          githubConnected: installed,
          githubLogin: login,
          githubInstallationId: installationId,
          lastSyncedAt: Date.now(),
        }),
      setDefaultRepo: (repo, ref) =>
        set((s) => ({ defaultRepo: repo, defaultRef: ref ?? s.defaultRef })),
      reset: () =>
        set({
          anthropicConnected: false,
          githubConnected: false,
          githubLogin: null,
          githubInstallationId: null,
          defaultRepo: "",
          defaultRef: "main",
          lastSyncedAt: null,
        }),
    }),
    {
      name: "wend:cloud",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

export function isCloudReady(s: CloudState): boolean {
  return s.anthropicConnected && s.githubConnected && s.defaultRepo.length > 0;
}
