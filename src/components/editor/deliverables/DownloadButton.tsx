/**
 * Wend — deliverable download button. On-brand pill: ember label + tray icon,
 * a spinner while the save/share sheet is being prepared.
 */
import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { DownloadSimpleIcon } from "phosphor-react-native";

import { PressableSurface, Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";

export function DownloadButton({
  label = "Download",
  onDownload,
}: {
  label?: string;
  onDownload: () => Promise<void>;
}) {
  const { tokens } = useTheme();
  const accent = tokens["accent-default"];
  const border = tokens["border-hairline"];
  const [busy, setBusy] = useState(false);

  async function handle() {
    if (busy) return;
    setBusy(true);
    try {
      await onDownload();
    } catch {
      // Presenting the share sheet can throw if the user dismisses it or the
      // module is missing — nothing actionable, stay quiet.
    } finally {
      setBusy(false);
    }
  }

  return (
    <PressableSurface
      onPress={handle}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        height: 34,
        paddingHorizontal: 14,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: border,
      }}
      pressedStyle={{ opacity: 0.6 }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={accent} />
      ) : (
        <DownloadSimpleIcon size={15} color={accent} weight="regular" />
      )}
      <Text
        style={{ fontFamily: "Inter-SemiBold", fontSize: 13, color: accent }}
      >
        {label}
      </Text>
    </PressableSurface>
  );
}

/** Section shell used by every deliverable renderer — titled header row with a
 *  kind chip on the right. */
export function DeliverableCard({
  icon,
  title,
  chip,
  flush = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  chip?: string;
  flush?: boolean;
  children: React.ReactNode;
}) {
  const { tokens } = useTheme();
  const ink = tokens["text-primary"];
  const subtle = tokens["text-secondary"];
  const border = tokens["border-hairline"];
  const surface = tokens["surface-elevated"];
  const chipBg = tokens["surface-chip"];

  return (
    <View
      style={{
        marginHorizontal: flush ? 0 : 14,
        marginTop: flush ? 0 : 12,
        marginBottom: flush ? 0 : 4,
        borderWidth: 1,
        borderColor: border,
        borderRadius: 12,
        backgroundColor: surface,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 9,
          borderBottomWidth: 1,
          borderBottomColor: border,
        }}
      >
        {icon}
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: "Inter-SemiBold",
            fontSize: 12,
            color: ink,
            letterSpacing: -0.1,
          }}
        >
          {title}
        </Text>
        {chip ? (
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 999,
              backgroundColor: chipBg,
            }}
          >
            <Text
              style={{
                fontFamily: "JetBrainsMono",
                fontSize: 10.5,
                color: subtle,
              }}
            >
              {chip}
            </Text>
          </View>
        ) : null}
      </View>
      {children}
    </View>
  );
}
