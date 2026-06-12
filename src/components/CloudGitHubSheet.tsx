/**
 * Cloud GitHub install sheet.
 *
 * Specifically for the Wend Cloud GitHub App (App ID 3994863) used by
 * cloud-agent dispatches to clone the user's repos. This is distinct
 * from the user-OAuth GitHub flow in ConnectGitHubSheet — that one
 * lives for identity linking; this one is for repo read access from
 * inside ephemeral containers.
 *
 * If the user signed into Clerk with GitHub OAuth, the backend's
 * /v1/connect/github/install-url endpoint auto-detects an existing
 * Wend Cloud installation on their GitHub account and skips the
 * install consent screen entirely.
 *
 * Otherwise we deep-link to github.com/apps/wend-cloud/installations/new
 * with a state token. After install, GitHub redirects to the App's
 * Setup URL (a Tempus endpoint) that persists the installation_id in
 * Clerk private_metadata.
 */
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Pressable, View } from "react-native";
import { ArrowRightIcon, CheckCircleIcon, GithubLogoIcon } from "phosphor-react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import { useWendCloudApi, CloudApiError } from "@/lib/wend-cloud-api";
import { useCloudStore } from "@/store/cloudSlice";
import { useAndroidBack } from "@/lib/useAndroidBack";

export function CloudGitHubSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { tokens } = useTheme();
  const api = useWendCloudApi();
  const setGithub = useCloudStore((s) => s.setGithub);
  const githubConnected = useCloudStore((s) => s.githubConnected);
  const githubLogin = useCloudStore((s) => s.githubLogin);

  const [busy, setBusy] = useState(false);
  const [postInstallHint, setPostInstallHint] = useState(false);

  useAndroidBack(open, onClose);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api.githubStatus();
      setGithub({
        installed: s.installed,
        login: s.login,
        installationId: s.installation_id,
      });
    } catch (err) {
      if (err instanceof CloudApiError && err.status === 401) return;
    }
  }, [api, setGithub]);

  useEffect(() => {
    if (!open) return;
    void refreshStatus();
  }, [open, refreshStatus]);

  // GitHub's install callback (the App's Setup URL) ends with a 302 to
  // wend://github/connected?installation_id=...&ok=1. When that lands we
  // pull the fresh status from Tempus so the UI flips to Connected
  // without an explicit user tap.
  useEffect(() => {
    if (!open) return;
    const sub = Linking.addEventListener("url", (e) => {
      if (e.url.startsWith("wend://github/connected")) {
        void refreshStatus();
      }
    });
    return () => sub.remove();
  }, [open, refreshStatus]);

  if (!open) return null;

  async function handleConnect() {
    setBusy(true);
    try {
      const result = await api.githubInstallUrl();
      if (result.installed) {
        setGithub({
          installed: true,
          login: result.login ?? null,
          installationId: result.installation_id ?? null,
        });
        Alert.alert("Already installed", `Wend Cloud is connected to @${result.login}.`);
        onClose();
        return;
      }
      if (result.install_url) {
        setPostInstallHint(true);
        await Linking.openURL(result.install_url);
      }
    } catch (err) {
      const msg = err instanceof CloudApiError ? err.detail : String(err);
      Alert.alert("Couldn't open install flow", msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      style={{
        position: "absolute",
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: tokens["surface-canvas"],
        zIndex: 70,
        paddingHorizontal: 20,
        paddingTop: 60,
      }}
    >
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close"
        style={{
          alignSelf: "flex-start",
          paddingVertical: 8,
          paddingRight: 16,
        }}
      >
        <Text style={{ color: tokens["text-secondary"], fontFamily: "Inter-Medium", fontSize: 15 }}>
          Cancel
        </Text>
      </Pressable>

      <Text
        style={{
          fontFamily: "Inter-Bold",
          fontSize: 28,
          color: tokens["text-primary"],
          letterSpacing: -0.4,
          marginTop: 24,
        }}
      >
        Connect GitHub
      </Text>
      <Text
        style={{
          fontFamily: "Inter-Regular",
          fontSize: 14,
          color: tokens["text-secondary"],
          marginTop: 8,
          lineHeight: 20,
        }}
      >
        Cloud dispatches clone a repo you pick into a fresh container,
        run Claude against it, and tear it down. Wend Cloud installs as
        a GitHub App with Read-only Contents on the repos you choose.
      </Text>

      {githubConnected ? (
        <View
          style={{
            marginTop: 24,
            borderWidth: 1,
            borderColor: tokens["border-hairline"],
            borderRadius: 14,
            padding: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <CheckCircleIcon size={24} color={tokens["status-done"]} weight="fill" />
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: "Inter-SemiBold",
                fontSize: 16,
                color: tokens["text-primary"],
              }}
            >
              Connected
            </Text>
            <Text
              style={{
                marginTop: 2,
                fontFamily: "Inter-Regular",
                fontSize: 13,
                color: tokens["text-secondary"],
              }}
            >
              {githubLogin ? `@${githubLogin}` : "Wend Cloud is installed on your account."}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={{ marginTop: githubConnected ? 12 : 24 }}>
        <Pressable
          onPress={handleConnect}
          disabled={busy}
          accessibilityLabel={githubConnected ? "Manage GitHub install" : "Install Wend Cloud on GitHub"}
        >
          <View
            style={{
              height: 52,
              borderRadius: 14,
              backgroundColor: githubConnected ? tokens["surface-elevated"] : tokens["text-primary"],
              borderWidth: githubConnected ? 1 : 0,
              borderColor: tokens["border-hairline"],
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 10,
              opacity: busy ? 0.5 : 1,
            }}
          >
            <GithubLogoIcon
              size={18}
              color={githubConnected ? tokens["text-primary"] : tokens["surface-canvas"]}
              weight="fill"
            />
            <Text
              style={{
                fontFamily: "Inter-SemiBold",
                fontSize: 15,
                color: githubConnected ? tokens["text-primary"] : tokens["surface-canvas"],
                letterSpacing: -0.1,
              }}
            >
              {busy
                ? "Opening GitHub…"
                : githubConnected
                  ? "Manage repos on GitHub"
                  : "Install Wend Cloud"}
            </Text>
            {!busy ? (
              <ArrowRightIcon
                size={14}
                color={githubConnected ? tokens["text-primary"] : tokens["surface-canvas"]}
                weight="bold"
              />
            ) : null}
          </View>
        </Pressable>

        {postInstallHint ? (
          <Pressable
            onPress={refreshStatus}
            style={{
              alignSelf: "center",
              marginTop: 16,
              paddingVertical: 10,
            }}
          >
            <Text
              style={{
                fontFamily: "Inter-Medium",
                fontSize: 13,
                color: tokens["accent-default"],
              }}
            >
              I've installed it — refresh
            </Text>
          </Pressable>
        ) : null}
      </View>

      <Text
        style={{
          marginTop: 28,
          fontFamily: "Inter-Regular",
          fontSize: 12,
          color: tokens["text-tertiary"],
          lineHeight: 18,
        }}
      >
        Read-only Contents scope. No write permissions. No PRs created.
        Per-dispatch tokens last under an hour and are revoked when the
        container exits.
      </Text>
    </Animated.View>
  );
}
