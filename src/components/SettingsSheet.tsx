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
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, View } from "react-native";
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
  LaptopIcon,
  MoonStarsIcon,
  SignOutIcon,
  UserIcon,
  XIcon,
  type Icon as PhosphorIcon,
} from "phosphor-react-native";
import { useAuth, useUser } from "@clerk/clerk-expo";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import { useUiStore, type ThemePreference } from "@/store/uiSlice";
import { useDaemonStore } from "@/store/daemonSlice";
import { useAndroidBack } from "@/lib/useAndroidBack";

/** Rendezvous backend that hosts the Linear OAuth routes. Kept inline
 *  for the same reason as in ConnectGitHubSheet — this file is in the
 *  touch-scope. Override via EXPO_PUBLIC_RENDEZVOUS_BASE for local dev. */
const SETTINGS_RENDEZVOUS_BASE =
  process.env.EXPO_PUBLIC_RENDEZVOUS_BASE ||
  "https://wend-landing.vercel.app";

export interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  onSignOut: () => void;
  onOpenIntegrations: () => void;
  /** Opens the camera-based QR scanner for pairing with Wend.app on a Mac. */
  onConnectMac: () => void;
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
  onConnectMac,
  onShowComingSoon,
}: SettingsSheetProps) {
  // Android hardware back: close this sheet rather than exiting the app.
  // See src/lib/useAndroidBack.ts — listener is LIFO so stacked sheets
  // (e.g. IntegrationsSheet over this one) win first.
  useAndroidBack(true, onClose);
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

  // Mac pairing — live from the daemon slice. When `host` is set the user
  // has scanned a QR from Wend.app at least once. The subtitle shows the
  // friendly Mac name; tapping the row opens the scanner again to re-pair.
  const macHost = useDaemonStore((s) => s.host);
  const macConnected = macHost.length > 0;

  // -----------------------------------------------------------------
  // Linear connection state — driven by GET /api/integrations/list.
  // We refetch when the sheet mounts and after the user returns from
  // the OAuth in-app browser. `linearStatus === null` means we haven't
  // loaded yet — the row shows a quiet "Checking…" until then.
  // -----------------------------------------------------------------
  const { getToken } = useAuth();
  const [linearStatus, setLinearStatus] = useState<{
    connected: boolean;
    accountLabel: string | null;
  } | null>(null);
  const [linearBusy, setLinearBusy] = useState<boolean>(false);

  const refetchLinearStatus = useCallback(async () => {
    try {
      const jwt = await getToken();
      if (!jwt) {
        setLinearStatus({ connected: false, accountLabel: null });
        return;
      }
      const res = await fetch(
        `${SETTINGS_RENDEZVOUS_BASE}/api/integrations/list`,
        { headers: { Authorization: `Bearer ${jwt}` } },
      );
      if (!res.ok) {
        setLinearStatus({ connected: false, accountLabel: null });
        return;
      }
      const body = (await res.json()) as {
        linear?: { connected: boolean; accountLabel: string | null };
      };
      setLinearStatus({
        connected: body.linear?.connected ?? false,
        accountLabel: body.linear?.accountLabel ?? null,
      });
    } catch {
      // Network error — best-effort. We'll re-fetch on the next mount.
      setLinearStatus({ connected: false, accountLabel: null });
    }
  }, [getToken]);

  useEffect(() => {
    void refetchLinearStatus();
  }, [refetchLinearStatus]);

  /** Open the Linear OAuth flow in the system in-app browser, then
   *  refetch the status when the user returns. The init route is
   *  Clerk-authed — we pass the JWT via `?t=` so the in-app browser
   *  doesn't need to attach Bearer headers across the linear.app
   *  redirect. */
  const connectLinear = useCallback(async () => {
    setLinearBusy(true);
    try {
      const jwt = await getToken();
      if (!jwt) return;
      const url = `${SETTINGS_RENDEZVOUS_BASE}/api/integrations/linear/init?t=${encodeURIComponent(jwt)}`;
      const returnUrl = Linking.createURL("/integrations");
      const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
      if (result.type === "success") {
        await refetchLinearStatus();
      }
    } catch {
      // Swallow — same shape as connectMac flow. The user can retry.
    } finally {
      setLinearBusy(false);
    }
  }, [getToken, refetchLinearStatus]);

  const disconnectLinear = useCallback(async () => {
    setLinearBusy(true);
    try {
      const jwt = await getToken();
      if (!jwt) return;
      await fetch(
        `${SETTINGS_RENDEZVOUS_BASE}/api/integrations/linear/disconnect`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${jwt}` },
        },
      );
      await refetchLinearStatus();
    } catch {
      // see connectLinear
    } finally {
      setLinearBusy(false);
    }
  }, [getToken, refetchLinearStatus]);

  /** Tap handler — connect if not connected, disconnect if connected.
   *  Pressed twice in fast succession is a no-op while `linearBusy`
   *  gates re-entry. */
  const onLinearRowPress = useCallback(() => {
    if (linearBusy) return;
    if (linearStatus?.connected) {
      void disconnectLinear();
    } else {
      void connectLinear();
    }
  }, [linearBusy, linearStatus?.connected, connectLinear, disconnectLinear]);

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
                {/* Mac — first because it's the core integration. */}
                <Row
                  Icon={LaptopIcon}
                  label="Mac"
                  subtitle={
                    macConnected
                      ? `Paired with ${macHost}`
                      : "Scan the QR from Wend.app"
                  }
                  inkColor={inkColor}
                  subtleColor={subtleColor}
                  tertiaryColor={tertiaryColor}
                  onPress={onConnectMac}
                  trailing={
                    macConnected ? (
                      <StatusPip
                        label="Paired"
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
                  subtitle={
                    linearStatus == null
                      ? "Checking…"
                      : linearStatus.connected
                        ? `Active · ${linearStatus.accountLabel ?? "Connected"}`
                        : "Connect workspace"
                  }
                  inkColor={inkColor}
                  subtleColor={subtleColor}
                  tertiaryColor={tertiaryColor}
                  onPress={onLinearRowPress}
                  trailing={
                    linearBusy ? (
                      <ActivityIndicator color={subtleColor} />
                    ) : linearStatus?.connected ? (
                      <StatusPip
                        label="Active"
                        color={tokens["status-done"]}
                      />
                    ) : (
                      <SmallButtonText label="Connect" color={accent} />
                    )
                  }
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
