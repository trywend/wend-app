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

import { useDaemonStore } from "@/store/daemonSlice";
import { useOnboardingStore } from "@/store/onboardingSlice";

export default function AppLayout() {
  const router = useRouter();
  const segments = useSegments();

  const deviceId = useDaemonStore((s) => s.deviceId);
  const token = useDaemonStore((s) => s.token);
  const pairSkipped = useOnboardingStore((s) => s.pairSkipped);

  const paired = Boolean(deviceId && token);
  const onOnboarding = segments[1] === "onboarding";

  useEffect(() => {
    // Send unpaired, never-skipped users to onboarding.
    if (!paired && !pairSkipped && !onOnboarding) {
      router.replace("/(app)/onboarding");
      return;
    }
    // Already-satisfied users who somehow land on onboarding — bounce home.
    if ((paired || pairSkipped) && onOnboarding) {
      router.replace("/(app)");
    }
  }, [paired, pairSkipped, onOnboarding, router]);

  return <Stack screenOptions={{ headerShown: false }} />;
}
