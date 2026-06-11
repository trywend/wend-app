/**
 * Mirror of Tempus subscription state for fast UI decisions.
 *
 * Source of truth lives in Clerk private_metadata, exposed via
 * GET /v1/subscription/status. We refresh on app launch, after any
 * upgrade/downgrade action, and after every dispatch completion (so
 * usage counts stay current).
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type SubscriptionTier = "free" | "pro" | "cloud_paygo";
export type SubscriptionStatus = "active" | "past_due" | "canceled" | "none";

export interface SubscriptionState {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  cloudUsedThisMonth: number;
  cloudQuotaTotal: number;
  cloudQuotaRemaining: number;
  canPairMac: boolean;
  overageUsdPerDispatch: number;
  /** When true, the server has told us paywalls are off for this
   *  environment. The UI treats every user as Pro regardless of tier. */
  paywallsDisabled: boolean;
  lastSyncedAt: number | null;

  setStatus(args: Partial<Omit<SubscriptionState, "setStatus" | "reset">>): void;
  reset(): void;
}

/** Build-time override. When EXPO_PUBLIC_DISABLE_PAYWALLS is truthy at
 *  build time, we never gate any dispatch in the app even before the
 *  user has signed in or the server has replied. The server still has
 *  its own toggle (WEND_PAYWALLS_DISABLED) which the slice mirrors
 *  after first sync. */
export const PAYWALLS_DISABLED_BUILD = (() => {
  const v = process.env.EXPO_PUBLIC_DISABLE_PAYWALLS;
  return typeof v === "string" && /^(1|true|yes)$/i.test(v);
})();

export const useSubscriptionStore = create<SubscriptionState>()(
  persist(
    (set) => ({
      tier: PAYWALLS_DISABLED_BUILD ? "pro" : "free",
      status: "active",
      currentPeriodEnd: null,
      cloudUsedThisMonth: 0,
      cloudQuotaTotal: 0,
      cloudQuotaRemaining: 0,
      canPairMac: PAYWALLS_DISABLED_BUILD,
      overageUsdPerDispatch: 0.3,
      paywallsDisabled: PAYWALLS_DISABLED_BUILD,
      lastSyncedAt: null,

      setStatus: (args) => set({ ...args, lastSyncedAt: Date.now() }),
      reset: () =>
        set({
          tier: PAYWALLS_DISABLED_BUILD ? "pro" : "free",
          status: "active",
          currentPeriodEnd: null,
          cloudUsedThisMonth: 0,
          cloudQuotaTotal: 0,
          cloudQuotaRemaining: 0,
          canPairMac: PAYWALLS_DISABLED_BUILD,
          overageUsdPerDispatch: 0.3,
          paywallsDisabled: PAYWALLS_DISABLED_BUILD,
          lastSyncedAt: null,
        }),
    }),
    {
      name: "wend:subscription",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

/** True when the user can dispatch in their currently selected mode. */
export function canDispatch(
  s: SubscriptionState,
  args: { mode: "mac" | "cloud" },
): boolean {
  if (PAYWALLS_DISABLED_BUILD || s.paywallsDisabled) return true;
  if (s.tier === "free") return false;
  if (s.status !== "active") return false;
  if (args.mode === "mac") return s.canPairMac;
  return s.tier === "pro" || s.tier === "cloud_paygo";
}
