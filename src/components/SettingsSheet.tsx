/**
 * Wend — SettingsSheet.
 *
 * The top-level settings sheet, raised by tapping the overflow icon in the
 * inbox header. Sits ABOVE the InboxSheet (z=50) at z=60, so opening it dims
 * the inbox behind it. Sections (top-to-bottom):
 *
 *   1. Account    — Profile, Subscription (both stubs for now)
 *   2. Connectivity — GitHub (live if Clerk session was created via GitHub
 *      OAuth), Linear (always "Connect"). Highlighted with an ember accent
 *      bar on the left edge. Any row in this section opens IntegrationsSheet.
 *   3. Preferences — Theme (cycles light→dark→system), Notifications (visual
 *      toggle persisted in useUiStore.notificationsEnabled).
 *
 * Bottom: a red destructive "Log out" button that invokes the onSignOut prop.
 *
 * Same modal-stack pattern as InboxSheet — return null when closed; mount-
 * gated so the SlideInDown/SlideOutDown entrance fires on every open. No drag-
 * to-dismiss for these (header X covers it, tap-outside covers the rest).
 *
 * NativeWind 4 / Pressable gotcha — see InboxSheet's FAB. We use simple
 * `({pressed}) => ({opacity})` callbacks here without ever putting a
 * backgroundColor inside the function form. Static visuals (card bg, borders,
 * tints) live on parent Views.
 */
import { Pressable, ScrollView, Switch, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from "react-native-reanimated";
import {
  BellRingingIcon,
  CaretRightIcon,
  CreditCardIcon,
  GithubLogoIcon,
  KanbanIcon,
  MoonStarsIcon,
  SignOutIcon,
  UserIcon,
  XIcon,
  type Icon as PhosphorIcon,
} from "phosphor-react-native";
import { useUser } from "@clerk/clerk-expo";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import { useUiStore, type ThemePreference } from "@/store/uiSlice";

export interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  onSignOut: () => void;
  onOpenIntegrations: () => void;
  /** Optional handler for not-yet-built destinations (Profile, Subscription).
   *  The parent renders a toast / no-op. */
  onShowComingSoon?: (label: string) => void;
}

export function SettingsSheet(
  props: SettingsSheetProps,
): React.JSX.Element | null {
  if (!props.open) return null;
  return <SettingsSheetMounted {...props} />;
}

function SettingsSheetMounted({
  onClose,
  onSignOut,
  onOpenIntegrations,
  onShowComingSoon,
}: SettingsSheetProps) {
  const { tokens } = useTheme();
  const preference = useUiStore((s) => s.themePreference);
  const setPreference = useUiStore((s) => s.setThemePreference);
  const notificationsEnabled = useUiStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useUiStore((s) => s.setNotificationsEnabled);

  // -----------------------------------------------------------------
  // GitHub connectivity status — driven by Clerk's externalAccounts.
  // We only treat the user as "connected via GitHub" if their session has a
  // verified github external account. The username comes from that account;
  // we fall back to the primary email when missing (rare but possible).
  // -----------------------------------------------------------------
  const { user } = useUser();
  const githubAccount = user?.externalAccounts?.find(
    (a) => a.provider === "github",
  );
  const githubConnected = githubAccount != null;
  const githubLabel = githubConnected
    ? githubAccount?.username ?? user?.primaryEmailAddress?.emailAddress ?? "Connected"
    : null;

  const canvasBg = tokens["surface-canvas"];
  const cardBg = tokens["surface-elevated"];
  const inkColor = tokens["text-primary"];
  const subtleColor = tokens["text-secondary"];
  const tertiaryColor = tokens["text-tertiary"];
  const borderColor = tokens["border-hairline"];
  const accent = tokens["accent-default"];
  const accentOn = tokens["accent-on"];
  const failedColor = tokens["status-failed"];

  function cycleTheme() {
    const next: ThemePreference =
      preference === "light"
        ? "dark"
        : preference === "dark"
          ? "system"
          : "light";
    setPreference(next);
  }
  const themeSubtitle =
    preference === "light"
      ? "Light"
      : preference === "dark"
        ? "Dark"
        : "System default";

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 60,
      }}
      pointerEvents="box-none"
    >
      {/* Backdrop dim — slightly deeper than InboxSheet's so the stack reads. */}
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
          accessibilityLabel="Close settings"
          style={{ flex: 1 }}
        />
      </Animated.View>

      {/* Panel — same 88% height as InboxSheet so the stack looks consistent. */}
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
        {/* Drag handle (decorative — no pan gesture on this sheet). */}
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

        {/* Header. */}
        <View
          style={{
            paddingHorizontal: 24,
            paddingVertical: 8,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Text variant="title" style={{ color: inkColor }}>
            Settings
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
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

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: 32,
            gap: 24,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* -------------------- Account -------------------- */}
          <Section title="Account" subtleColor={subtleColor}>
            <SectionCard cardBg={cardBg} borderColor={borderColor}>
              <Row
                Icon={UserIcon}
                label="Profile"
                inkColor={inkColor}
                subtleColor={subtleColor}
                tertiaryColor={tertiaryColor}
                onPress={() => onShowComingSoon?.("Profile")}
              />
              <Divider color={borderColor} />
              <Row
                Icon={CreditCardIcon}
                label="Subscription"
                subtitle="BYO Anthropic key · $15/mo"
                inkColor={inkColor}
                subtleColor={subtleColor}
                tertiaryColor={tertiaryColor}
                onPress={() => onShowComingSoon?.("Subscription")}
              />
            </SectionCard>
          </Section>

          {/* -------------------- Connectivity ----------------
              Highlighted with an ember accent bar on the left edge of the
              card. Title is tappable too — it opens IntegrationsSheet, which
              is the full-control surface for these connections. */}
          <Section
            title="Connectivity"
            subtleColor={subtleColor}
            accentTint={accent}
            onTitlePress={onOpenIntegrations}
          >
            <View
              style={{
                flexDirection: "row",
                borderRadius: 14,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: borderColor,
                backgroundColor: cardBg,
              }}
            >
              {/* Accent bar */}
              <View style={{ width: 3, backgroundColor: accent }} />
              <View style={{ flex: 1 }}>
                <Row
                  Icon={GithubLogoIcon}
                  label="GitHub"
                  subtitle={
                    githubConnected
                      ? `Active · ${githubLabel ?? ""}`
                      : "Not connected"
                  }
                  inkColor={inkColor}
                  subtleColor={subtleColor}
                  tertiaryColor={tertiaryColor}
                  onPress={onOpenIntegrations}
                  trailing={
                    githubConnected ? (
                      <StatusPip
                        label="Active"
                        color={tokens["status-done"]}
                      />
                    ) : (
                      <SmallButtonText
                        label="Connect"
                        color={accent}
                      />
                    )
                  }
                />
                <Divider color={borderColor} />
                <Row
                  Icon={KanbanIcon}
                  label="Linear"
                  subtitle="Connect workspace"
                  inkColor={inkColor}
                  subtleColor={subtleColor}
                  tertiaryColor={tertiaryColor}
                  onPress={onOpenIntegrations}
                />
              </View>
            </View>
          </Section>

          {/* -------------------- Preferences ----------------- */}
          <Section title="Preferences" subtleColor={subtleColor}>
            <SectionCard cardBg={cardBg} borderColor={borderColor}>
              <Row
                Icon={MoonStarsIcon}
                label="Theme"
                subtitle={themeSubtitle}
                inkColor={inkColor}
                subtleColor={subtleColor}
                tertiaryColor={tertiaryColor}
                onPress={cycleTheme}
              />
              <Divider color={borderColor} />
              <Row
                Icon={BellRingingIcon}
                label="Notifications"
                subtitle="Mentions & assignments only"
                inkColor={inkColor}
                subtleColor={subtleColor}
                tertiaryColor={tertiaryColor}
                trailing={
                  <Switch
                    value={notificationsEnabled}
                    onValueChange={setNotificationsEnabled}
                    trackColor={{ false: borderColor, true: accent }}
                    thumbColor={accentOn}
                  />
                }
                // The switch is the only interactive piece; tapping the row
                // itself toggles too, which matches platform expectation.
                onPress={() => setNotificationsEnabled(!notificationsEnabled)}
                hideCaret
              />
            </SectionCard>
          </Section>

          {/* -------------------- Log out (destructive) --------
              Pressable wraps content; function-style only carries opacity.
              All visual + layout (red bg, height, row centering, shadow)
              lives on a static-style inner View so cssInterop can't strip
              it. Same proven pattern as the Row above. */}
          <Pressable
            onPress={onSignOut}
            accessibilityRole="button"
            accessibilityLabel="Log out"
            android_ripple={{ color: "rgba(255,255,255,0.18)" }}
            style={({ pressed }) => ({
              marginTop: 8,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <View
              style={{
                height: 52,
                borderRadius: 14,
                backgroundColor: failedColor,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.12,
                shadowRadius: 6,
                elevation: 2,
              }}
            >
              <SignOutIcon size={20} color="#FFFFFF" weight="bold" />
              <Text
                style={{
                  color: "#FFFFFF",
                  marginLeft: 10,
                  fontFamily: "Inter-SemiBold",
                  fontSize: 15,
                }}
              >
                Log out
              </Text>
            </View>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

/* ---------------------------------------------------------------------------
   Section primitives — small private helpers, only used by this sheet.
   --------------------------------------------------------------------------- */

function Section({
  title,
  subtleColor,
  accentTint,
  onTitlePress,
  children,
}: {
  title: string;
  subtleColor: string;
  accentTint?: string;
  onTitlePress?: () => void;
  children: React.ReactNode;
}) {
  // When accentTint is set we color the title with the ember to signal
  // "this section is special / connectable".
  const titleColor = accentTint ?? subtleColor;
  const TitleEl = (
    <Text
      variant="caption"
      style={{
        color: titleColor,
        textTransform: "uppercase",
        letterSpacing: 1,
      }}
    >
      {title}
    </Text>
  );
  return (
    <View style={{ gap: 8 }}>
      <View style={{ paddingHorizontal: 4 }}>
        {onTitlePress ? (
          <Pressable
            onPress={onTitlePress}
            accessibilityRole="button"
            hitSlop={6}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            {TitleEl}
          </Pressable>
        ) : (
          TitleEl
        )}
      </View>
      {children}
    </View>
  );
}

function SectionCard({
  cardBg,
  borderColor,
  children,
}: {
  cardBg: string;
  borderColor: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        backgroundColor: cardBg,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: borderColor,
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}

function Divider({ color }: { color: string }) {
  return (
    <View
      style={{
        height: 1,
        backgroundColor: color,
        marginLeft: 56, // align with text column (icon + gap)
      }}
    />
  );
}

interface RowProps {
  Icon: PhosphorIcon;
  label: string;
  subtitle?: string;
  inkColor: string;
  subtleColor: string;
  tertiaryColor: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
  hideCaret?: boolean;
}

function Row({
  Icon,
  label,
  subtitle,
  inkColor,
  subtleColor,
  tertiaryColor,
  onPress,
  trailing,
  hideCaret,
}: RowProps) {
  // Pattern: Pressable WRAPS content. Function-style only carries `opacity`
  // (single non-layout prop, safe with cssInterop). All visual + layout lives
  // on the static-style inner View. Earlier attempts used an absolute-fill
  // Pressable overlay with `position: "absolute"` inside the function-style
  // — cssInterop stripped the positioning, so the overlay collapsed to inline
  // 0×0 and no tap registered.
  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 999,
          backgroundColor: `${subtleColor}14`, // ~8% alpha tint
          alignItems: "center",
          justifyContent: "center",
          marginRight: 12,
        }}
      >
        <Icon size={18} color={subtleColor} weight="regular" />
      </View>
      <View style={{ flex: 1, paddingRight: 8 }}>
        <Text
          style={{
            color: inkColor,
            fontFamily: "Inter-Medium",
            fontSize: 15,
            lineHeight: 20,
          }}
          numberOfLines={1}
        >
          {label}
        </Text>
        {subtitle ? (
          <Text
            style={{
              color: subtleColor,
              fontFamily: "Inter-Regular",
              fontSize: 12,
              lineHeight: 16,
              marginTop: 1,
            }}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {trailing == null && !hideCaret && onPress ? (
        <CaretRightIcon size={14} color={tertiaryColor} weight="bold" />
      ) : null}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: `${subtleColor}22` }}
      style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
    >
      {content}
    </Pressable>
  );
}

function StatusPip({ label, color }: { label: string; color: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: `${color}1F`, // ~12% alpha tint
      }}
    >
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          backgroundColor: color,
        }}
      />
      <Text variant="caption" style={{ color: color }}>
        {label}
      </Text>
    </View>
  );
}

function SmallButtonText({ label, color }: { label: string; color: string }) {
  return (
    <Text variant="meta" style={{ color }}>
      {label}
    </Text>
  );
}
