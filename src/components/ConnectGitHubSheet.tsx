/**
 * Wend — ConnectGitHubSheet.
 *
 * Third level of the settings modal stack (z=80). Smaller than the parents —
 * about 60% of screen height — because it's a focused confirmation surface,
 * not a list.
 *
 * Phase 3: this sheet is now a live OAuth surface, not a stub. On mount it
 * calls `GET /api/integrations/list` with the Clerk JWT to see whether the
 * user has already connected GitHub. State machine:
 *
 *   "loading"      — first paint while the list fetch is in flight.
 *   "disconnected" — show Authorize + Cancel buttons.
 *   "connected"    — show "Connected as @handle" + Disconnect + Done.
 *
 * Authorize launches the rendezvous-hosted OAuth init route inside
 * `expo-web-browser`. The backend's callback page deep-links back to
 * `wend://integrations`, which closes the browser and resolves
 * `openAuthSessionAsync`. We then re-run the list fetch to learn the new
 * status. Disconnect hits POST /api/integrations/github/disconnect and then
 * re-runs the list fetch.
 *
 * Auth: we use `useAuth().getToken()` from @clerk/clerk-expo to mint a
 * short-lived JWT for the backend on every fetch. The token never lands in
 * persistent state.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
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
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { useAuth } from "@clerk/clerk-expo";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import { useAndroidBack } from "@/lib/useAndroidBack";

export interface ConnectGitHubSheetProps {
  open: boolean;
  onClose: () => void;
  /** Legacy hook from the v0 stub. Still called after a successful
   *  authorize so the parent can pop the sheet / refresh higher-level
   *  state if it wants. The OAuth dance + status fetch happens inside
   *  this sheet — the parent doesn't need to do anything for it to
   *  work. */
  onAuthorize: () => void;
}

/** Production rendezvous backend (Vercel deployment of `landing/`). The
 *  GitHub OAuth routes live here. Override via
 *  EXPO_PUBLIC_RENDEZVOUS_BASE for local dev. Kept inline rather than
 *  imported from a shared `config/env.ts` because this is the only file
 *  in our touch-scope. */
const RENDEZVOUS_BASE =
  process.env.EXPO_PUBLIC_RENDEZVOUS_BASE ||
  "https://wend-landing.vercel.app";

interface ProviderStatus {
  connected: boolean;
  accountLabel: string | null;
  scopes: string | null;
  connectedAt: string | null;
}

interface IntegrationsListResponse {
  github?: ProviderStatus;
  linear?: ProviderStatus;
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
  const { getToken } = useAuth();
  // Android back closes the topmost (this) sheet first.
  useAndroidBack(true, onClose);

  // -- Status state machine. `null` while we haven't loaded yet. --
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [busy, setBusy] = useState<"idle" | "authorizing" | "disconnecting">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  // Fetch /api/integrations/list with the Clerk JWT and update state.
  // Wrapped in useCallback so the OAuth-completed effect can reuse it.
  const refresh = useCallback(async () => {
    try {
      const jwt = await getToken();
      if (!jwt) {
        setError("Not signed in.");
        return;
      }
      const res = await fetch(
        `${RENDEZVOUS_BASE}/api/integrations/list`,
        { headers: { Authorization: `Bearer ${jwt}` } },
      );
      if (!res.ok) {
        setError(`Couldn't read connection state (HTTP ${res.status}).`);
        return;
      }
      const body = (await res.json()) as IntegrationsListResponse;
      setStatus(
        body.github ?? {
          connected: false,
          accountLabel: null,
          scopes: null,
          connectedAt: null,
        },
      );
      setError(null);
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Network error reaching trywend.app.";
      setError(msg);
    }
  }, [getToken]);

  // First fetch on mount.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onAuthorizePress = useCallback(async () => {
    setBusy("authorizing");
    setError(null);
    try {
      const jwt = await getToken();
      if (!jwt) {
        setError("Not signed in.");
        return;
      }
      // The init route is Clerk-authed via Bearer; once the user is on
      // github.com the JWT is no longer needed. We pass it as a query
      // param so the in-app browser doesn't try to attach Bearer headers
      // across the GitHub redirect.
      //
      // The backend's `extractBearerToken` already accepts `?t=` for the
      // device-token surface; the Clerk verifier reuses the same helper,
      // so the same `?t=` convention works for JWT-authed routes too.
      const url = `${RENDEZVOUS_BASE}/api/integrations/github/init?t=${encodeURIComponent(jwt)}`;
      const returnUrl = Linking.createURL("/integrations");
      const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
      // Common outcomes:
      //   - "success"  → the deep-link fired; refresh the list.
      //   - "cancel"   → user dismissed the browser; do nothing.
      //   - "dismiss"  → same.
      if (result.type === "success") {
        await refresh();
        onAuthorize();
      }
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Couldn't open the GitHub flow.";
      setError(msg);
    } finally {
      setBusy("idle");
    }
  }, [getToken, refresh, onAuthorize]);

  const onDisconnectPress = useCallback(async () => {
    setBusy("disconnecting");
    setError(null);
    try {
      const jwt = await getToken();
      if (!jwt) {
        setError("Not signed in.");
        return;
      }
      const res = await fetch(
        `${RENDEZVOUS_BASE}/api/integrations/github/disconnect`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${jwt}` },
        },
      );
      if (!res.ok) {
        setError(`Disconnect failed (HTTP ${res.status}).`);
        return;
      }
      await refresh();
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Network error reaching trywend.app.";
      setError(msg);
    } finally {
      setBusy("idle");
    }
  }, [getToken, refresh]);

  // -- Theme tokens --
  const canvasBg = tokens["surface-canvas"];
  const inkColor = tokens["text-primary"];
  const subtleColor = tokens["text-secondary"];
  const tertiaryColor = tokens["text-tertiary"];
  const borderColor = tokens["border-hairline"];
  const accent = tokens["accent-default"];
  const chipBg = tokens["surface-chip"];
  const statusDoneColor = tokens["status-done"];
  const failedColor = tokens["status-failed"];

  const isConnected = status?.connected === true;
  const screenState: "loading" | "connected" | "disconnected" =
    status == null ? "loading" : isConnected ? "connected" : "disconnected";

  const heading = useMemo(() => {
    if (screenState === "connected") return "GitHub connected";
    return "Connect GitHub";
  }, [screenState]);

  const subtitle = useMemo(() => {
    if (screenState === "connected") {
      const label = status?.accountLabel;
      if (label) {
        return `Wend is connected to ${label}. You can disconnect at any time; we'll forget the access token immediately.`;
      }
      return "Wend is connected to your GitHub account. You can disconnect at any time.";
    }
    return "Allow Wend to access your repositories. This enables semantic search across your codebase and automated note linking.";
  }, [screenState, status?.accountLabel]);

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
              {heading}
            </Text>
            <Text variant="body" style={{ color: subtleColor }}>
              {subtitle}
            </Text>
            {error ? (
              <Text variant="meta" style={{ color: failedColor }}>
                {error}
              </Text>
            ) : null}
          </View>

          {/* Body switches on state. Loading shows a spinner where the
              permission list would be; connected shows a single check
              line; disconnected shows the two permission items. */}
          {screenState === "loading" ? (
            <View
              style={{
                marginTop: 4,
                paddingVertical: 24,
                alignItems: "center",
              }}
            >
              <ActivityIndicator color={subtleColor} />
            </View>
          ) : screenState === "connected" ? (
            <View style={{ gap: 16, marginTop: 4 }}>
              <PermissionItem
                heading={
                  status?.accountLabel
                    ? `Connected as ${status.accountLabel}`
                    : "Connected"
                }
                caption={
                  status?.scopes
                    ? `Scopes: ${status.scopes}`
                    : "Read access to code and metadata."
                }
                inkColor={inkColor}
                subtleColor={subtleColor}
                statusDoneColor={statusDoneColor}
              />
            </View>
          ) : (
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
          )}

          {/* Spacer pushes the actions to the bottom. */}
          <View style={{ flex: 1 }} />

          {/* Primary action — ember pill, full-width.
              Pressable wraps content; static-style inner View holds the visual
              + layout. Same pattern as before (NativeWind callback gotcha). */}
          <Pressable
            onPress={
              screenState === "connected" ? onDisconnectPress : onAuthorizePress
            }
            disabled={busy !== "idle" || screenState === "loading"}
            accessibilityRole="button"
            accessibilityLabel={
              screenState === "connected" ? "Disconnect" : "Authorize"
            }
            style={({ pressed }) => ({
              opacity: pressed ? 0.85 : busy !== "idle" ? 0.7 : 1,
            })}
          >
            <View
              style={{
                width: "100%",
                height: 52,
                borderRadius: 999,
                backgroundColor:
                  screenState === "connected" ? failedColor : accent,
                alignItems: "center",
                justifyContent: "center",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.12,
                shadowRadius: 6,
                elevation: 2,
                flexDirection: "row",
                gap: 8,
              }}
            >
              {busy !== "idle" ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : null}
              <Text
                style={{
                  color: "#FFFFFF",
                  fontFamily: "Inter-SemiBold",
                  fontSize: 15,
                }}
              >
                {busy === "authorizing"
                  ? "Opening GitHub…"
                  : busy === "disconnecting"
                    ? "Disconnecting…"
                    : screenState === "connected"
                      ? "Disconnect"
                      : "Authorize"}
              </Text>
            </View>
          </Pressable>

          {/* Secondary action — outlined pill. Cancel/Done copy mirrors state. */}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={
              screenState === "connected" ? "Done" : "Cancel"
            }
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
                {screenState === "connected" ? "Done" : "Cancel"}
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
