/**
 * SCREEN: Session conversation — the transcript of one Claude Code session,
 * with a composer to resume and continue (steer) it.
 *
 * Steering is resume-and-continue: the composer message starts a fresh turn
 * on the existing session (claude --resume under the hood via useDispatch
 * with sessionId + the session's cwd). It is NOT injection into a running
 * turn — headless claude can't take that — so the copy says "resume", never
 * "interrupt".
 *
 * Assistant messages render as plain markdown here. Rich deliverables
 * (artifacts, diffs, downloads) are owned by another surface and are out of
 * scope for this view.
 *
 * NativeWind gotcha: every Pressable with a function `style` keeps layout
 * inline; className carries non-layout only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowUpIcon,
  CaretLeftIcon,
  CircleNotchIcon,
  StopIcon,
} from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { Markdown } from "@/components/editor/Markdown";
import { parseMarkdown } from "@/lib/agentMarkdown";
import { useTheme } from "@/theme/ThemeProvider";
import { typography } from "@/theme/tokens";
import { useResolvedDaemonURL } from "@/lib/dispatch/useResolvedDaemonURL";
import { useDispatch, type DispatchEvent } from "@/lib/dispatch/useDispatch";
import {
  fetchSession,
  projectFromCwd,
  type SessionMessage,
} from "@/lib/sessions/api";

interface Streaming {
  text: string;
  tools: string[];
  status: "running" | "done" | "error";
  error: string | null;
}

export default function SessionConversationScreen() {
  const { tokens } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string;
    cwd?: string;
    project?: string;
    title?: string;
  }>();
  const sessionId = params.id;

  const daemon = useResolvedDaemonURL();
  const { dispatch, running, cancel } = useDispatch();

  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [cwd, setCwd] = useState<string>(params.cwd ?? "");
  const [project, setProject] = useState<string>(
    params.project ?? (params.cwd ? projectFromCwd(params.cwd) : ""),
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<Streaming | null>(null);

  const scrollRef = useRef<ScrollView>(null);

  const canvas = tokens["surface-canvas"];
  const ink = tokens["text-primary"];
  const subtle = tokens["text-secondary"];
  const border = tokens["border-hairline"];
  const accent = tokens["accent-default"];

  const loadSession = useCallback(async () => {
    if (!daemon.isReady || !sessionId) {
      setLoading(false);
      return;
    }
    try {
      const detail = await fetchSession({
        url: daemon.url,
        token: daemon.token,
        id: sessionId,
      });
      setMessages(detail.messages);
      if (detail.cwd) setCwd(detail.cwd);
      if (detail.project) setProject(detail.project);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [daemon.isReady, daemon.url, daemon.token, sessionId]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    const t = setTimeout(
      () => scrollRef.current?.scrollToEnd({ animated: true }),
      60,
    );
    return () => clearTimeout(t);
  }, [messages.length, streaming?.text, streaming?.tools.length]);

  async function handleSend() {
    const prompt = draft.trim();
    if (!prompt || running) return;
    if (!daemon.isReady) {
      setStreaming({
        text: "",
        tools: [],
        status: "error",
        error: "No Mac paired. Pair from Settings to steer this session.",
      });
      return;
    }
    Keyboard.dismiss();
    setDraft("");
    setMessages((prev) => [
      ...prev,
      { role: "user", text: prompt, ts: Date.now() },
    ]);
    setStreaming({ text: "", tools: [], status: "running", error: null });

    let accumulated = "";
    const tools: string[] = [];
    let didError = false;
    let errorMessage: string | null = null;

    await dispatch({
      prompt,
      sessionId,
      cwd: cwd || undefined,
      onEvent: (e: DispatchEvent) => {
        if (e.type === "text") {
          accumulated += e.text;
          setStreaming((s) =>
            s ? { ...s, text: accumulated } : s,
          );
        } else if (e.type === "tool_use") {
          tools.push(e.name);
          setStreaming((s) => (s ? { ...s, tools: [...tools] } : s));
        } else if (e.type === "result") {
          if (e.isError) {
            didError = true;
            errorMessage = "Claude reported an error result";
          }
        } else if (e.type === "error") {
          didError = true;
          errorMessage = e.message;
          setStreaming((s) =>
            s ? { ...s, status: "error", error: e.message } : s,
          );
        } else if (e.type === "done") {
          if (accumulated.trim().length > 0) {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", text: accumulated, ts: Date.now() },
            ]);
          }
          setStreaming(
            didError && accumulated.trim().length === 0
              ? { text: "", tools, status: "error", error: errorMessage }
              : null,
          );
        }
      },
    });
  }

  const headerSub = cwd || project || "";

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: canvas }}
      edges={["top", "bottom"]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderBottomColor: border,
          }}
        >
          <View style={{ width: 40, height: 36, borderRadius: 8, overflow: "hidden" }}>
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Back to sessions"
              style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
            >
              <CaretLeftIcon size={22} color={subtle} weight="regular" />
            </Pressable>
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="body-em" numberOfLines={1} style={{ color: ink }}>
              {project || "Session"}
            </Text>
            {headerSub ? (
              <Text
                variant="caption"
                numberOfLines={1}
                style={{ color: subtle, fontFamily: "JetBrainsMono" }}
              >
                {headerSub}
              </Text>
            ) : null}
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 16,
            gap: 14,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {loading ? (
            <View style={{ paddingVertical: 48, alignItems: "center" }}>
              <CircleNotchIcon size={20} color={subtle} weight="bold" />
            </View>
          ) : loadError ? (
            <View style={{ paddingVertical: 32, alignItems: "center" }}>
              <Text
                variant="meta"
                style={{ color: subtle, textAlign: "center" }}
              >
                {loadError}
              </Text>
            </View>
          ) : messages.length === 0 && !streaming ? (
            <View style={{ paddingVertical: 32, alignItems: "center" }}>
              <Text
                variant="meta"
                style={{ color: subtle, textAlign: "center" }}
              >
                No messages in this session yet.
              </Text>
            </View>
          ) : null}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <UserBubble key={i} text={m.text} accent={accent} />
            ) : (
              <AssistantMessage key={i} text={m.text} />
            ),
          )}

          {streaming ? (
            <View>
              {streaming.tools.length > 0 && streaming.status === "running" ? (
                <Text
                  variant="caption"
                  style={{ color: subtle, marginBottom: 6, fontFamily: "JetBrainsMono" }}
                >
                  {`Working · ${streaming.tools[streaming.tools.length - 1]}`}
                </Text>
              ) : null}
              {streaming.text.length > 0 ? (
                <AssistantMessage text={streaming.text} />
              ) : streaming.status === "running" ? (
                <Text variant="meta" style={{ color: subtle }}>
                  Resuming on your Mac…
                </Text>
              ) : null}
              {streaming.status === "error" ? (
                <Text
                  variant="meta"
                  style={{ color: tokens["status-failed"] }}
                >
                  {streaming.error ?? "Steer failed."}
                </Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        <Composer
          value={draft}
          onChangeText={setDraft}
          onSend={handleSend}
          onStop={cancel}
          running={running}
          disabled={loading}
          ink={ink}
          subtle={subtle}
          border={border}
          canvas={canvas}
          accent={accent}
          accentOn={tokens["accent-on"]}
          caret={tokens["accent-caret"]}
          placeholder={tokens["text-placeholder"]}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function UserBubble({ text, accent }: { text: string; accent: string }) {
  return (
    <View style={{ alignItems: "flex-end" }}>
      <View
        style={{
          maxWidth: "86%",
          backgroundColor: `${accent}1F`,
          borderRadius: 14,
          borderTopRightRadius: 4,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        <Text variant="body" style={{ color: accent }}>
          {text}
        </Text>
      </View>
    </View>
  );
}

function AssistantMessage({ text }: { text: string }) {
  return (
    <View style={{ maxWidth: "100%" }}>
      <Markdown blocks={parseMarkdown(text)} />
    </View>
  );
}

function Composer({
  value,
  onChangeText,
  onSend,
  onStop,
  running,
  disabled,
  ink,
  subtle,
  border,
  canvas,
  accent,
  accentOn,
  caret,
  placeholder,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onSend: () => void;
  onStop: () => void;
  running: boolean;
  disabled: boolean;
  ink: string;
  subtle: string;
  border: string;
  canvas: string;
  accent: string;
  accentOn: string;
  caret: string;
  placeholder: string;
}) {
  const canSend = value.trim().length > 0 && !running && !disabled;
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: border,
        backgroundColor: canvas,
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 8,
        gap: 6,
      }}
    >
      <Text variant="caption" style={{ color: subtle, paddingHorizontal: 2 }}>
        Resumes this session on your Mac.
      </Text>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="Steer this session…"
          placeholderTextColor={placeholder}
          selectionColor={caret}
          multiline
          editable={!disabled}
          style={{
            flex: 1,
            maxHeight: 120,
            minHeight: 40,
            fontFamily: "Inter-Regular",
            fontSize: typography.body.fontSize,
            lineHeight: typography.body.lineHeight,
            color: ink,
            paddingHorizontal: 12,
            paddingTop: 9,
            paddingBottom: 9,
            borderWidth: 1,
            borderColor: border,
            borderRadius: 12,
          }}
        />
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            overflow: "hidden",
            backgroundColor: running ? border : canSend ? accent : border,
          }}
        >
          <Pressable
            onPress={running ? onStop : onSend}
            disabled={!running && !canSend}
            accessibilityRole="button"
            accessibilityLabel={running ? "Stop" : "Wend it"}
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          >
            {running ? (
              <StopIcon size={18} color={accentOn} weight="fill" />
            ) : (
              <ArrowUpIcon
                size={20}
                color={canSend ? accentOn : subtle}
                weight="bold"
              />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}
