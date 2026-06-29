/**
 * Wend — IntegrationsSheet.
 *
 * Stacks on top of SettingsSheet (z=70). Shows the full integration cards
 * with their detailed state. Two integrations:
 *
 *   - GitHub — status reflects the single Wend Cloud App install (the same
 *     connection cloud dispatch uses). Tap "Connect" to open the cloud install
 *     flow. The old per-user OAuth integration was retired; the Mac path needs
 *     no GitHub auth (it runs in your real repo).
 *   - Linear — visual-only toggle persisted in useUiStore.linearConnected.
 *     Always shows the toggle; no destination sheet yet.
 *
 * Top app bar is a back-arrow + title (the IntegrationsSheet is one level
 * deeper than SettingsSheet, so back goes back rather than X-closing).
 *
 * Cards use the "glass-card" pattern from the founder's HTML mock — a
 * surface-elevated background with the hairline border. Founder also
 * specified a small info card at the bottom explaining the privacy posture.
 */
import { Pressable, ScrollView, Switch, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from "react-native-reanimated";
import {
  ArrowLeftIcon,
  GithubLogoIcon,
  KanbanIcon,
  type Icon as PhosphorIcon,
} from "phosphor-react-native";
import { useCloudStore } from "@/store/cloudSlice";
import { cloudEnabled } from "@/config/env";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import { useUiStore } from "@/store/uiSlice";
import { useAndroidBack } from "@/lib/useAndroidBack";

export interface IntegrationsSheetProps {
  open: boolean;
  onClose: () => void;
  onConnectGitHub: () => void;
}

export function IntegrationsSheet(
  props: IntegrationsSheetProps,
): React.JSX.Element | null {
  if (!props.open) return null;
  return <IntegrationsSheetMounted {...props} />;
}

function IntegrationsSheetMounted({
  onClose,
  onConnectGitHub,
}: IntegrationsSheetProps) {
  // Android hardware back closes this sheet (stacked above SettingsSheet).
  useAndroidBack(true, onClose);
  const { tokens } = useTheme();
  const linearConnected = useUiStore((s) => s.linearConnected);
  const setLinearConnected = useUiStore((s) => s.setLinearConnected);

  // GitHub status = the single Wend Cloud App install (same connection cloud
  // dispatch uses). The old per-user OAuth integration was retired.
  const githubConnected = useCloudStore((s) => s.githubConnected);
  const githubHandle = useCloudStore((s) => s.githubLogin);

  const canvasBg = tokens["surface-canvas"];
  const cardBg = tokens["surface-elevated"];
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
        zIndex: 70,
      }}
      pointerEvents="box-none"
    >
      {/* Backdrop. */}
      <Animated.View
        entering={FadeIn.duration(220)}
        exiting={FadeOut.duration(180)}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.22)",
        }}
      >
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Back to settings"
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
          height: "88%",
          backgroundColor: canvasBg,
          borderTopLeftRadius: 32,
          borderTopRightRadius: 32,
          borderWidth: 1,
          borderColor: borderColor,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -8 },
          shadowOpacity: 0.08,
          shadowRadius: 32,
          elevation: 12,
          overflow: "hidden",
        }}
      >
        {/* Drag handle. */}
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

        {/* Top app bar: back arrow + title. */}
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={8}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ArrowLeftIcon size={22} color={inkColor} weight="regular" />
          </Pressable>
          <Text variant="title" style={{ color: inkColor }}>
            Integrations
          </Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: 32,
            gap: 16,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* GitHub card — cloud-only (the Wend Cloud App install). Hidden
              while cloud is feature-gated off. */}
          {cloudEnabled ? (
            <IntegrationCard
              Icon={GithubLogoIcon}
              name="GitHub"
              connected={githubConnected}
              connectedDetail={githubHandle ? `@${githubHandle}` : null}
              cardBg={cardBg}
              borderColor={borderColor}
              inkColor={inkColor}
              subtleColor={subtleColor}
              tertiaryColor={tertiaryColor}
              chipBg={chipBg}
              statusDoneColor={statusDoneColor}
              accent={accent}
              onConnect={onConnectGitHub}
              onConfigure={() => {
                // Configure flow not yet built — falls through to ConnectGitHub
                // for now (it explains what we'd ask for).
                onConnectGitHub();
              }}
            />
          ) : null}

          {/* Linear card — toggle-only. */}
          <View
            style={{
              backgroundColor: cardBg,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: borderColor,
              padding: 16,
              flexDirection: "row",
              alignItems: "center",
              gap: 16,
            }}
          >
            <IconTile Icon={KanbanIcon} tileBg={chipBg} iconColor={inkColor} />
            <View style={{ flex: 1 }}>
              <Text variant="body-em" style={{ color: inkColor }}>
                Linear
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 4,
                }}
              >
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    backgroundColor: linearConnected
                      ? statusDoneColor
                      : tertiaryColor,
                  }}
                />
                <Text variant="meta" style={{ color: subtleColor }}>
                  {linearConnected ? "Connected" : "Not Connected"}
                </Text>
              </View>
            </View>
            <Switch
              value={linearConnected}
              onValueChange={setLinearConnected}
              trackColor={{ false: borderColor, true: accent }}
              thumbColor="#FFFFFF"
            />
          </View>

          {/* Footer info card — what these do + a stub policy link. */}
          <View
            style={{
              backgroundColor: chipBg,
              borderRadius: 12,
              padding: 14,
              marginTop: 8,
            }}
          >
            <Text variant="meta" style={{ color: subtleColor }}>
              Integrations let Wend surface relevant code, issues, and tickets
              while you write. We only request read scopes and never store
              your source. See our{" "}
              <Text variant="meta" style={{ color: accent }}>
                security policy
              </Text>
              .
            </Text>
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

/* ---------------------------------------------------------------------------
   IntegrationCard — GitHub-shaped card with status pip + action button.
   --------------------------------------------------------------------------- */

interface IntegrationCardProps {
  Icon: PhosphorIcon;
  name: string;
  connected: boolean;
  connectedDetail: string | null;
  cardBg: string;
  borderColor: string;
  inkColor: string;
  subtleColor: string;
  tertiaryColor: string;
  chipBg: string;
  statusDoneColor: string;
  accent: string;
  onConnect: () => void;
  onConfigure: () => void;
}

function IntegrationCard({
  Icon,
  name,
  connected,
  connectedDetail,
  cardBg,
  borderColor,
  inkColor,
  subtleColor,
  tertiaryColor,
  chipBg,
  statusDoneColor,
  accent,
  onConnect,
  onConfigure,
}: IntegrationCardProps) {
  return (
    <View
      style={{
        backgroundColor: cardBg,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: borderColor,
        padding: 16,
        gap: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        <IconTile Icon={Icon} tileBg={chipBg} iconColor={inkColor} />
        <View style={{ flex: 1 }}>
          <Text variant="body-em" style={{ color: inkColor }}>
            {name}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginTop: 4,
            }}
          >
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                backgroundColor: connected ? statusDoneColor : tertiaryColor,
              }}
            />
            <Text variant="meta" style={{ color: subtleColor }}>
              {connected ? "Connected" : "Not Connected"}
            </Text>
          </View>
        </View>
        {connected && connectedDetail ? (
          <Text variant="mono-inline" style={{ color: subtleColor }}>
            {connectedDetail}
          </Text>
        ) : null}
      </View>

      {/* Action button row. Outlined "Configure" when connected; filled
          "Connect" when not. Both use the wrapper-View pattern so NativeWind
          can't strip backgrounds on the function-form Pressable style. */}
      {connected ? (
        <View
          style={{
            height: 40,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: borderColor,
            overflow: "hidden",
          }}
        >
          <Pressable
            onPress={onConfigure}
            accessibilityRole="button"
            accessibilityLabel={`Configure ${name}`}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <View
              style={{
                paddingHorizontal: 14,
                paddingVertical: 10,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text variant="meta" style={{ color: inkColor }}>
                Configure
              </Text>
            </View>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={onConnect}
          accessibilityRole="button"
          accessibilityLabel={`Connect ${name}`}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        >
          <View
            style={{
              height: 40,
              paddingHorizontal: 18,
              borderRadius: 10,
              backgroundColor: accent,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text variant="meta" style={{ color: "#FFFFFF" }}>
              Connect
            </Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}

function IconTile({
  Icon,
  tileBg,
  iconColor,
}: {
  Icon: PhosphorIcon;
  tileBg: string;
  iconColor: string;
}) {
  return (
    <View
      style={{
        width: 44,
        height: 44,
        borderRadius: 10,
        backgroundColor: tileBg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon size={24} color={iconColor} weight="regular" />
    </View>
  );
}
