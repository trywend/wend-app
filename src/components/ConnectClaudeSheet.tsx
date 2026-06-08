/**
 * Connect Claude sheet — bridges the user's Claude Code subscription
 * into cloud dispatches.
 *
 * The Mac daemon reads the OAuth credentials JSON from the macOS
 * Keychain ("Claude Code-credentials") and serves it at GET
 * /v1/claude-creds. The phone forwards that blob to Tempus, which
 * stashes it in Clerk private_metadata. Cloud containers write it to
 * ~/.claude/.credentials.json before running claude; claude uses the
 * OAuth path and bills the user's subscription.
 *
 * Requires the Mac to be paired AND `claude auth login` to have been
 * run on it. Surfaces a clear error otherwise.
 *
 * ToS caveat: Anthropic intends Claude Code OAuth credentials for
 * authorized devices the user owns. Shipping them to AWS is a
 * borderline use; we surface this explicitly in the consent copy.
 */
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Pressable, View } from "react-native";
import { ArrowRightIcon, CheckCircleIcon, CloudArrowUpIcon, WarningIcon } from "phosphor-react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { fetch as expoFetch } from "expo/fetch";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import { useWendCloudApi, CloudApiError } from "@/lib/wend-cloud-api";
import { useCloudStore } from "@/store/cloudSlice";
import { useDaemonStore } from "@/store/daemonSlice";
import { useAndroidBack } from "@/lib/useAndroidBack";

export function ConnectClaudeSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { tokens } = useTheme();
  const api = useWendCloudApi();
  const setClaude = useCloudStore((s) => s.setClaude);
  const connected = useCloudStore((s) => s.claudeConnected);

  const daemonUrl = useDaemonStore((s) => s.url);
  const daemonToken = useDaemonStore((s) => s.token);
  const macPaired = Boolean(daemonUrl && daemonToken);

  const [busy, setBusy] = useState(false);

  useAndroidBack(open, onClose);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api.claudeStatus();
      setClaude(s.connected);
    } catch (err) {
      if (err instanceof CloudApiError && err.status === 401) return;
    }
  }, [api, setClaude]);

  useEffect(() => {
    if (!open) return;
    void refreshStatus();
  }, [open, refreshStatus]);

  if (!open) return null;

  async function handleConnect() {
    if (!macPaired) {
      Alert.alert(
        "Mac not paired",
        "Pair your Mac first under Settings → Connectivity → Mac. Then come back here.",
      );
      return;
    }
    setBusy(true);
    try {
      const r = await expoFetch(`${daemonUrl!.replace(/\/$/, "")}/v1/claude-creds?t=${encodeURIComponent(daemonToken!)}`, {
        method: "GET",
      });
      if (r.status === 404) {
        Alert.alert(
          "Claude not logged in",
          "On your Mac, open Terminal and run:\n\n  claude auth login\n\nThen come back here.",
        );
        return;
      }
      if (!r.ok) {
        Alert.alert("Couldn't reach your Mac", `Daemon returned ${r.status}.`);
        return;
      }
      const body = await r.json() as { credentialsJson?: string; connected?: boolean };
      if (!body.credentialsJson) {
        Alert.alert("No credentials", "The Mac daemon didn't return any Claude credentials.");
        return;
      }
      await api.connectClaude(body.credentialsJson);
      setClaude(true);
      Alert.alert(
        "Connected",
        "Cloud dispatches will now bill against your Claude subscription instead of API tokens.",
      );
      onClose();
    } catch (err) {
      const msg = err instanceof CloudApiError ? err.detail : String(err);
      Alert.alert("Couldn't connect", msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await api.disconnectClaude();
      setClaude(false);
      onClose();
    } catch (err) {
      Alert.alert("Couldn't disconnect", String(err));
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
        style={({ pressed }) => ({
          alignSelf: "flex-start",
          paddingVertical: 8,
          paddingRight: 16,
          opacity: pressed ? 0.5 : 1,
        })}
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
        Connect Claude
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
        Bill cloud dispatches against your Claude subscription instead of an
        API key. Reads the OAuth credentials your Mac already has from
        running `claude auth login`, forwards them to Wend's cloud once
        so the container can authenticate as you.
      </Text>

      {connected ? (
        <View
          style={{
            marginTop: 20,
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
          <Text
            style={{
              flex: 1,
              fontFamily: "Inter-SemiBold",
              fontSize: 15,
              color: tokens["text-primary"],
            }}
          >
            Connected — cloud runs bill your Claude subscription.
          </Text>
        </View>
      ) : null}

      <View style={{ marginTop: connected ? 12 : 20 }}>
        <Pressable
          onPress={handleConnect}
          disabled={busy}
          accessibilityLabel={connected ? "Refresh Claude credentials from Mac" : "Connect Claude via Mac"}
        >
          <View
            style={{
              height: 52,
              borderRadius: 14,
              backgroundColor: connected ? tokens["surface-elevated"] : tokens["accent-default"],
              borderWidth: connected ? 1 : 0,
              borderColor: tokens["border-hairline"],
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 10,
              opacity: busy ? 0.5 : 1,
            }}
          >
            <CloudArrowUpIcon
              size={18}
              color={connected ? tokens["text-primary"] : tokens["accent-on"]}
              weight="regular"
            />
            <Text
              style={{
                fontFamily: "Inter-SemiBold",
                fontSize: 15,
                color: connected ? tokens["text-primary"] : tokens["accent-on"],
              }}
            >
              {busy
                ? "Reading from Mac…"
                : connected
                  ? "Re-sync from Mac"
                  : "Sync from my Mac"}
            </Text>
            {!busy ? (
              <ArrowRightIcon
                size={14}
                color={connected ? tokens["text-primary"] : tokens["accent-on"]}
                weight="bold"
              />
            ) : null}
          </View>
        </Pressable>

        {connected ? (
          <Pressable
            onPress={handleDisconnect}
            disabled={busy}
            style={({ pressed }) => ({
              marginTop: 16,
              alignSelf: "center",
              paddingVertical: 10,
              opacity: pressed ? 0.5 : busy ? 0.4 : 1,
            })}
          >
            <Text
              style={{
                fontFamily: "Inter-Medium",
                fontSize: 13,
                color: tokens["status-failed"],
              }}
            >
              Disconnect — fall back to API key
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View
        style={{
          marginTop: 28,
          padding: 14,
          borderRadius: 12,
          backgroundColor: tokens["surface-elevated"],
          borderWidth: 1,
          borderColor: tokens["border-hairline"],
          flexDirection: "row",
          gap: 10,
        }}
      >
        <WarningIcon size={18} color={tokens["status-warn"]} weight="regular" />
        <Text
          style={{
            flex: 1,
            fontFamily: "Inter-Regular",
            fontSize: 12,
            color: tokens["text-secondary"],
            lineHeight: 18,
          }}
        >
          Anthropic intends Claude Code OAuth credentials for devices you've
          authorized. Forwarding them to a cloud container is a borderline
          use of that intent. Wend stores the credentials encrypted in
          Clerk and only injects them into containers running your
          dispatches. Use API key billing if you'd rather stay strictly
          within Anthropic's expected pattern.
        </Text>
      </View>
    </Animated.View>
  );
}
