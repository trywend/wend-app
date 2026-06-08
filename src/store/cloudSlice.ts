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

export type DispatchMode = "mac" | "cloud";

export interface CloudState {
  /** Where a Send should route by default. The mode is user-chosen in
   *  onboarding and toggleable later in Settings. Picking "mac" with no
   *  paired daemon will silently fall through to cloud when cloud is
   *  configured (Anthropic + GitHub both set). No other auto-fallback. */
  dispatchMode: DispatchMode;
  anthropicConnected: boolean;
  githubConnected: boolean;
  githubLogin: string | null;
  githubInstallationId: number | null;
  defaultRepo: string;
  defaultRef: string;
  lastSyncedAt: number | null;

  setDispatchMode(mode: DispatchMode): void;
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
      dispatchMode: "mac",
      anthropicConnected: false,
      githubConnected: false,
      githubLogin: null,
      githubInstallationId: null,
      defaultRepo: "",
      defaultRef: "main",
      lastSyncedAt: null,

      setDispatchMode: (mode) => set({ dispatchMode: mode }),
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
          dispatchMode: "mac",
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
  return s.anthropicConnected && s.githubConnected;
}

/** What the next dispatch should actually use given the mode + connection
 *  state. Returns "cloud" when mode is cloud OR mode is mac with no Mac
 *  paired and cloud fully configured. Returns "mac" otherwise.
 *  Callers handle the "neither configured" case at the call site. */
export function effectiveDispatchTarget(
  s: CloudState,
  args: { macPaired: boolean },
): DispatchMode {
  if (s.dispatchMode === "cloud") return "cloud";
  if (!args.macPaired && isCloudReady(s)) return "cloud";
  return "mac";
}
