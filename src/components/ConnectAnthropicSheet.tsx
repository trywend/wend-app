/**
 * Connect Anthropic sheet.
 *
 * One-time per user: paste an Anthropic API key, Tempus validates it
 * against api.anthropic.com, on success stores in Clerk private_metadata
 * and updates the cloud slice. Key is never persisted on the phone.
 */
import { useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { ArrowRightIcon, EyeIcon, EyeSlashIcon, TrashIcon } from "phosphor-react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import { useWendCloudApi, CloudApiError } from "@/lib/wend-cloud-api";
import { useCloudStore } from "@/store/cloudSlice";
import { useAndroidBack } from "@/lib/useAndroidBack";

export function ConnectAnthropicSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { tokens } = useTheme();
  const api = useWendCloudApi();
  const setAnthropic = useCloudStore((s) => s.setAnthropic);
  const isConnected = useCloudStore((s) => s.anthropicConnected);

  const [key, setKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);

  useAndroidBack(open, onClose);

  if (!open) return null;

  async function handleConnect() {
    const trimmed = key.trim();
    if (!trimmed.startsWith("sk-ant-")) {
      Alert.alert("That doesn't look right", "Anthropic API keys start with sk-ant-.");
      return;
    }
    setBusy(true);
    try {
      await api.connectAnthropic(trimmed);
      setAnthropic(true);
      setKey("");
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
      await api.disconnectAnthropic();
      setAnthropic(false);
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
        Connect Anthropic
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
        Cloud dispatches use your own Anthropic key so the usage shows up on
        your Anthropic account, not Wend's. Get one at console.anthropic.com →
        API Keys.
      </Text>

      <View
        style={{
          marginTop: 24,
          borderWidth: 1,
          borderColor: tokens["border-hairline"],
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <TextInput
          value={key}
          onChangeText={setKey}
          placeholder="sk-ant-..."
          placeholderTextColor={tokens["text-placeholder"]}
          secureTextEntry={!reveal}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          style={{
            flex: 1,
            fontFamily: "JetBrainsMono-Regular",
            fontSize: 14,
            color: tokens["text-primary"],
            padding: 0,
          }}
        />
        <View>
          <Pressable
            onPress={() => setReveal((r) => !r)}
            accessibilityLabel={reveal ? "Hide key" : "Reveal key"}
            style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.5 : 1 })}
          >
            {reveal ? (
              <EyeSlashIcon size={18} color={tokens["text-secondary"]} weight="regular" />
            ) : (
              <EyeIcon size={18} color={tokens["text-secondary"]} weight="regular" />
            )}
          </Pressable>
        </View>
      </View>

      <View style={{ marginTop: 20 }}>
        <Pressable
          onPress={handleConnect}
          disabled={busy || key.trim().length < 10}
          accessibilityLabel="Save Anthropic key"
        >
          <View
            style={{
              height: 52,
              borderRadius: 14,
              backgroundColor: tokens["accent-default"],
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 8,
              opacity: busy || key.trim().length < 10 ? 0.5 : 1,
            }}
          >
            <Text
              style={{
                fontFamily: "Inter-SemiBold",
                fontSize: 16,
                color: tokens["accent-on"],
                letterSpacing: -0.1,
              }}
            >
              {busy ? "Validating…" : isConnected ? "Replace key" : "Connect"}
            </Text>
            {!busy ? (
              <ArrowRightIcon size={16} color={tokens["accent-on"]} weight="bold" />
            ) : null}
          </View>
        </Pressable>
      </View>

      {isConnected ? (
        <Pressable
          onPress={handleDisconnect}
          disabled={busy}
          accessibilityLabel="Remove Anthropic key"
          style={({ pressed }) => ({
            marginTop: 16,
            alignSelf: "center",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 8,
            opacity: pressed ? 0.5 : busy ? 0.4 : 1,
          })}
        >
          <TrashIcon size={14} color={tokens["status-failed"]} weight="regular" />
          <Text
            style={{
              fontFamily: "Inter-Medium",
              fontSize: 13,
              color: tokens["status-failed"],
            }}
          >
            Remove stored key
          </Text>
        </Pressable>
      ) : null}

      <Text
        style={{
          marginTop: 28,
          fontFamily: "Inter-Regular",
          fontSize: 12,
          color: tokens["text-tertiary"],
          lineHeight: 18,
        }}
      >
        Your key is validated against Anthropic, then stored encrypted in
        Clerk on the Tempus side. The phone forgets it the moment you tap
        Connect. Wend never sees it after upload.
      </Text>
    </Animated.View>
  );
}
