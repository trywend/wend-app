/**
 * Wend — "Queued" pill.
 *
 * A subtle, honest indicator that a note's dispatch is parked in the durable
 * queue and will fire when the Mac is reachable again. Used on the note screen
 * (absolute, above the toolbar) and, in a compact form, on inbox rows.
 *
 * Static View only — no Pressable, so the NativeWind-on-Pressable layout
 * caveat doesn't apply here.
 */
import { View } from "react-native";
import { ClockCountdownIcon } from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";

export function QueuedPill({
  bottomOffset,
}: {
  bottomOffset: number;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const accent = tokens["accent-default"];
  const canvas = tokens["surface-canvas"];
  const border = tokens["border-hairline"];
  const subtle = tokens["text-secondary"];
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: bottomOffset,
        alignItems: "center",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 999,
          backgroundColor: canvas,
          borderWidth: 1,
          borderColor: border,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.08,
          shadowRadius: 8,
          elevation: 3,
        }}
      >
        <ClockCountdownIcon size={15} color={accent} weight="bold" />
        <Text
          style={{
            color: subtle,
            fontFamily: "Inter-Medium",
            fontSize: 12,
            lineHeight: 16,
          }}
        >
          Queued · runs when your Mac wakes
        </Text>
      </View>
    </View>
  );
}

/** Compact inline variant for inbox rows — icon + short label, no chrome. */
export function QueuedRowTag(): React.JSX.Element {
  const { tokens } = useTheme();
  const accent = tokens["accent-default"];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <ClockCountdownIcon size={13} color={accent} weight="bold" />
      <Text
        variant="meta"
        style={{ color: accent, fontFamily: "Inter-Medium" }}
      >
        Queued
      </Text>
    </View>
  );
}
