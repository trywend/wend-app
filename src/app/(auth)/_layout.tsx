/**
 * Wend — (auth) route group layout. Unauthenticated screens (just S27 for now).
 * No header chrome — onboarding is full-bleed canvas (Design Doc § 5.3 S27).
 */
import { Stack } from "expo-router";

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
