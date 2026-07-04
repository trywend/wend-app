/**
 * Wend — (app) route group layout. Authenticated surfaces.
 *
 * Three-state gate (auth-level gating happens upstream in _layout.tsx):
 *
 *   Paired OR pairing skipped → /(app)/index   (notes home)
 *   Not paired AND not skipped → /(app)/onboarding
 *
 * The redirect is one-way per session: once the user pairs OR skips,
 * the gate is satisfied. Onboarding's success effect routes back here.
 *
 * The pair-skipped + onboarding-shown state lives in onboardingSlice
 * (persisted). Sign-out clears it so the next user starts fresh.
 */
import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";

import { useAuthStore } from "@/store/authSlice";
import { useDaemonStore } from "@/store/daemonSlice";
import { useOnboardingStore } from "@/store/onboardingSlice";

export default function AppLayout() {
  const router = useRouter();
  const segments = useSegments();

  const authStatus = useAuthStore((s) => s.status);
  const deviceId = useDaemonStore((s) => s.deviceId);
  const url = useDaemonStore((s) => s.url);
  const token = useDaemonStore((s) => s.token);
  const pairSkipped = useOnboardingStore((s) => s.pairSkipped);

  // A pairing is usable with a token plus *either* a rendezvous deviceId
  // (v2) OR a direct URL (v1). Requiring deviceId locked out every v1
  // pairing — which is all you get while the rendezvous backend is off —
  // and bounced freshly-paired users straight back to onboarding.
  const paired = Boolean(token && (deviceId || url));
  // expo-router types `useSegments()` as a string tuple, so a numeric index
  // beyond the known length tripped TS2493. Cast to a loose string[] read —
  // semantically equivalent and matches what the runtime hands us. Pre-
  // existing issue surfaced when the Android polish work ran a clean
  // `tsc --noEmit`; fix is in-place to keep the typecheck green.
  const onOnboarding = (segments as readonly string[])[1] === "onboarding";

  useEffect(() => {
    // Onboarding redirects are meaningless for a signed-out (or still
    // resolving) session — the root AuthGate is about to replace this whole
    // group with sign-in. Firing here first caused the onboarding flash.
    if (authStatus !== "authed") return;
    // Send unpaired, never-skipped users to onboarding.
    if (!paired && !pairSkipped && !onOnboarding) {
      router.replace("/(app)/onboarding");
      return;
    }
    // Already-satisfied users who somehow land on onboarding — bounce home.
    if ((paired || pairSkipped) && onOnboarding) {
      router.replace("/(app)");
    }
  }, [authStatus, paired, pairSkipped, onOnboarding, router]);

  return <Stack screenOptions={{ headerShown: false }} />;
}
