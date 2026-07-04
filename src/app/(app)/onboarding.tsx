/**
 * Wend — pair-your-Mac onboarding screen.
 *
 * Sits between sign-in and the notes app. Auto-routes to /(app) the instant
 * deviceId+token appear in the daemon store — i.e., as soon as the user
 * finishes the embedded ConnectMacSheet's QR scan or OTP entry.
 */

import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Pressable,
  Share,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  QrCodeIcon,
} from "phosphor-react-native";

const MAC_DOWNLOAD_URL = "https://trywend.vercel.app/download";

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
  const insets = useSafeAreaInsets();
  const [macSheetOpen, setMacSheetOpen] = useState(false);
  const [anthropicSheetOpen, setAnthropicSheetOpen] = useState(false);
  const [githubSheetOpen, setGithubSheetOpen] = useState(false);

  const deviceId = useDaemonStore((s) => s.deviceId);
  const url = useDaemonStore((s) => s.url);
  const token = useDaemonStore((s) => s.token);
  const host = useDaemonStore((s) => s.host);
  const skipPairing = useOnboardingStore((s) => s.skipPairing);
  const markFirstShown = useOnboardingStore((s) => s.markFirstShown);

  const setDispatchMode = useCloudStore((s) => s.setDispatchMode);
  const anthropicConnected = useCloudStore((s) => s.anthropicConnected);
  const githubConnected = useCloudStore((s) => s.githubConnected);
  const cloudReady = anthropicConnected && githubConnected;

  // v2 (rendezvous deviceId) or v1 (direct URL) both count as paired.
  const paired = Boolean(token && (deviceId || url));

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduceMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

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

  // Get the Mac app onto the Mac. iOS can't install software on a Mac, so the
  // frictionless path is the OS share sheet: on iOS this surfaces AirDrop — one
  // tap beams the download link to the user's Mac.
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
  const chip = tokens["surface-chip"];

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: canvas,
        paddingHorizontal: 24,
        paddingTop: insets.top + 20,
        paddingBottom: insets.bottom + 16,
      }}
    >
      {/* Header — mark + tagline, left-aligned for an editorial read */}
      <Animated.View
        entering={FadeIn.duration(280)}
        style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 11,
            backgroundColor: elev,
            borderWidth: 1,
            borderColor: border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <WendMark height={19} inkColor={ink} />
        </View>
        <Text
          style={{
            fontFamily: "Inter-Medium",
            fontSize: 14,
            letterSpacing: -0.1,
            color: tertiary,
          }}
        >
          Notes that act.
        </Text>
      </Animated.View>

      {/* Body */}
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Animated.View entering={FadeInDown.delay(60).duration(300)}>
          <Text
            style={{
              fontFamily: "Inter-Bold",
              fontSize: 34,
              lineHeight: 39,
              letterSpacing: -0.8,
              color: ink,
            }}
          >
            Pair your Mac.
          </Text>
          <Text
            style={{
              marginTop: 12,
              fontFamily: "Inter-Regular",
              fontSize: 16,
              lineHeight: 24,
              letterSpacing: -0.1,
              color: subtle,
              maxWidth: 320,
            }}
          >
            Write a note here. Your Mac picks it up and runs it with Claude in
            your real repo — read-only by default, Face ID gates writes.
          </Text>
        </Animated.View>

        {/* Concept panel — note → Mac → repo */}
        <Animated.View
          entering={FadeInDown.delay(140).duration(340)}
          style={{
            marginTop: 32,
            backgroundColor: elev,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: border,
            padding: 20,
          }}
        >
          <FlowDiagram
            paired={paired}
            host={host}
            reduceMotion={reduceMotion}
            ink={ink}
            subtle={subtle}
            tertiary={tertiary}
            accent={accent}
            accentOn={accentOn}
            border={border}
            chip={chip}
            canvas={canvas}
          />
        </Animated.View>
      </View>

      {/* CTAs */}
      <Animated.View entering={FadeInDown.delay(220).duration(300)}>
        <Pressable
          onPress={startMac}
          accessibilityRole="button"
          accessibilityLabel="Pair your Mac with a QR scan"
          disabled={paired}
          style={({ pressed }) => ({
            height: 58,
            borderRadius: 16,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            backgroundColor: accent,
            opacity: paired ? 0.5 : pressed ? 0.9 : 1,
          })}
        >
          {paired ? (
            <CheckCircleIcon size={20} color={accentOn} weight="fill" />
          ) : (
            <QrCodeIcon size={20} color={accentOn} weight="bold" />
          )}
          <Text
            style={{
              fontFamily: "Inter-SemiBold",
              fontSize: 17,
              color: accentOn,
              letterSpacing: -0.1,
            }}
          >
            {paired ? "Paired" : "Scan pairing code"}
          </Text>
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
              Get Wend for Mac
            </Text>
          </Pressable>
        ) : null}

        {cloudEnabled && !paired ? (
          <Pressable
            onPress={startCloud}
            accessibilityRole="button"
            accessibilityLabel="Use cloud agents instead"
            style={({ pressed }) => ({
              marginTop: 12,
              height: 52,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: border,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: elev,
              opacity: pressed ? 0.9 : 1,
            })}
          >
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
          </Pressable>
        ) : null}

        <Pressable
          onPress={handleSkip}
          accessibilityRole="button"
          accessibilityLabel="Skip pairing for now"
          disabled={paired}
          hitSlop={8}
          style={({ pressed }) => ({
            marginTop: 18,
            alignSelf: "center",
            opacity: paired ? 0 : pressed ? 0.6 : 1,
          })}
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
 * The concept made concrete: a note card flows into a Mac terminal line that
 * runs in a real repo. A single ember pulse travels the connector while
 * unpaired; on pair it snaps to a settled done state. Respects Reduce Motion.
 */
function FlowDiagram({
  paired,
  host,
  reduceMotion,
  ink,
  subtle,
  tertiary,
  accent,
  accentOn,
  border,
  chip,
  canvas,
}: {
  paired: boolean;
  host: string;
  reduceMotion: boolean;
  ink: string;
  subtle: string;
  tertiary: string;
  accent: string;
  accentOn: string;
  border: string;
  chip: string;
  canvas: string;
}) {
  const travel = useSharedValue(0);

  useEffect(() => {
    if (paired || reduceMotion) {
      travel.value = 0;
      return;
    }
    travel.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 500 }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
      false,
    );
  }, [paired, reduceMotion, travel]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: travel.value === 0 ? 0 : 1 - Math.abs(travel.value - 0.5) * 1.4,
    transform: [{ translateX: travel.value * 26 }],
  }));

  const running = !paired;

  return (
    <View style={{ gap: 12 }}>
      {/* Note card — the protagonist */}
      <View
        style={{
          borderRadius: 12,
          borderWidth: 1,
          borderColor: border,
          backgroundColor: canvas,
          paddingHorizontal: 14,
          paddingVertical: 12,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: accent,
            }}
          />
          <Text
            style={{
              fontFamily: "Inter-Medium",
              fontSize: 11,
              letterSpacing: 0.4,
              color: tertiary,
            }}
          >
            NOTE
          </Text>
        </View>
        <Text
          style={{
            fontFamily: "Inter-Medium",
            fontSize: 14.5,
            lineHeight: 20,
            letterSpacing: -0.1,
            color: ink,
          }}
        >
          Fix the flaky auth test and open a PR
        </Text>
      </View>

      {/* Connector — arrow + traveling ember pulse */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingLeft: 4,
        }}
      >
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: chip,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ArrowRightIcon
            size={12}
            color={subtle}
            weight="bold"
            style={{ transform: [{ rotate: "90deg" }] }}
          />
        </View>
        <View
          style={{
            flex: 1,
            height: 1,
            backgroundColor: border,
            justifyContent: "center",
          }}
        >
          <Animated.View
            style={[
              {
                position: "absolute",
                width: 18,
                height: 2,
                borderRadius: 1,
                backgroundColor: accent,
              },
              pulseStyle,
            ]}
          />
        </View>
        <Text
          style={{
            fontFamily: "Inter-Medium",
            fontSize: 12,
            letterSpacing: -0.1,
            color: tertiary,
          }}
        >
          {paired ? `on ${host}` : "on your Mac"}
        </Text>
      </View>

      {/* Terminal — runs in the real repo */}
      <View
        style={{
          borderRadius: 12,
          borderWidth: 1,
          borderColor: border,
          backgroundColor: chip,
          paddingHorizontal: 14,
          paddingVertical: 12,
          gap: 8,
        }}
      >
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
        >
          <View
            style={{
              width: 16,
              height: 16,
              borderRadius: 4,
              backgroundColor: paired ? accent : "transparent",
              borderWidth: paired ? 0 : 1.5,
              borderColor: accent,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {paired ? (
              <CheckCircleIcon size={12} color={accentOn} weight="fill" />
            ) : null}
          </View>
          <Text
            style={{
              fontFamily: "JetBrainsMono-Medium",
              fontSize: 12.5,
              color: ink,
            }}
          >
            claude run
          </Text>
        </View>
        <Text
          style={{
            fontFamily: "JetBrainsMono",
            fontSize: 12,
            lineHeight: 18,
            color: running ? subtle : accent,
          }}
        >
          {paired
            ? "3 files changed · PR opened"
            : "reading tests/auth.spec.ts…"}
        </Text>
      </View>
    </View>
  );
}
