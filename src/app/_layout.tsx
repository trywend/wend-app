/**
 * Wend — root layout.
 *
 * Wires the whole provider stack and the protected-route gate:
 *   GestureHandlerRootView  (required for the Sheet's gestures)
 *     SafeAreaProvider
 *       QueryProvider       (TanStack Query — server state)
 *         ThemeProvider     (Paper & Ember; resolves light/dark, default System)
 *           AuthGate        (sends anon → (auth), authed → (app))
 *             <Slot/>
 *
 * Fonts load here (Inter + JetBrains Mono); the splash screen stays up until
 * they're ready so the first paint has correct type.
 */
import { useEffect } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { ClerkProvider } from "@clerk/clerk-expo";

import "@/theme/global.css";
import { fontMap } from "@/theme/fonts";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { QueryProvider } from "@/lib/queryClient";
import { useSessionBootstrap } from "@/auth/useSession";
import { useAuthStore } from "@/store/authSlice";
import { tokenCache } from "@/auth/tokenCache";
import { clerkPublishableKey, isClerkConfigured } from "@/config/env";

if (!isClerkConfigured) {
  // eslint-disable-next-line no-console
  console.warn(
    "[wend/auth] EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY missing — sign-in won't work. " +
      "Paste your Clerk publishable key into .env.local and restart Metro.",
  );
}

void SplashScreen.preventAutoHideAsync();

/** Redirects between the (auth) and (app) route groups based on session. */
function AuthGate() {
  useSessionBootstrap();
  const status = useAuthStore((s) => s.status);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    const inAuthGroup = segments[0] === "(auth)";
    if (status === "anon" && !inAuthGroup) {
      router.replace("/(auth)/sign-in");
    } else if (status === "authed" && inAuthGroup) {
      router.replace("/(app)");
    }
  }, [status, segments, router]);

  return <Slot />;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontMap);

  useEffect(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  // When Clerk's publishable key is missing we render the rest of the app
  // WITHOUT ClerkProvider — the empty-key path can crash Clerk's mount, and
  // useAuth/useUser don't work conditionally. Sign-in falls back to disabled
  // (sign-in.tsx checks isClerkConfigured), so the screen still paints.
  const tree = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryProvider>
          <ThemeProvider>
            <StatusBar style="auto" />
            <AuthGate />
          </ThemeProvider>
        </QueryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );

  if (!isClerkConfigured) return tree;

  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      tokenCache={tokenCache}
    >
      {tree}
    </ClerkProvider>
  );
}
