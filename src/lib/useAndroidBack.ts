/**
 * Wend — useAndroidBack hook.
 *
 * Tiny helper around `BackHandler.addEventListener("hardwareBackPress", ...)`
 * so each sheet (Inbox, Settings, Integrations, NoteActions, CommandPalette,
 * AttachmentPicker, FileViewerModal, ConnectMacSheet, ConnectGitHubSheet) can
 * consume the Android back-button press and close itself instead of letting
 * the OS pop the JS activity (which would exit the app from the home screen).
 *
 * Usage — call inside the sheet body, gated by the same `open` flag the
 * parent uses to mount it:
 *
 *   useAndroidBack(open, onClose);
 *
 * Returning `true` from the handler consumes the press. On iOS this is a
 * no-op — the listener simply never fires (BackHandler is Android-only in
 * effect; the listener registers but isn't called). Splitting the platform
 * check out keeps the call site uniform.
 *
 * Idempotency / stacking: each sheet registers its own listener while it's
 * `open`. React Native's BackHandler dispatches LIFO across registered
 * listeners — the most recently added handler is called first. Since the
 * topmost sheet (e.g. ConnectGitHubSheet on top of IntegrationsSheet on top
 * of SettingsSheet) mounts last, it wins the back press, which is exactly
 * what we want for "back closes the topmost layer".
 */
import { useEffect } from "react";
import { BackHandler, Platform } from "react-native";

export function useAndroidBack(active: boolean, onBack: () => void): void {
  useEffect(() => {
    if (!active) return;
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true; // consume — don't propagate to the OS
    });
    return () => sub.remove();
  }, [active, onBack]);
}
