/**
 * Wend — pair-your-Mac onboarding screen.
 *
 * Sits between sign-in and the notes app. Design matches the
 * mockup in `~/Desktop/Wend/Screen Spec.md` follow-ups:
 *
 *   - Centered W mark at top
 *   - "Welcome to Wend." headline + one-sentence pitch
 *   - Decorative card (laptop glyph + connection-dot animation) on
 *     paper-grain canvas with soft elevation
 *   - Primary CTA pill "Connect your Mac" (with QR icon)
 *   - Underline link "I'll connect my Mac later"
 *
 * Auto-routes to /(app) the instant deviceId+token appear in the
 * daemon store — i.e., as soon as the user finishes the embedded
 * ConnectMacSheet's QR scan or OTP entry.
 */

import { useEffect, useRef, useState } from "react";
import { Pressable, Share, View, Animated as RNAnimated } from "react-native";
import { useRouter } from "expo-router";
import Animated, {
  FadeIn,
  FadeInDown,
} from "react-native-reanimated";
import {
  CloudIcon,
  DownloadSimpleIcon,
  LaptopIcon,
  QrCodeIcon,
} from "phosphor-react-native";

/** Where the Mac app lives. The /download page handles the unsigned-app
 *  first-launch instructions and serves the EdDSA-signed DMG. */
const MAC_DOWNLOAD_URL = "https://wend-landing.vercel.app/download";

import { Text } from "@/components/primitives";
import { WendMark } from "@/components/primitives/Logo";
import { useTheme } from "@/theme/ThemeProvider";
import { useDaemonStore } from "@/store/daemonSlice";
import { useOnboardingStore } from "@/store/onboardingSlice";
import { useCloudStore } from "@/store/cloudSlice";
import { cloudEnabled } from "@/config/env";
import { ConnectMacSheet } from "@/components/ConnectMacSheet";
import { ConnectAnthropicSheet } from "@/components/ConnectAnthropicSheet";
import { CloudGitHubSheet } from "@/components/CloudGitHubSheet";

export default function OnboardingScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const [macSheetOpen, setMacSheetOpen] = useState(false);
  const [anthropicSheetOpen, setAnthropicSheetOpen] = useState(false);
  const [githubSheetOpen, setGithubSheetOpen] = useState(false);

  const deviceId = useDaemonStore((s) => s.deviceId);
  const token = useDaemonStore((s) => s.token);
  const host = useDaemonStore((s) => s.host);
  const skipPairing = useOnboardingStore((s) => s.skipPairing);
  const markFirstShown = useOnboardingStore((s) => s.markFirstShown);

  const setDispatchMode = useCloudStore((s) => s.setDispatchMode);
  const anthropicConnected = useCloudStore((s) => s.anthropicConnected);
  const githubConnected = useCloudStore((s) => s.githubConnected);
  const cloudReady = anthropicConnected && githubConnected;

  const paired = Boolean(deviceId && token);

  useEffect(() => {
    markFirstShown();
  }, [markFirstShown]);

  // Auto-route to notes when pairing completes. 800ms gives the sheet's
  // success state a beat before we leave.
  useEffect(() => {
    if (paired) {
      setDispatchMode("mac");
      const t = setTimeout(() => router.replace("/(app)"), 800);
      return () => clearTimeout(t);
    }
  }, [paired, router, setDispatchMode]);

  // Auto-route when both cloud connections finish, same beat as Mac.
  useEffect(() => {
    if (!cloudEnabled) return;
    if (!cloudReady) return;
    setDispatchMode("cloud");
    const t = setTimeout(() => router.replace("/(app)"), 600);
    return () => clearTimeout(t);
  }, [cloudReady, router, setDispatchMode]);

  function startMac() {
    setDispatchMode("mac");
    setMacSheetOpen(true);
  }

  function startCloud() {
    setDispatchMode("cloud");
    setAnthropicSheetOpen(true);
  }

  function handleSkip() {
    skipPairing();
    router.replace("/(app)");
  }

  // Get the Mac app onto the Mac. iOS can't install software on a Mac (no
  // cross-device install API exists), so the frictionless path is the OS
  // share sheet: on iOS this surfaces AirDrop — one tap beams the download
  // link to the user's Mac, which opens it in Safari. Mail / Messages / Copy
  // are the fallbacks (and the cross-platform path on Android).
  async function handleGetMacApp() {
    try {
      await Share.share({
        title: "Get Wend for Mac",
        message: `Install Wend for your Mac, then come back and scan the pairing QR.\n${MAC_DOWNLOAD_URL}`,
        url: MAC_DOWNLOAD_URL,
      });
    } catch {
      // User dismissed the share sheet — no-op.
    }
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
        paddingHorizontal: 24,
        paddingTop: 64,
        paddingBottom: 36,
      }}
    >
      {/* Brand mark — centered */}
      <Animated.View
        entering={FadeIn.duration(280)}
        style={{ alignItems: "center", marginBottom: 32 }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            backgroundColor: accent,
            alignItems: "center",
            justifyContent: "center",
            shadowColor: accent,
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.25,
            shadowRadius: 16,
          }}
        >
          <WendMark height={28} inkColor="#FFFFFF" />
        </View>
      </Animated.View>

      {/* Welcome copy + card */}
      <View style={{ flex: 1, justifyContent: "flex-start" }}>
        <Animated.View
          entering={FadeInDown.delay(60).duration(280)}
          style={{ alignItems: "center", marginBottom: 32 }}
        >
          <Text
            style={{
              fontFamily: "Inter-Bold",
              fontSize: 32,
              lineHeight: 38,
              letterSpacing: -0.6,
              color: ink,
              textAlign: "center",
            }}
          >
            Welcome to Wend.
          </Text>
          <Text
            style={{
              marginTop: 12,
              fontFamily: "Inter-Regular",
              fontSize: 15.5,
              lineHeight: 23,
              letterSpacing: -0.1,
              color: subtle,
              textAlign: "center",
              maxWidth: 320,
            }}
          >
            Notes that act. Drop a thought from your phone and your Mac
            picks it up — Claude runs it in the right project, in the
            background.
          </Text>
        </Animated.View>

        {/* Decorative card */}
        <Animated.View
          entering={FadeInDown.delay(140).duration(320)}
          style={{
            backgroundColor: elev,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: border,
            padding: 22,
            shadowColor: accent,
            shadowOpacity: 0.04,
            shadowOffset: { width: 0, height: 20 },
            shadowRadius: 40,
            elevation: 3,
          }}
        >
          <DecorativePanel
            paired={paired}
            host={host}
            accent={accent}
            canvas={canvas}
            border={border}
          />
          <View style={{ alignItems: "center", marginTop: 18 }}>
            <Text
              style={{
                fontFamily: "Inter-SemiBold",
                fontSize: 18,
                color: ink,
                letterSpacing: -0.2,
              }}
            >
              {paired ? `Paired with ${host}` : "Connect your Mac"}
            </Text>
            <Text
              style={{
                marginTop: 4,
                fontFamily: "Inter-Regular",
                fontSize: 13,
                color: subtle,
                textAlign: "center",
              }}
            >
              {paired
                ? "You're set. Heading to your notes…"
                : "Sync seamlessly with the desktop companion."}
            </Text>
          </View>
        </Animated.View>
      </View>

      {/* Bottom: dual-route CTAs */}
      <Animated.View
        entering={FadeInDown.delay(220).duration(300)}
        style={{ marginTop: 24 }}
      >
        <Pressable
          onPress={startMac}
          accessibilityRole="button"
          accessibilityLabel="Connect your Mac"
          disabled={paired}
          style={({ pressed }) => ({
            opacity: paired ? 0.5 : pressed ? 0.88 : 1,
          })}
        >
          <View
            style={{
              height: 60,
              borderRadius: 16,
              backgroundColor: accent,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 10,
              shadowColor: accent,
              shadowOpacity: 0.25,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 8 },
              elevation: 5,
            }}
          >
            <QrCodeIcon size={20} color={accentOn} weight="bold" />
            <Text
              style={{
                fontFamily: "Inter-SemiBold",
                fontSize: 17,
                color: accentOn,
                letterSpacing: -0.1,
              }}
            >
              {paired ? "Done" : "Connect your Mac"}
            </Text>
          </View>
        </Pressable>

        {!paired ? (
          <Pressable
            onPress={handleGetMacApp}
            accessibilityRole="button"
            accessibilityLabel="Get Wend for your Mac"
            hitSlop={8}
            style={({ pressed }) => ({
              marginTop: 14,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <DownloadSimpleIcon size={15} color={subtle} weight="bold" />
            <Text
              style={{
                fontFamily: "Inter-Medium",
                fontSize: 13.5,
                color: subtle,
                letterSpacing: -0.1,
              }}
            >
              Don't have Wend on your Mac? Get it
            </Text>
          </Pressable>
        ) : null}

        {cloudEnabled ? (
          <Pressable
            onPress={startCloud}
            accessibilityRole="button"
            accessibilityLabel="Use cloud agents instead"
            disabled={paired}
            style={{
              marginTop: 12,
              opacity: paired ? 0 : 1,
            }}
          >
            <View
              style={{
                height: 56,
                borderRadius: 14,
                backgroundColor: elev,
                borderWidth: 1,
                borderColor: border,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: 10,
              }}
            >
              <CloudIcon size={20} color={ink} weight="regular" />
              <Text
                style={{
                  fontFamily: "Inter-SemiBold",
                  fontSize: 16,
                  color: ink,
                  letterSpacing: -0.1,
                }}
              >
                Use cloud agents
              </Text>
            </View>
          </Pressable>
        ) : null}

        <Pressable
          onPress={handleSkip}
          accessibilityRole="button"
          accessibilityLabel="Skip pairing for now"
          disabled={paired}
          style={{
            marginTop: 16,
            alignSelf: "center",
            opacity: paired ? 0 : 1,
          }}
        >
          <Text
            style={{
              fontFamily: "Inter-Medium",
              fontSize: 13,
              color: tertiary,
            }}
          >
            I'll connect my Mac later
          </Text>
        </Pressable>

        {/* Home indicator hint */}
        <View style={{ alignItems: "center", marginTop: 20 }}>
          <View
            style={{
              width: 96,
              height: 4,
              borderRadius: 2,
              backgroundColor: tertiary,
              opacity: 0.18,
            }}
          />
        </View>
      </Animated.View>

      <ConnectMacSheet
        open={macSheetOpen}
        onClose={() => setMacSheetOpen(false)}
      />
      <ConnectAnthropicSheet
        open={anthropicSheetOpen}
        onClose={() => {
          setAnthropicSheetOpen(false);
          if (anthropicConnected && !githubConnected) {
            setTimeout(() => setGithubSheetOpen(true), 200);
          }
        }}
      />
      <CloudGitHubSheet
        open={githubSheetOpen}
        onClose={() => setGithubSheetOpen(false)}
      />
    </View>
  );
}

/**
 * Static decorative panel inside the welcome card — a laptop glyph
 * sitting on a faint dot grid with three pulsing connection dots
 * underneath. Communicates "pairing" without showing actual device
 * state until the user starts the flow.
 */
function DecorativePanel({
  paired,
  host,
  accent,
  canvas,
  border,
}: {
  paired: boolean;
  host: string;
  accent: string;
  canvas: string;
  border: string;
}) {
  // 3 pulsing dots — fades between full and 20% opacity in a staggered
  // sequence so the eye reads it as connectivity activity.
  const dot1 = useRef(new RNAnimated.Value(1)).current;
  const dot2 = useRef(new RNAnimated.Value(0.5)).current;
  const dot3 = useRef(new RNAnimated.Value(0.2)).current;

  useEffect(() => {
    if (paired) return;
    const makeLoop = (val: RNAnimated.Value, delay: number) =>
      RNAnimated.loop(
        RNAnimated.sequence([
          RNAnimated.delay(delay),
          RNAnimated.timing(val, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
          RNAnimated.timing(val, {
            toValue: 0.2,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
      );
    const l1 = makeLoop(dot1, 0);
    const l2 = makeLoop(dot2, 200);
    const l3 = makeLoop(dot3, 400);
    l1.start();
    l2.start();
    l3.start();
    return () => {
      l1.stop();
      l2.stop();
      l3.stop();
    };
  }, [paired, dot1, dot2, dot3]);

  return (
    <View
      style={{
        aspectRatio: 1.6,
        backgroundColor: canvas,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: border,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Dot grid background — pure CSS-ish via overlay of small dots */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          opacity: 0.08,
        }}
      >
        <DotGrid color={accent} />
      </View>

      <LaptopIcon size={56} color={accent} weight="light" />

      <View
        style={{
          flexDirection: "row",
          gap: 8,
          marginTop: 14,
        }}
      >
        <RNAnimated.View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: accent,
            opacity: dot1,
          }}
        />
        <RNAnimated.View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: accent,
            opacity: dot2,
          }}
        />
        <RNAnimated.View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: accent,
            opacity: dot3,
          }}
        />
      </View>
    </View>
  );
}

/** Simple dot grid via a stack of dots. Cheap to render, calm visual. */
function DotGrid({ color }: { color: string }) {
  // 6 columns × 5 rows = 30 dots — plenty to read as a grid texture
  // without bloating render cost.
  const rows = 5;
  const cols = 6;
  return (
    <View
      style={{
        flex: 1,
        flexDirection: "column",
        justifyContent: "space-around",
        paddingHorizontal: 18,
        paddingVertical: 14,
      }}
    >
      {Array.from({ length: rows }).map((_, r) => (
        <View
          key={r}
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
          }}
        >
          {Array.from({ length: cols }).map((__, c) => (
            <View
              key={c}
              style={{
                width: 3,
                height: 3,
                borderRadius: 1.5,
                backgroundColor: color,
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
