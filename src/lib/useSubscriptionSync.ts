/**
 * Sync the local subscription mirror with Tempus.
 *
 * Called from the app's root layout once per launch + on demand after a
 * billing action. Refreshing after every dispatch isn't necessary —
 * usage counters drift by minutes, not relevant for the next decision.
 */
import { useCallback, useEffect } from "react";
import { useAuth } from "@clerk/clerk-expo";
import { useSubscriptionStore } from "@/store/subscriptionSlice";
import { useWendCloudApi, CloudApiError } from "@/lib/wend-cloud-api";

export function useSubscriptionSync() {
  const { isSignedIn } = useAuth();
  const api = useWendCloudApi();
  const setStatus = useSubscriptionStore((s) => s.setStatus);

  const refresh = useCallback(async () => {
    if (!isSignedIn || !api.isConfigured) return;
    try {
      const s = await api.subscriptionStatus();
      setStatus({
        tier: s.tier,
        status: s.status,
        currentPeriodEnd: s.current_period_end,
        cloudUsedThisMonth: s.cloud_used_this_month,
        cloudQuotaTotal: s.cloud_quota_total,
        cloudQuotaRemaining: s.cloud_quota_remaining,
        canPairMac: s.can_pair_mac,
        overageUsdPerDispatch: s.overage_usd_per_dispatch,
      });
    } catch (err) {
      if (err instanceof CloudApiError && err.status === 401) return;
      // Silently degrade — the user keeps their last-known status.
    }
  }, [isSignedIn, api, setStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { refresh };
}
