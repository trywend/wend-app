/**
 * Wend — html deliverable. A self-contained HTML document (an `deliverable.html`
 * the run wrote) rendered in a sandboxed WebView: no navigation to external
 * origins, JS enabled only for the document itself, no new windows. Fixed max
 * height inline; taps expand to a fullscreen modal.
 *
 * react-native-webview is a native module. It ships in this app, but it's
 * lazy-required so a stale dev client that predates it falls back to a
 * stripped-text preview plus a download action instead of crashing.
 */
import { useState } from "react";
import { Linking, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowsOutSimpleIcon,
  CodeIcon,
  XIcon,
} from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import type { Artifact } from "@/lib/notes-storage";
import { DeliverableCard, DownloadButton } from "./DownloadButton";
import { downloadText, downloadFromUrl } from "./download";
import { useArtifactText, useArtifactSource } from "./useArtifact";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let WebViewComponent: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  WebViewComponent = require("react-native-webview").WebView;
} catch {
  WebViewComponent = null;
}
export const webViewAvailable = Boolean(WebViewComponent);

const INLINE_HEIGHT = 320;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Block every navigation except the initial in-memory document load. External
// links open in the system browser instead of hijacking the sandbox.
function guardNavigation(req: { url: string }): boolean {
  const u = req.url || "";
  if (u === "about:blank" || u.startsWith("about:") || u.startsWith("data:")) {
    return true;
  }
  if (/^https?:\/\//i.test(u)) {
    void Linking.openURL(u).catch(() => {});
  }
  return false;
}

function Sandbox({ html, style }: { html: string; style: object }) {
  return (
    <WebViewComponent
      source={{ html }}
      originWhitelist={["about:*", "data:*"]}
      javaScriptEnabled
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={guardNavigation}
      allowsInlineMediaPlayback
      scrollEnabled
      androidLayerType="hardware"
      style={style}
    />
  );
}

export function HtmlDeliverable({
  artifact,
  runId,
  compact,
}: {
  artifact: Artifact;
  runId: string | undefined;
  compact?: boolean;
}) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const accent = tokens["accent-default"];
  const subtle = tokens["text-secondary"];
  const tertiary = tokens["text-tertiary"];
  const border = tokens["border-hairline"];
  const canvas = tokens["surface-canvas"];
  const ink = tokens["text-primary"];

  const state = useArtifactText(runId, artifact.id, true);
  const { urlFor } = useArtifactSource(runId);
  const url = urlFor(artifact.id);
  const [full, setFull] = useState(false);

  const name = artifact.name || "deliverable.html";
  const mime = artifact.mime || "text/html";
  const save = () => {
    if (state.phase === "ready") return downloadText({ text: state.text, name, mime });
    if (url) return downloadFromUrl({ url, name, mime });
    return Promise.resolve();
  };

  const icon = <CodeIcon size={13} color={accent} weight="regular" />;

  if (compact) {
    return (
      <DeliverableCard icon={icon} title={name} chip="HTML">
        <View style={{ height: 120, backgroundColor: canvas }}>
          {state.phase === "ready" && webViewAvailable ? (
            <View pointerEvents="none" style={{ flex: 1 }}>
              <Sandbox html={state.text} style={{ flex: 1, backgroundColor: canvas }} />
            </View>
          ) : (
            <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 12 }}>
              <Text
                numberOfLines={3}
                style={{ fontFamily: "Inter-Regular", fontSize: 13, color: subtle, lineHeight: 19 }}
              >
                {state.phase === "ready" ? stripHtml(state.text) : "HTML document"}
              </Text>
            </View>
          )}
        </View>
      </DeliverableCard>
    );
  }

  return (
    <>
      <DeliverableCard icon={icon} title={name} chip="HTML">
        <View style={{ height: INLINE_HEIGHT, backgroundColor: canvas }}>
          {state.phase === "loading" ? (
            <View style={{ flex: 1 }} />
          ) : state.phase === "ready" && webViewAvailable ? (
            <Sandbox html={state.text} style={{ flex: 1, backgroundColor: canvas }} />
          ) : state.phase === "ready" ? (
            <ScrollView contentContainerStyle={{ padding: 14 }}>
              <Text style={{ fontFamily: "Inter-Regular", fontSize: 13.5, color: ink, lineHeight: 20 }}>
                {stripHtml(state.text)}
              </Text>
            </ScrollView>
          ) : (
            <View style={{ flex: 1, justifyContent: "center", padding: 16 }}>
              <Text style={{ fontFamily: "Inter-Regular", fontSize: 13, color: tertiary }}>
                {state.phase === "unavailable"
                  ? "Pair your Mac to render this page. You can still download it."
                  : "Couldn't load this page from your Mac."}
              </Text>
            </View>
          )}
        </View>
        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 12,
            borderTopWidth: 1,
            borderTopColor: border,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          {state.phase === "ready" && webViewAvailable ? (
            <Pressable
              onPress={() => setFull(true)}
              accessibilityRole="button"
              accessibilityLabel="Open fullscreen"
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 7,
                height: 34,
                paddingHorizontal: 14,
                borderRadius: 17,
                borderWidth: 1,
                borderColor: border,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <ArrowsOutSimpleIcon size={15} color={accent} weight="regular" />
              <Text style={{ fontFamily: "Inter-SemiBold", fontSize: 13, color: accent }}>
                Fullscreen
              </Text>
            </Pressable>
          ) : null}
          <DownloadButton label="Download .html" onDownload={save} />
        </View>
      </DeliverableCard>

      {full && state.phase === "ready" && webViewAvailable ? (
        <Modal
          visible
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => setFull(false)}
        >
          <View style={{ flex: 1, backgroundColor: canvas, paddingTop: insets.top }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: border,
              }}
            >
              <Text
                numberOfLines={1}
                style={{ flex: 1, fontFamily: "Inter-SemiBold", fontSize: 14, color: ink }}
              >
                {name}
              </Text>
              <Pressable
                onPress={() => setFull(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={10}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <XIcon size={20} color={subtle} weight="regular" />
              </Pressable>
            </View>
            <Sandbox html={state.text} style={{ flex: 1, backgroundColor: canvas }} />
          </View>
        </Modal>
      ) : null}
    </>
  );
}
