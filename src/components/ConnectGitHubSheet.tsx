/**
 * Wend — ConnectGitHubSheet.
 *
 * Third level of the settings modal stack (z=80). Smaller than the parents —
 * about 60% of screen height — because it's a focused confirmation surface,
 * not a list. Layout per the founder's modal-stack HTML mock:
 *
 *   GitHub mark + close X
 *   Title "Connect GitHub"
 *   Paragraph copy explaining what access enables
 *   Two permission items (read code, read metadata) — each with a green
 *   check-circle icon
 *   Authorize button (ember, full-width)
 *   Cancel button (outlined, full-width)
 *
 * Phase 2 onAuthorize is a stub — the actual OAuth handshake to grant repo
 * access lives on the daemon (Wend's host-side process). For now we log the
 * tap so the dev console shows the user got through the consent UI.
 */
import { Pressable, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from "react-native-reanimated";
import {
  CheckCircleIcon,
  GithubLogoIcon,
  XIcon,
} from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";

export interface ConnectGitHubSheetProps {
  open: boolean;
  onClose: () => void;
  onAuthorize: () => void;
}

export function ConnectGitHubSheet(
  props: ConnectGitHubSheetProps,
): React.JSX.Element | null {
  if (!props.open) return null;
  return <ConnectGitHubSheetMounted {...props} />;
}

function ConnectGitHubSheetMounted({
  onClose,
  onAuthorize,
}: ConnectGitHubSheetProps) {
  const { tokens } = useTheme();

  const canvasBg = tokens["surface-canvas"];
  const inkColor = tokens["text-primary"];
  const subtleColor = tokens["text-secondary"];
  const tertiaryColor = tokens["text-tertiary"];
  const borderColor = tokens["border-hairline"];
  const accent = tokens["accent-default"];
  const chipBg = tokens["surface-chip"];
  const statusDoneColor = tokens["status-done"];

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 80,
      }}
      pointerEvents="box-none"
    >
      {/* Backdrop. Deeper dim since this is the focused decision surface. */}
      <Animated.View
        entering={FadeIn.duration(220)}
        exiting={FadeOut.duration(180)}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.32)",
        }}
      >
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={{ flex: 1 }}
        />
      </Animated.View>

      <Animated.View
        entering={SlideInDown.duration(260)}
        exiting={SlideOutDown.duration(220)}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "62%",
          backgroundColor: canvasBg,
          borderTopLeftRadius: 32,
          borderTopRightRadius: 32,
          borderWidth: 1,
          borderColor: borderColor,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -8 },
          shadowOpacity: 0.1,
          shadowRadius: 32,
          elevation: 14,
          overflow: "hidden",
        }}
      >
        {/* Drag handle */}
        <View
          style={{
            width: "100%",
            paddingTop: 12,
            paddingBottom: 8,
            alignItems: "center",
          }}
        >
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: 999,
              backgroundColor: tertiaryColor,
            }}
          />
        </View>

        {/* GitHub mark + close X */}
        <View
          style={{
            paddingHorizontal: 24,
            paddingTop: 8,
            paddingBottom: 4,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              backgroundColor: chipBg,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <GithubLogoIcon size={28} color={inkColor} weight="regular" />
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <XIcon size={20} color={subtleColor} weight="regular" />
            </View>
          </Pressable>
        </View>

        <View
          style={{
            paddingHorizontal: 24,
            paddingTop: 16,
            paddingBottom: 24,
            gap: 20,
            flex: 1,
          }}
        >
          <View style={{ gap: 8 }}>
            <Text variant="title" style={{ color: inkColor }}>
              Connect GitHub
            </Text>
            <Text variant="body" style={{ color: subtleColor }}>
              Allow Wend to access your repositories. This enables semantic
              search across your codebase and automated note linking.
            </Text>
          </View>

          <View style={{ gap: 16, marginTop: 4 }}>
            <PermissionItem
              heading="Read access to code"
              caption="We will never modify your source files."
              inkColor={inkColor}
              subtleColor={subtleColor}
              statusDoneColor={statusDoneColor}
            />
            <PermissionItem
              heading="Read access to metadata"
              caption="Issues, pull requests, and commit history."
              inkColor={inkColor}
              subtleColor={subtleColor}
              statusDoneColor={statusDoneColor}
            />
          </View>

          {/* Spacer pushes the actions to the bottom. */}
          <View style={{ flex: 1 }} />

          {/* Authorize — ember pill, full-width. Pressable wraps content;
              static-style inner View holds the visual + layout. */}
          <Pressable
            onPress={() => {
              // eslint-disable-next-line no-console
              console.log("[wend] GitHub authorize tapped");
              onAuthorize();
            }}
            accessibilityRole="button"
            accessibilityLabel="Authorize"
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          >
            <View
              style={{
                width: "100%",
                height: 52,
                borderRadius: 999,
                backgroundColor: accent,
                alignItems: "center",
                justifyContent: "center",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.12,
                shadowRadius: 6,
                elevation: 2,
              }}
            >
              <Text
                style={{
                  color: "#FFFFFF",
                  fontFamily: "Inter-SemiBold",
                  fontSize: 15,
                }}
              >
                Authorize
              </Text>
            </View>
          </Pressable>

          {/* Cancel — outlined pill. */}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <View
              style={{
                width: "100%",
                height: 52,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: borderColor,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  color: inkColor,
                  fontFamily: "Inter-SemiBold",
                  fontSize: 15,
                }}
              >
                Cancel
              </Text>
            </View>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

function PermissionItem({
  heading,
  caption,
  inkColor,
  subtleColor,
  statusDoneColor,
}: {
  heading: string;
  caption: string;
  inkColor: string;
  subtleColor: string;
  statusDoneColor: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
      <View style={{ paddingTop: 2 }}>
        <CheckCircleIcon size={22} color={statusDoneColor} weight="fill" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body-em" style={{ color: inkColor }}>
          {heading}
        </Text>
        <Text variant="meta" style={{ color: subtleColor }}>
          {caption}
        </Text>
      </View>
    </View>
  );
}
