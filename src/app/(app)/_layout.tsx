/**
 * Wend — (app) route group layout. Authenticated surfaces. The real editor
 * (Phase 2) and inbox (Phase 6) mount here. No header — cold launch goes
 * straight to a chrome-less editor (Design Doc principle #2).
 */
import { Stack } from "expo-router";

export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
