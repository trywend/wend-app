/**
 * Wend — pair-your-Mac onboarding screen.
 *
 * Sits between sign-in and the notes app. Walks a fresh user through
 * pairing their Mac so the very first dispatch they ever send actually
 * goes somewhere. Skippable for users who want to explore the app
 * first; (app)/_layout.tsx remembers the skip and doesn't re-prompt.
 *
 * Composition:
 *   1. Hero — Wend logo + welcome copy.
 *   2. "Connect your Mac" primary CTA — opens ConnectMacSheet.
 *   3. "I'll do this later" subtle skip link — sets onboarding.pairSkipped
 *      and routes to the notes home.
 *
 * Auto-routes to /(app) the instant deviceId+token appear in the daemon
 * store — i.e., the moment the user finishes scanning the QR or typing
 * the OTP in the embedded sheet.
 */

import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import Animated, {
  FadeIn,
  FadeInDown,
} from "react-native-reanimated";
import { LaptopIcon, QrCodeIcon } from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { WendMark } from "@/components/primitives/Logo";
import { useTheme } from "@/theme/ThemeProvider";
import { useDaemonStore } from "@/store/daemonSlice";
import { useOnboardingStore } from "@/store/onboardingSlice";
import { ConnectMacSheet } from "@/components/ConnectMacSheet";

export default function OnboardingScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const [sheetOpen, setSheetOpen] = useState(false);

  const deviceId = useDaemonStore((s) => s.deviceId);
  const token = useDaemonStore((s) => s.token);
  const host = useDaemonStore((s) => s.host);
  const skipPairing = useOnboardingStore((s) => s.skipPairing);
  const markFirstShown = useOnboardingStore((s) => s.markFirstShown);

  const paired = Boolean(deviceId && token);

  useEffect(() => {
    markFirstShown();
  }, [markFirstShown]);

  // The moment pairing completes, drop the user into the notes app.
  // The ConnectMacSheet writes deviceId+token+host into the daemon
  // store on success; this effect catches that and routes.
  useEffect(() => {
    if (paired) {
      // Small delay so the sheet's success animation has a beat to play.
      const t = setTimeout(() => {
        router.replace("/(app)");
      }, 800);
      return () => clearTimeout(t);
    }
  }, [paired, router]);

  function handleSkip() {
    skipPairing();
    router.replace("/(app)");
  }

  const ink = tokens["text-primary"];
  const subtle = tokens["text-secondary"];
  const tertiary = tokens["text-tertiary"];
  const accent = tokens["accent-default"];
  const accentOn = tokens["accent-on"];
  const border = tokens["border-hairline"];
  const canvas = tokens["surface-canvas"];
  const elev = tokens["surface-elevated"];

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: canvas,
        paddingHorizontal: 28,
        paddingTop: 80,
        paddingBottom: 48,
      }}
    >
      {/* Top: brand mark */}
      <Animated.View entering={FadeIn.duration(260)}>
        <WendMark height={32} inkColor={ink} />
      </Animated.View>

      {/* Middle: welcome copy + status card */}
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Animated.View entering={FadeInDown.delay(80).duration(280)}>
          <Text
            style={{
              fontFamily: "Inter-Bold",
              fontSize: 30,
              lineHeight: 36,
              letterSpacing: -0.6,
              color: ink,
            }}
          >
            Welcome to Wend.
          </Text>
          <Text
            style={{
              marginTop: 14,
              fontFamily: "Inter-Regular",
              fontSize: 16,
              lineHeight: 24,
              letterSpacing: -0.1,
              color: subtle,
            }}
          >
            Notes you can send. Drop a thought from your phone and your Mac
            picks it up — Claude runs it in the right project, in the
            background.
          </Text>
        </Animated.View>

        {/* Status card — changes based on pairing state */}
        <Animated.View
          entering={FadeInDown.delay(180).duration(300)}
          style={{
            marginTop: 32,
            backgroundColor: elev,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: border,
            padding: 20,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: `${accent}14`,
              }}
            >
              <LaptopIcon size={22} color={accent} weight="regular" />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily: "Inter-SemiBold",
                  fontSize: 14.5,
                  color: ink,
                  letterSpacing: -0.1,
                }}
              >
                {paired ? `Paired with ${host}` : "Connect your Mac"}
              </Text>
              <Text
                style={{
                  marginTop: 2,
                  fontFamily: "Inter-Regular",
                  fontSize: 12.5,
                  lineHeight: 18,
                  color: subtle,
                }}
              >
                {paired
                  ? "You're ready. Heading to your notes…"
                  : "Open Wend.app on your Mac, then scan the QR or type the 6-digit code."}
              </Text>
            </View>
          </View>
        </Animated.View>
      </View>

      {/* Bottom: CTAs */}
      <Animated.View entering={FadeInDown.delay(260).duration(300)}>
        <Pressable
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Connect your Mac"
          disabled={paired}
          style={({ pressed }) => ({
            opacity: paired ? 0.5 : pressed ? 0.85 : 1,
          })}
        >
          <View
            style={{
              height: 56,
              borderRadius: 28,
              backgroundColor: accent,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 8,
              shadowColor: "#000",
              shadowOpacity: 0.12,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
              elevation: 4,
            }}
          >
            <QrCodeIcon size={18} color={accentOn} weight="bold" />
            <Text
              style={{
                fontFamily: "Inter-SemiBold",
                fontSize: 16,
                color: accentOn,
                letterSpacing: -0.1,
              }}
            >
              {paired ? "Done" : "Connect your Mac"}
            </Text>
          </View>
        </Pressable>

        <Pressable
          onPress={handleSkip}
          accessibilityRole="button"
          accessibilityLabel="Skip pairing for now"
          disabled={paired}
          style={({ pressed }) => ({
            marginTop: 18,
            alignSelf: "center",
            opacity: paired ? 0 : pressed ? 0.55 : 1,
          })}
        >
          <Text
            style={{
              fontFamily: "Inter-Medium",
              fontSize: 13,
              color: tertiary,
              textDecorationLine: "underline",
            }}
          >
            I'll connect my Mac later
          </Text>
        </Pressable>
      </Animated.View>

      <ConnectMacSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}
