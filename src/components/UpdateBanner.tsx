/**
 * Wend — OTA update banner.
 *
 * A calm top banner that slides in only once a new bundle is downloaded and
 * ready. Tap Restart to apply now; dismiss to apply on the next launch. Global
 * (mounted at the root) so it shows over any screen.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, SlideInUp, SlideOutUp } from "react-native-reanimated";
import { ArrowClockwiseIcon, XIcon } from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { WendMark } from "@/components/primitives/Logo";
import { useTheme } from "@/theme/ThemeProvider";
import { useOtaUpdate } from "@/lib/updates/useOtaUpdate";

export function UpdateBanner() {
  const { updateReady, restart, restarting } = useOtaUpdate();
  const insets = useSafeAreaInsets();
  const { tokens } = useTheme();
  const [dismissed, setDismissed] = useState(false);

  // A fresh download re-arms the banner after a prior dismissal.
  useEffect(() => {
    if (updateReady) setDismissed(false);
  }, [updateReady]);

  const accent = tokens["accent-default"];
  const accentOn = tokens["accent-on"];
  const ink = tokens["text-primary"];
  const subtle = tokens["text-secondary"];
  const surface = tokens["surface-elevated"];
  const border = tokens["border-hairline"];

  // Full-screen branded cover for the reload gap (reloadAsync blanks the JS
  // tree for a beat). Stays until the native splash takes over.
  if (restarting) {
    return (
      <Animated.View
        entering={FadeIn.duration(120)}
        pointerEvents="auto"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 300,
          backgroundColor: tokens["surface-canvas"],
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <WendMark height={56} inkColor={ink} />
        <Text
          style={{
            marginTop: 22,
            fontFamily: "Inter-Medium",
            fontSize: 14,
            color: subtle,
            letterSpacing: -0.1,
          }}
        >
          Updating Wend…
        </Text>
        <ActivityIndicator style={{ marginTop: 18 }} color={accent} />
      </Animated.View>
    );
  }

  if (!updateReady || dismissed) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        top: insets.top + 8,
        left: 12,
        right: 12,
        zIndex: 200,
        alignItems: "center",
      }}
    >
      <Animated.View
        entering={SlideInUp.springify().damping(16).mass(0.7)}
        exiting={SlideOutUp.duration(180)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          maxWidth: 480,
          width: "100%",
          backgroundColor: surface,
          borderColor: border,
          borderWidth: 1,
          borderRadius: 16,
          paddingLeft: 14,
          paddingRight: 8,
          paddingVertical: 8,
          shadowColor: "#000",
          shadowOpacity: 0.12,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 6,
        }}
      >
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${accent}1A`,
            marginRight: 10,
          }}
        >
          <ArrowClockwiseIcon size={16} color={accent} weight="bold" />
        </View>

        <View style={{ flex: 1, marginRight: 8 }}>
          <Text
            style={{ fontFamily: "Inter-SemiBold", fontSize: 13.5, color: ink }}
            numberOfLines={1}
          >
            Update ready
          </Text>
          <Text
            style={{ fontFamily: "Inter-Regular", fontSize: 12, color: subtle }}
            numberOfLines={1}
          >
            Restart to get the latest Wend.
          </Text>
        </View>

        <View
          style={{
            height: 34,
            borderRadius: 17,
            overflow: "hidden",
            backgroundColor: accent,
            marginRight: 4,
            minWidth: 88,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {restarting ? (
            <ActivityIndicator size="small" color={accentOn} />
          ) : (
            <Text style={{ fontFamily: "Inter-SemiBold", fontSize: 13, color: accentOn }}>
              Restart
            </Text>
          )}
          <Pressable
            onPress={restart}
            disabled={restarting}
            accessibilityRole="button"
            accessibilityLabel="Restart to apply update"
            android_ripple={{ color: "rgba(255,255,255,0.22)", borderless: false, foreground: true }}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          />
        </View>

        <Pressable
          onPress={() => setDismissed(true)}
          disabled={restarting}
          accessibilityRole="button"
          accessibilityLabel="Dismiss update notice"
          hitSlop={8}
          style={({ pressed }) => ({
            width: 30,
            height: 30,
            borderRadius: 15,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <XIcon size={15} color={subtle} weight="bold" />
        </Pressable>
      </Animated.View>
    </View>
  );
}
