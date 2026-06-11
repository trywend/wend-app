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
  lastSyncedAt: number | null;

  setStatus(args: Partial<Omit<SubscriptionState, "setStatus" | "reset">>): void;
  reset(): void;
}

export const useSubscriptionStore = create<SubscriptionState>()(
  persist(
    (set) => ({
      tier: "free",
      status: "active",
      currentPeriodEnd: null,
      cloudUsedThisMonth: 0,
      cloudQuotaTotal: 0,
      cloudQuotaRemaining: 0,
      canPairMac: false,
      overageUsdPerDispatch: 0.3,
      lastSyncedAt: null,

      setStatus: (args) => set({ ...args, lastSyncedAt: Date.now() }),
      reset: () =>
        set({
          tier: "free",
          status: "active",
          currentPeriodEnd: null,
          cloudUsedThisMonth: 0,
          cloudQuotaTotal: 0,
          cloudQuotaRemaining: 0,
          canPairMac: false,
          overageUsdPerDispatch: 0.3,
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
  if (s.tier === "free") return false;
  if (s.status !== "active") return false;
  if (args.mode === "mac") return s.canPairMac;
  return s.tier === "pro" || s.tier === "cloud_paygo";
}
