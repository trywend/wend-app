/**
 * Wend — HealthDot.
 *
 * Tiny status pip that surfaces "is my daemon reachable?" at a glance. Reads
 * `useDaemonHealth` internally so the caller doesn't have to thread state —
 * it just drops <HealthDot /> next to whatever needs the signal.
 *
 *   ok            green   — last ping succeeded
 *   down          red     — last ping failed / timed out
 *   unknown       gray    — first load, no result yet
 *   unconfigured  amber   — env vars missing; user needs to set them
 *
 * Renders only the dot — no padding, no label. Caller positions.
 */
import { View, type StyleProp, type ViewStyle } from "react-native";

import { useDaemonHealth } from "@/lib/dispatch/useDaemonHealth";
import { useTheme } from "@/theme/ThemeProvider";

export interface HealthDotProps {
  /** Diameter in px. Defaults to 8. */
  size?: number;
  /** Positioning style — margin, alignment, etc. Visuals are owned here. */
  style?: StyleProp<ViewStyle>;
}

export function HealthDot({ size = 8, style }: HealthDotProps) {
  const { tokens } = useTheme();
  const { status } = useDaemonHealth();

  const color =
    status === "ok"
      ? tokens["status-done"]
      : status === "down"
        ? tokens["status-failed"]
        : status === "unconfigured"
          ? tokens["status-warn"]
          : tokens["text-tertiary"];

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Daemon status: ${status}`}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}
