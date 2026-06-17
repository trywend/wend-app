/**
 * Wend — OTA update orchestration.
 *
 * WhatsApp-style flow: silently check + download new JS bundles on launch and
 * on every return to foreground, then surface a single "ready, restart" prompt
 * once a bundle has finished downloading. Nothing is shown while checking or
 * downloading — the app's updater has intermittent cold-start DNS failures, so
 * every error is swallowed and simply retried on the next foreground. The
 * pending bundle also applies on the next cold launch even if the user never
 * taps Restart, so dismissing is always safe.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Updates from "expo-updates";

/** Don't hammer the update server — at most one check per minute. */
const MIN_CHECK_INTERVAL_MS = 60_000;

export interface OtaUpdateState {
  /** A new bundle finished downloading and will load on the next reload. */
  updateReady: boolean;
  /** Reload now to apply the pending bundle. */
  restart: () => void;
  /** True between tapping Restart and the reload taking effect. */
  restarting: boolean;
}

export function useOtaUpdate(): OtaUpdateState {
  const { isUpdatePending } = Updates.useUpdates();
  const [restarting, setRestarting] = useState(false);
  const lastCheckAt = useRef(0);
  const inFlight = useRef(false);

  const checkAndDownload = useCallback(async () => {
    // Updates are disabled in dev / Expo Go — the hook is a no-op there.
    if (!Updates.isEnabled || inFlight.current) return;
    const now = Date.now();
    if (now - lastCheckAt.current < MIN_CHECK_INTERVAL_MS) return;
    lastCheckAt.current = now;
    inFlight.current = true;
    try {
      const check = await Updates.checkForUpdateAsync();
      if (check.isAvailable) await Updates.fetchUpdateAsync();
    } catch {
      // Flaky network / DNS — stay silent and retry on the next foreground.
      lastCheckAt.current = 0;
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void checkAndDownload();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void checkAndDownload();
    });
    return () => sub.remove();
  }, [checkAndDownload]);

  const restart = useCallback(() => {
    setRestarting(true);
    // Defer the reload one tick so the full-screen "Updating…" overlay paints
    // before reloadAsync tears down the JS tree — otherwise the screen flashes
    // blank during the reload. The native splash covers the rest of the reload.
    setTimeout(() => {
      Updates.reloadAsync().catch(() => setRestarting(false));
    }, 350);
  }, []);

  return { updateReady: isUpdatePending, restart, restarting };
}
