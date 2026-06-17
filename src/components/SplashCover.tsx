/**
 * Wend — full-screen branded cover.
 *
 * Used wherever the app would otherwise render a blank frame: the font/auth
 * boot states in the root layout, and the OTA reload gap. It paints paper +
 * the Wend mark + a quiet spinner so the user never faces a white void.
 *
 * Deliberately self-contained with static brand colors — it renders OUTSIDE
 * ThemeProvider (during boot) where `useTheme()` isn't available yet.
 */
import { ActivityIndicator, View } from "react-native";

import { Text } from "@/components/primitives";
import { WendMark } from "@/components/primitives/Logo";

const PAPER = "#FBFAF7";
const INK = "#1E1714";
const SUBTLE = "#8A817A";
const EMBER = "#D85A3C";

export function SplashCover({ label }: { label?: string }) {
  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: PAPER,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <WendMark height={56} inkColor={INK} />
      {label ? (
        <Text
          style={{
            marginTop: 22,
            fontFamily: "Inter-Medium",
            fontSize: 14,
            color: SUBTLE,
            letterSpacing: -0.1,
          }}
        >
          {label}
        </Text>
      ) : null}
      <ActivityIndicator style={{ marginTop: label ? 18 : 26 }} color={EMBER} />
    </View>
  );
}
