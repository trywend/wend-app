/**
 * Wend — SettingsSheet.
 *
 * The top-level settings sheet, raised by tapping the overflow icon in the
 * inbox header. Sits ABOVE the InboxSheet (z=50) at z=60, so opening it dims
 * the inbox behind it. Sections (top-to-bottom):
 *
 *   1. Profile     — avatar, name, email from the Clerk session.
 *   2. Subscription — the real plan. During alpha (paywalls disabled) this
 *      reads "Wend Pro · Alpha" with an honest note that billing isn't live.
 *   3. Connectivity — Mac, GitHub (cloud-gated), Linear. Ember accent bar.
 *   4. Cloud (gated) — dispatch mode, Anthropic key, repo access.
 *   5. Preferences — theme cycle, Wend on settle, Notifications.
 *   6. Account     — Log out, and a destructive Delete account action that
 *      calls user.delete() behind a native confirm.
 *
 * NativeWind 4 / Pressable gotcha — inside any Pressable whose `style` is a
 * function callback, layout/sizing utilities silently drop from className.
 * Every Pressable here keeps layout in inline `style` and the function form
 * carries only `opacity`. Static visuals live on parent Views.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Switch,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from "react-native-reanimated";
import { GestureDetector } from "react-native-gesture-handler";
import { Image } from "expo-image";
import {
  BellRingingIcon,
  CaretRightIcon,
  CoffeeIcon,
  CrosshairIcon,
  GithubLogoIcon,
  KanbanIcon,
  KeyIcon,
  LaptopIcon,
  MoonStarsIcon,
  SignOutIcon,
  StarIcon,
  TrashIcon,
  XIcon,
  type Icon as PhosphorIcon,
} from "phosphor-react-native";
import { fetch as expoFetch } from "expo/fetch";
import { useAuth, useUser } from "@clerk/clerk-expo";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import { useUiStore, type ThemePreference } from "@/store/uiSlice";
import { useDaemonStore } from "@/store/daemonSlice";
import { useResolvedDaemonURL } from "@/lib/dispatch/useResolvedDaemonURL";
import { useCloudStore } from "@/store/cloudSlice";
import { cloudEnabled } from "@/config/env";
import { useSubscriptionStore } from "@/store/subscriptionSlice";
import { useAndroidBack } from "@/lib/useAndroidBack";
import { useSheetDrag } from "@/lib/useSheetDrag";

/** Rendezvous backend that hosts the Linear OAuth routes. Kept inline
 *  for the same reason as in ConnectGitHubSheet — this file is in the
 *  touch-scope. Override via EXPO_PUBLIC_RENDEZVOUS_BASE for local dev. */
const SETTINGS_RENDEZVOUS_BASE =
  process.env.EXPO_PUBLIC_RENDEZVOUS_BASE ||
  "https://trywend.vercel.app";

export interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  onSignOut: () => void;
  onOpenIntegrations: () => void;
  /** Opens the camera-based QR scanner for pairing with Wend.app on a Mac. */
  onConnectMac: () => void;
  /** Opens the cloud-agent Anthropic key sheet. */
  onConnectAnthropic?: () => void;
  /** Opens the cloud-agent GitHub App install sheet. */
  onConnectCloudGitHub?: () => void;
  /** Retained for compatibility with the parent's wiring. No longer used —
   *  Profile and Subscription are real surfaces now. */
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
  onConnectAnthropic,
  onConnectCloudGitHub,
}: SettingsSheetProps) {
  const { user } = useUser();
  const anthropicConnected = useCloudStore((s) => s.anthropicConnected);
  const anthropicKeyLast4 = useCloudStore((s) => s.anthropicKeyLast4);
  const cloudGithubConnected = useCloudStore((s) => s.githubConnected);
  const subTier = useSubscriptionStore((s) => s.tier);
  const subStatus = useSubscriptionStore((s) => s.status);
  const subUsed = useSubscriptionStore((s) => s.cloudUsedThisMonth);
  const subQuota = useSubscriptionStore((s) => s.cloudQuotaTotal);
  const subPeriodEnd = useSubscriptionStore((s) => s.currentPeriodEnd);
  const subPaywallsOff = useSubscriptionStore((s) => s.paywallsDisabled);
  const cloudGithubLogin = useCloudStore((s) => s.githubLogin);
  const dispatchMode = useCloudStore((s) => s.dispatchMode);
  const setDispatchMode = useCloudStore((s) => s.setDispatchMode);
  // Android hardware back: close this sheet rather than exiting the app.
  // See src/lib/useAndroidBack.ts — listener is LIFO so stacked sheets
  // (e.g. IntegrationsSheet over this one) win first.
  useAndroidBack(true, onClose);
  const { pan, panelStyle, backdropStyle } = useSheetDrag(onClose);
  const { tokens } = useTheme();
  const preference = useUiStore((s) => s.themePreference);
  const setPreference = useUiStore((s) => s.setThemePreference);
  const notificationsEnabled = useUiStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useUiStore((s) => s.setNotificationsEnabled);
  const autoWendOnSettle = useUiStore((s) => s.autoWendOnSettle);
  const setAutoWendOnSettle = useUiStore((s) => s.setAutoWendOnSettle);

  const [deleting, setDeleting] = useState(false);

  // GitHub status now reflects the single Wend Cloud App install
  // (cloudGithubConnected/cloudGithubLogin above) — the same connection cloud
  // dispatch uses. The old per-user OAuth integration was retired; the Mac
  // path needs no GitHub auth (it runs in your real repo).

  // Mac pairing — live from the daemon slice. When `host` is set the user
  // has scanned a QR from Wend.app at least once. The subtitle shows the
  // friendly Mac name; tapping the row opens the scanner again to re-pair.
  const macHost = useDaemonStore((s) => s.host);
  const macConnected = macHost.length > 0;

  // -----------------------------------------------------------------
  // Keep-awake — the daemon holds an idle-sleep assertion while enabled.
  // We GET the live state when the sheet opens and POST changes. Mac-only:
  // the row is hidden when no Mac is paired. `keepAwake === null` means we
  // haven't loaded yet; the switch stays disabled until then. Toggling is
  // optimistic and reverts if the POST fails.
  // -----------------------------------------------------------------
  const resolvedDaemon = useResolvedDaemonURL();
  const [keepAwake, setKeepAwake] = useState<boolean | null>(null);
  const [keepAwakeBusy, setKeepAwakeBusy] = useState(false);

  useEffect(() => {
    if (!macConnected || !resolvedDaemon.isReady) return;
    let alive = true;
    (async () => {
      try {
        const target = `${resolvedDaemon.url.replace(/\/$/, "")}/keep-awake?t=${encodeURIComponent(
          resolvedDaemon.token,
        )}`;
        const res = await expoFetch(target, { method: "GET" });
        if (!res.ok) return;
        const body = (await res.json()) as { enabled?: boolean };
        if (alive && typeof body.enabled === "boolean") setKeepAwake(body.enabled);
      } catch {
        // best-effort — the row just stays in its loading state
      }
    })();
    return () => {
      alive = false;
    };
  }, [macConnected, resolvedDaemon.isReady, resolvedDaemon.url, resolvedDaemon.token]);

  const toggleKeepAwake = useCallback(async () => {
    if (keepAwake === null || keepAwakeBusy || !resolvedDaemon.isReady) return;
    const next = !keepAwake;
    setKeepAwake(next);
    setKeepAwakeBusy(true);
    try {
      const target = `${resolvedDaemon.url.replace(/\/$/, "")}/keep-awake?t=${encodeURIComponent(
        resolvedDaemon.token,
      )}`;
      const res = await expoFetch(target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) setKeepAwake(!next);
    } catch {
      setKeepAwake(!next);
    } finally {
      setKeepAwakeBusy(false);
    }
  }, [keepAwake, keepAwakeBusy, resolvedDaemon.isReady, resolvedDaemon.url, resolvedDaemon.token]);

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
  const chipBg = tokens["surface-chip"];
  const inkColor = tokens["text-primary"];
  const subtleColor = tokens["text-secondary"];
  const tertiaryColor = tokens["text-tertiary"];
  const borderColor = tokens["border-hairline"];
  const accent = tokens["accent-default"];
  const accentOn = tokens["accent-on"];
  const doneColor = tokens["status-done"];
  const warnColor = tokens["status-warn"];
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

  // -----------------------------------------------------------------
  // Delete account — the privacy policy promises real deletion, so this
  // calls Clerk's user.delete() behind an irreversible-warning confirm,
  // then hands off to the parent's sign-out to wipe local state + route.
  // -----------------------------------------------------------------
  const deleteAccount = useCallback(async () => {
    if (!user || deleting) return;
    setDeleting(true);
    try {
      await user.delete();
      onSignOut();
    } catch {
      setDeleting(false);
      Alert.alert(
        "Couldn't delete account",
        "Something went wrong. Try again, or reach us at agnij@trywend.app.",
      );
    }
  }, [user, deleting, onSignOut]);

  const confirmDeleteAccount = useCallback(() => {
    Alert.alert(
      "Delete account",
      "This permanently erases your Wend account and everything tied to it. It can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void deleteAccount(),
        },
      ],
    );
  }, [deleteAccount]);

  // Subscription display — honest for alpha, correct for the billed future.
  const alpha = subPaywallsOff;
  const planName = alpha
    ? "Wend Pro"
    : subTier === "pro"
      ? "Wend Pro"
      : subTier === "cloud_paygo"
        ? "Wend Cloud"
        : "Free";
  const planBadge: { label: string; color: string } = alpha
    ? { label: "Alpha", color: accent }
    : subTier === "free"
      ? { label: "Free", color: tertiaryColor }
      : subStatus === "active"
        ? { label: "Active", color: doneColor }
        : subStatus === "past_due"
          ? { label: "Past due", color: warnColor }
          : subStatus === "canceled"
            ? { label: "Canceled", color: failedColor }
            : { label: "Inactive", color: tertiaryColor };
  const planNote = alpha
    ? "Billing isn't live yet. Every Pro feature is unlocked during the alpha."
    : subTier === "free"
      ? "Editor only. Pair a Mac to dispatch a note."
      : buildPaidNote({
          tier: subTier,
          used: subUsed,
          quota: subQuota,
          periodEnd: subPeriodEnd,
        });

  const profileName = user?.fullName ?? null;
  const profileEmail = user?.primaryEmailAddress?.emailAddress ?? null;
  const profileImage = user?.imageUrl ?? null;

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
        style={[
          {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.22)",
          },
          backdropStyle,
        ]}
      >
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close settings"
          style={{ flex: 1 }}
        />
      </Animated.View>

      {/* Panel — same 88% height as InboxSheet so the stack looks consistent.
          Two layers: outer node owns the slide-in/out layout animation, inner
          node carries the gesture-driven drag transform (Fabric can't do both
          on one node). */}
      <Animated.View
        entering={SlideInDown.duration(260)}
        exiting={SlideOutDown.duration(220)}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "88%",
        }}
      >
        <Animated.View
          style={[
            {
              flex: 1,
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
            },
            panelStyle,
          ]}
        >
          {/* Drag handle + header — the pan-gesture surface. The list below
              scrolls independently so the two never compete. */}
          <GestureDetector gesture={pan}>
            <View>
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
            </View>
          </GestureDetector>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingTop: 8,
              paddingBottom: 40,
              gap: 24,
            }}
            showsVerticalScrollIndicator={false}
          >
            {/* -------------------- Profile -------------------- */}
            <ProfileHeader
              name={profileName}
              email={profileEmail}
              imageUrl={profileImage}
              cardBg={cardBg}
              chipBg={chipBg}
              borderColor={borderColor}
              inkColor={inkColor}
              subtleColor={subtleColor}
              accent={accent}
            />

            {/* -------------------- Subscription ---------------- */}
            <Section title="Subscription" subtleColor={subtleColor}>
              <SectionCard cardBg={cardBg} borderColor={borderColor}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 14,
                    paddingVertical: 14,
                  }}
                >
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 999,
                      backgroundColor: `${accent}1F`,
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 12,
                    }}
                  >
                    <StarIcon size={18} color={accent} weight="fill" />
                  </View>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text
                      style={{
                        color: inkColor,
                        fontFamily: "Inter-SemiBold",
                        fontSize: 15,
                        lineHeight: 20,
                      }}
                      numberOfLines={1}
                    >
                      {planName}
                    </Text>
                    <Text
                      style={{
                        color: subtleColor,
                        fontFamily: "Inter-Regular",
                        fontSize: 12,
                        lineHeight: 16,
                        marginTop: 2,
                      }}
                    >
                      {planNote}
                    </Text>
                  </View>
                  <StatusPip label={planBadge.label} color={planBadge.color} />
                </View>
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
                        <StatusPip label="Paired" color={doneColor} />
                      ) : (
                        <SmallButtonText label="Connect" color={accent} />
                      )
                    }
                  />
                  {cloudEnabled ? (
                    <>
                      <Divider color={borderColor} />
                      <Row
                        Icon={GithubLogoIcon}
                        label="GitHub"
                        subtitle={
                          cloudGithubConnected
                            ? `Installed · ${cloudGithubLogin ? `@${cloudGithubLogin}` : "your account"}`
                            : "Connect for cloud dispatch"
                        }
                        inkColor={inkColor}
                        subtleColor={subtleColor}
                        tertiaryColor={tertiaryColor}
                        onPress={onConnectCloudGitHub ?? (() => {})}
                        trailing={
                          cloudGithubConnected ? (
                            <StatusPip label="Active" color={doneColor} />
                          ) : (
                            <SmallButtonText label="Connect" color={accent} />
                          )
                        }
                      />
                    </>
                  ) : null}
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
                        <StatusPip label="Active" color={doneColor} />
                      ) : (
                        <SmallButtonText label="Connect" color={accent} />
                      )
                    }
                  />
                </View>
              </View>
            </Section>

            {/* -------------------- Cloud (optional) -------------
                Two opt-in connections that unlock cloud-dispatch as a
                fallback when no Mac is paired. Both are skippable; the
                Mac path keeps working without them. */}
            {cloudEnabled && (onConnectAnthropic || onConnectCloudGitHub) ? (
              <Section title="Cloud" subtleColor={subtleColor}>
                <SectionCard cardBg={cardBg} borderColor={borderColor}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      gap: 12,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontFamily: "Inter-SemiBold",
                          fontSize: 15,
                          color: inkColor,
                        }}
                      >
                        Dispatch mode
                      </Text>
                      <Text
                        style={{
                          marginTop: 2,
                          fontFamily: "Inter-Regular",
                          fontSize: 12,
                          color: subtleColor,
                        }}
                      >
                        {dispatchMode === "mac"
                          ? "Sends route to your paired Mac"
                          : "Sends spin up ephemeral cloud agents"}
                      </Text>
                    </View>
                    <View
                      style={{
                        flexDirection: "row",
                        borderWidth: 1,
                        borderColor: borderColor,
                        borderRadius: 8,
                        overflow: "hidden",
                      }}
                    >
                      {(["mac", "cloud"] as const).map((m) => {
                        const active = dispatchMode === m;
                        return (
                          <Pressable
                            key={m}
                            onPress={() => setDispatchMode(m)}
                            accessibilityLabel={`Set dispatch mode to ${m}`}
                            android_ripple={{ color: "rgba(0,0,0,0.08)" }}
                          >
                            <View
                              style={{
                                paddingHorizontal: 12,
                                paddingVertical: 6,
                                backgroundColor: active ? accent : "transparent",
                              }}
                            >
                              <Text
                                style={{
                                  fontFamily: "Inter-SemiBold",
                                  fontSize: 12,
                                  letterSpacing: 0.3,
                                  color: active ? accentOn : subtleColor,
                                  textTransform: "uppercase",
                                }}
                              >
                                {m}
                              </Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                  <Divider color={borderColor} />
                  {onConnectAnthropic ? (
                    <Row
                      Icon={KeyIcon}
                      label="Anthropic key"
                      subtitle={
                        anthropicConnected
                          ? anthropicKeyLast4
                            ? `Connected · sk-ant-…${anthropicKeyLast4}`
                            : "Connected · billed to your Anthropic account"
                          : "Required for cloud dispatches"
                      }
                      inkColor={inkColor}
                      subtleColor={subtleColor}
                      tertiaryColor={tertiaryColor}
                      onPress={onConnectAnthropic}
                      trailing={
                        anthropicConnected ? (
                          <StatusPip label="Set" color={doneColor} />
                        ) : (
                          <SmallButtonText label="Connect" color={accent} />
                        )
                      }
                    />
                  ) : null}
                  {onConnectAnthropic && onConnectCloudGitHub ? (
                    <Divider color={borderColor} />
                  ) : null}
                  {onConnectCloudGitHub ? (
                    <Row
                      Icon={GithubLogoIcon}
                      label="Repo access"
                      subtitle={
                        cloudGithubConnected
                          ? `Wend Cloud installed · ${cloudGithubLogin ? "@" + cloudGithubLogin : "active"}`
                          : "Optional · install the read-only GitHub App"
                      }
                      inkColor={inkColor}
                      subtleColor={subtleColor}
                      tertiaryColor={tertiaryColor}
                      onPress={onConnectCloudGitHub}
                      trailing={
                        cloudGithubConnected ? (
                          <StatusPip label="Set" color={doneColor} />
                        ) : (
                          <SmallButtonText label="Connect" color={accent} />
                        )
                      }
                    />
                  ) : null}
                </SectionCard>
              </Section>
            ) : null}

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
                {macConnected ? (
                  <>
                    <Divider color={borderColor} />
                    <Row
                      Icon={CoffeeIcon}
                      label="Keep my Mac awake"
                      subtitle="Prevents your Mac idle-sleeping so notes run while you're away. Closing the lid on battery still sleeps."
                      subtitleLines={3}
                      inkColor={inkColor}
                      subtleColor={subtleColor}
                      tertiaryColor={tertiaryColor}
                      trailing={
                        <Switch
                          value={keepAwake ?? false}
                          onValueChange={() => void toggleKeepAwake()}
                          disabled={keepAwake === null || keepAwakeBusy}
                          trackColor={{ false: borderColor, true: accent }}
                          thumbColor={accentOn}
                        />
                      }
                      onPress={() => void toggleKeepAwake()}
                      hideCaret
                    />
                  </>
                ) : null}
                <Divider color={borderColor} />
                <Row
                  Icon={CrosshairIcon}
                  label="Wend on settle"
                  subtitle="Fire when a thought lands. Off = tap to Wend."
                  inkColor={inkColor}
                  subtleColor={subtleColor}
                  tertiaryColor={tertiaryColor}
                  trailing={
                    <Switch
                      value={autoWendOnSettle}
                      onValueChange={setAutoWendOnSettle}
                      trackColor={{ false: borderColor, true: accent }}
                      thumbColor={accentOn}
                    />
                  }
                  onPress={() => setAutoWendOnSettle(!autoWendOnSettle)}
                  hideCaret
                />
                <Divider color={borderColor} />
                <Row
                  Icon={BellRingingIcon}
                  label="Notifications"
                  subtitle="Mentions and assignments only"
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

            {/* -------------------- Account (destructive) --------
                Log out is the primary action; Delete account sits below it
                as a quieter, clearly irreversible affordance. Both use the
                wrapper-View pattern so cssInterop can't strip layout off the
                function-form Pressable. */}
            <Section title="Account" subtleColor={subtleColor}>
              <View style={{ gap: 12 }}>
                <Pressable
                  onPress={onSignOut}
                  accessibilityRole="button"
                  accessibilityLabel="Log out"
                  android_ripple={{ color: "rgba(0,0,0,0.06)" }}
                  style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
                >
                  <View
                    style={{
                      height: 52,
                      borderRadius: 14,
                      backgroundColor: cardBg,
                      borderWidth: 1,
                      borderColor: borderColor,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 10,
                    }}
                  >
                    <SignOutIcon size={18} color={inkColor} weight="regular" />
                    <Text
                      style={{
                        color: inkColor,
                        fontFamily: "Inter-SemiBold",
                        fontSize: 15,
                      }}
                    >
                      Log out
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  onPress={confirmDeleteAccount}
                  disabled={deleting}
                  accessibilityRole="button"
                  accessibilityLabel="Delete account"
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <View
                    style={{
                      height: 44,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      opacity: deleting ? 0.5 : 1,
                    }}
                  >
                    {deleting ? (
                      <ActivityIndicator color={failedColor} size="small" />
                    ) : (
                      <TrashIcon size={15} color={failedColor} weight="regular" />
                    )}
                    <Text
                      style={{
                        color: failedColor,
                        fontFamily: "Inter-Medium",
                        fontSize: 13,
                      }}
                    >
                      {deleting ? "Deleting account…" : "Delete account"}
                    </Text>
                  </View>
                </Pressable>
                <Text
                  style={{
                    color: tertiaryColor,
                    fontFamily: "Inter-Regular",
                    fontSize: 11,
                    lineHeight: 15,
                    textAlign: "center",
                    paddingHorizontal: 24,
                  }}
                >
                  Deleting your account erases it permanently. This can't be
                  undone.
                </Text>
              </View>
            </Section>
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/* ---------------------------------------------------------------------------
   Section primitives — small private helpers, only used by this sheet.
   --------------------------------------------------------------------------- */

function buildPaidNote({
  tier,
  used,
  quota,
  periodEnd,
}: {
  tier: "free" | "pro" | "cloud_paygo";
  used: number;
  quota: number;
  periodEnd: string | null;
}): string {
  const parts: string[] = [];
  if (tier === "pro") parts.push("Mac dispatch included.");
  if (cloudEnabled && quota > 0)
    parts.push(`${used}/${quota} cloud dispatches this month.`);
  if (periodEnd) {
    const d = new Date(periodEnd);
    if (!Number.isNaN(d.getTime())) {
      parts.push(
        `Renews ${d.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}.`,
      );
    }
  }
  return parts.length ? parts.join(" ") : "Subscription active.";
}

function ProfileHeader({
  name,
  email,
  imageUrl,
  cardBg,
  chipBg,
  borderColor,
  inkColor,
  subtleColor,
  accent,
}: {
  name: string | null;
  email: string | null;
  imageUrl: string | null;
  cardBg: string;
  chipBg: string;
  borderColor: string;
  inkColor: string;
  subtleColor: string;
  accent: string;
}) {
  const initial =
    (name ?? email ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        backgroundColor: cardBg,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: borderColor,
        padding: 16,
      }}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          overflow: "hidden",
          backgroundColor: chipBg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={{ width: 52, height: 52 }}
            contentFit="cover"
            transition={120}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Text
            style={{
              fontFamily: "Inter-SemiBold",
              fontSize: 22,
              color: accent,
            }}
          >
            {initial}
          </Text>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: inkColor,
            fontFamily: "Inter-SemiBold",
            fontSize: 17,
            lineHeight: 22,
          }}
          numberOfLines={1}
        >
          {name ?? "Your account"}
        </Text>
        {email ? (
          <Text
            style={{
              color: subtleColor,
              fontFamily: "Inter-Regular",
              fontSize: 13,
              lineHeight: 18,
              marginTop: 2,
            }}
            numberOfLines={1}
          >
            {email}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

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
  /** Lines the subtitle may wrap to. Defaults to 1 (single-line rows). */
  subtitleLines?: number;
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
  subtitleLines = 1,
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
        minHeight: 56,
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
            numberOfLines={subtitleLines}
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
