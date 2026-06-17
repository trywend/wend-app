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
import { Platform } from "react-native";
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
import { UpdateBanner } from "@/components/UpdateBanner";
import { SplashCover } from "@/components/SplashCover";
import * as SystemUI from "expo-system-ui";

// Paint the native root background paper so the brief window-bg flash during
// an OTA reload (reloadAsync tears down all JS before the new bundle paints)
// reads as paper, not the default dark. app.json `backgroundColor` covers the
// pre-JS frame on the next native build; this covers it from JS meanwhile.
void SystemUI.setBackgroundColorAsync("#FBFAF7");

if (!isClerkConfigured) {
  // eslint-disable-next-line no-console
  console.warn(
    "[wend/auth] EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY missing — sign-in won't work. " +
      "Paste your Clerk publishable key into .env.local and restart Metro.",
  );
}

void SplashScreen.preventAutoHideAsync();

/**
 * Android: set up notification channels at app boot.
 *
 * Android 8+ (API 26+) refuses to display a notification that doesn't belong
 * to a channel. SDK 56's `expo-notifications` exposes
 * `setNotificationChannelAsync` which idempotently creates (or updates) one.
 * We create two:
 *   - "default"  — generic system pings (welcome, sign-in completed, etc.)
 *   - "dispatch" — the actual Claude-run completion notifications (HIGH so
 *                  they heads-up on the lockscreen + with a short vibrate
 *                  pattern so they feel distinct from background noise).
 *
 * Lazy-loaded via require so a build without expo-notifications still boots —
 * see src/lib/notifications.ts for the same defensive pattern. iOS has no
 * channel concept; this is a no-op there.
 */
function setupAndroidNotificationChannels(): void {
  if (Platform.OS !== "android") return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const N = require("expo-notifications") as {
      setNotificationChannelAsync?: (
        id: string,
        channel: Record<string, unknown>,
      ) => Promise<void>;
      AndroidImportance?: { DEFAULT: number; HIGH: number; MAX: number };
    };
    if (!N.setNotificationChannelAsync) return;
    const HIGH = N.AndroidImportance?.HIGH ?? 4;
    void N.setNotificationChannelAsync("default", {
      name: "Default",
      importance: HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#D85A3C",
    });
    void N.setNotificationChannelAsync("dispatch", {
      name: "Dispatch complete",
      description: "Claude-run completion pings from your Mac.",
      importance: HIGH,
      vibrationPattern: [0, 200, 100, 200],
      lightColor: "#D85A3C",
    });
  } catch {
    // expo-notifications not installed yet — silent skip. The lazy-load
    // in src/lib/notifications.ts handles a graceful fallback.
  }
}

setupAndroidNotificationChannels();

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

  // While auth is unresolved, hold the branded cover. After an OTA reload the
  // native splash is already gone, so returning null here is what made the
  // long white gap while Clerk restores the session. The cover continues the
  // splash look (paper + mark) until the route is ready. Mounting <Slot/> here
  // would mount (app)'s layout and let its onboarding redirect fire before we
  // know the user is signed out, which flashed the Connect-your-Mac screen.
  if (status === "loading") return <SplashCover label="Updating Wend…" />;

  return <Slot />;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontMap);
  const authStatus = useAuthStore((s) => s.status);

  // Splash stays up until BOTH fonts and auth status are resolved — hiding
  // on fonts alone exposed a frame of the wrong route group while Clerk was
  // still restoring the session.
  useEffect(() => {
    if ((fontsLoaded || fontError) && authStatus !== "loading") {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, authStatus]);

  if (!fontsLoaded && !fontError) return <SplashCover />;

  // When Clerk's publishable key is missing we render the rest of the app
  // WITHOUT ClerkProvider — the empty-key path can crash Clerk's mount, and
  // useAuth/useUser don't work conditionally. Sign-in falls back to disabled
  // (sign-in.tsx checks isClerkConfigured), so the screen still paints.
  const tree = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryProvider>
          <ThemeProvider>
            {/* StatusBar:
             *   - iOS: `style="auto"` lets the OS choose dark/light based on
             *     userInterfaceStyle.
             *   - Android: SDK 56 `expo-status-bar` dropped the
             *     `translucent` / `backgroundColor` props — Android is
             *     ALWAYS edge-to-edge in SDK 53+ and the system bar is
             *     transparent by default. Layouts handle the top inset via
             *     react-native-safe-area-context's `useSafeAreaInsets`
             *     (the editor screen already does).
             */}
            <StatusBar style="auto" />
            <AuthGate />
            <UpdateBanner />
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
