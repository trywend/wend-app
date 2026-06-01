/**
 * SCREEN: S1 (blank) → S2 (composing) — the multi-block editor.
 *
 * Editor model:
 *
 *   [ Title — single TextInput, always editable ]
 *   [ Body  — multiline TextInput, always editable ]
 *   [ AgentRun 1 — readonly visual (S3) ]
 *   [ FollowUp 1 — multiline TextInput, always editable ]
 *   [ AgentRun 2 — readonly visual (S3) ]
 *   [ FollowUp 2 — multiline TextInput ]
 *   …
 *
 * Send logic:
 *   - First send (runs.length === 0): prompt = body.trim(), no sessionId.
 *   - Subsequent: prompt = runs[last].followUp.trim(), sessionId resumes.
 *
 * On stream completion we APPEND a PersistedRun to runs[] (response text
 * lives there — body is never auto-committed). A new empty FollowUp
 * TextInput shows up below the run.
 *
 * Persistence: `useNoteEditor` resolves the current draft on mount,
 * exposes `runs`, `appendRun`, `updateRunFollowUp`, and debounces saves
 * (title / body / runs / follow-ups) to AsyncStorage on every keystroke.
 *
 * NativeWind gotcha (non-negotiable): layout/sizing/positioning utilities
 * are silently dropped on Pressable when `style` is a function callback.
 * Every Pressable in this file uses inline `style` for layout — className
 * only for static, non-layout properties.
 */
import { useEffect, useRef, useState } from "react";
import {
  Animated as RNAnimated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ArrowUpIcon,
  CheckIcon,
  DotsThreeVerticalIcon,
  ListBulletsIcon,
  PaperclipIcon,
  StopIcon,
  TextHOneIcon,
  TrayIcon,
  XIcon,
} from "phosphor-react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { typography } from "@/theme/tokens";
import { useNoteEditor } from "@/lib/notes/useNoteEditor";
import { useDispatch, type DispatchEvent } from "@/lib/dispatch/useDispatch";
import type { PersistedRun } from "@/lib/notes-storage";
import { Text } from "@/components/primitives";
import {
  AgentRunBlock,
  type AgentRunBlockState,
} from "@/components/editor/AgentRunBlock";
import {
  FirstNoteCoachmark,
  FIRST_NOTE_COACHMARK_KEY,
} from "@/components/editor/FirstNoteCoachmark";
import * as Crypto from "expo-crypto";

const TOP_BAR_HEIGHT = 48;
const TOOLBAR_HEIGHT = 52;

interface InflightRun {
  prompt: string;
  response: string;
  toolUses: string[];
  sessionId: string | null;
  durationMs: number;
  costUsd: number;
  status: "running" | "done" | "error";
  error: string | null;
}

const INITIAL_INFLIGHT: InflightRun | null = null;

export default function HomeScreen() {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const {
    title,
    body,
    runs,
    setTitle,
    setBody,
    appendRun,
    updateRunFollowUp,
  } = useNoteEditor();
  const [bodyFocused, setBodyFocused] = useState(true);
  const [chipDismissed, setChipDismissed] = useState(false);
  const [inflight, setInflight] = useState<InflightRun | null>(INITIAL_INFLIGHT);
  const [, setInboxOpen] = useState(false);
  const [coachmarkVisible, setCoachmarkVisible] = useState(false);
  const { dispatch, running, cancel, isConfigured: daemonConfigured } =
    useDispatch();

  const bodyRef = useRef<TextInput>(null);
  const followUpRefs = useRef<Record<number, TextInput | null>>({});
  const scrollRef = useRef<ScrollView>(null);

  const lastRunIdx = runs.length - 1;
  const hasRuns = runs.length > 0;
  const isFirstSend = !hasRuns;
  const lastFollowUp = hasRuns ? runs[lastRunIdx]!.followUp : "";

  const isBodyEmpty = body.length === 0;
  const isTitleEmpty = title.length === 0;
  const noUserInputYet =
    isBodyEmpty && isTitleEmpty && !hasRuns && !inflight;
  const hasContent = !noUserInputYet;

  // What the next send would use as a prompt.
  const nextPromptSource = isFirstSend ? body : lastFollowUp;
  const canSend = nextPromptSource.trim().length > 0;
  const isStreaming = running || inflight?.status === "running";

  const showCaretOverlay = isBodyEmpty && bodyFocused && !hasRuns;

  // Dispatch chip (S13 stub) — only meaningful before the first run when the
  // user is still in the body field.
  const dispatchSignal = extractDispatchSignal(title, body);
  const showChip =
    !chipDismissed &&
    isFirstSend &&
    body.trim().length >= 12 &&
    !isStreaming;

  useEffect(() => {
    if (!hasContent && chipDismissed) setChipDismissed(false);
  }, [hasContent, chipDismissed]);

  /* ─── First-note coachmark gating ─────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await AsyncStorage.getItem(FIRST_NOTE_COACHMARK_KEY);
        if (cancelled) return;
        if (!v) setCoachmarkVisible(true);
      } catch {
        // ignore — coachmark just won't show
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const shouldShowCoachmark =
    coachmarkVisible && noUserInputYet && !hasRuns && !inflight;

  function dismissCoachmark() {
    setCoachmarkVisible(false);
    void AsyncStorage.setItem(FIRST_NOTE_COACHMARK_KEY, "1").catch(() => {});
  }

  /* ─── Auto-scroll while streaming ──────────────────────────────────── */
  useEffect(() => {
    if (!inflight) return;
    const t = setTimeout(
      () => scrollRef.current?.scrollToEnd({ animated: true }),
      50,
    );
    return () => clearTimeout(t);
  }, [
    inflight?.status,
    inflight?.response,
    inflight?.toolUses.length,
  ]);

  // Also scroll when a new completed run appears at the bottom so the
  // freshly-mounted follow-up input becomes visible.
  useEffect(() => {
    const t = setTimeout(
      () => scrollRef.current?.scrollToEnd({ animated: true }),
      80,
    );
    return () => clearTimeout(t);
  }, [runs.length]);

  /* ─── Blinking caret overlay (empty body, S1) ──────────────────────── */
  const blink = useRef(new RNAnimated.Value(1)).current;
  useEffect(() => {
    if (!showCaretOverlay) return;
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(blink, {
          toValue: 0,
          duration: 0,
          delay: 500,
          easing: Easing.step0,
          useNativeDriver: true,
        }),
        RNAnimated.timing(blink, {
          toValue: 1,
          duration: 0,
          delay: 500,
          easing: Easing.step0,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [showCaretOverlay, blink]);

  /* ─── Send handler ─────────────────────────────────────────────────── */
  async function handleSend() {
    // eslint-disable-next-line no-console
    console.log("[wend] send tapped", {
      canSend,
      isStreaming,
      daemonConfigured,
      runs: runs.length,
    });
    if (!canSend || isStreaming) return;
    Keyboard.dismiss();
    if (coachmarkVisible) dismissCoachmark();

    if (!daemonConfigured) {
      setInflight({
        prompt: nextPromptSource.trim(),
        response: "",
        toolUses: [],
        sessionId: null,
        durationMs: 0,
        costUsd: 0,
        status: "error",
        error:
          "Daemon not configured. Set EXPO_PUBLIC_DAEMON_URL + EXPO_PUBLIC_DAEMON_TOKEN in .env.local and RESTART Metro.",
      });
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
      return;
    }

    const prompt = nextPromptSource.trim();
    const sessionId = isFirstSend
      ? null
      : runs[lastRunIdx]!.sessionId;

    setInflight({
      prompt,
      response: "",
      toolUses: [],
      sessionId,
      durationMs: 0,
      costUsd: 0,
      status: "running",
      error: null,
    });

    let accumulated = "";
    const tools: string[] = [];
    let resolvedSessionId: string | null = sessionId;
    let resolvedDuration = 0;
    let resolvedCost = 0;
    let resolvedError: string | null = null;
    let didError = false;

    await dispatch({
      prompt,
      sessionId: sessionId ?? undefined,
      onEvent: (e: DispatchEvent) => {
        if (e.type === "text") {
          accumulated += e.text;
          setInflight((s) =>
            s ? { ...s, response: accumulated } : s,
          );
        } else if (e.type === "tool_use") {
          tools.push(e.name);
          setInflight((s) => (s ? { ...s, toolUses: [...tools] } : s));
        } else if (e.type === "result") {
          resolvedSessionId = e.sessionId || resolvedSessionId;
          resolvedDuration = e.durationMs;
          resolvedCost = e.costUsd;
          if (e.isError) {
            didError = true;
            resolvedError = "Claude reported an error result";
          }
          setInflight((s) =>
            s
              ? {
                  ...s,
                  sessionId: resolvedSessionId,
                  durationMs: resolvedDuration,
                  costUsd: resolvedCost,
                  status: e.isError ? "error" : "done",
                  error: e.isError ? resolvedError : null,
                }
              : s,
          );
        } else if (e.type === "error") {
          didError = true;
          resolvedError = e.message;
          setInflight((s) =>
            s ? { ...s, status: "error", error: e.message } : s,
          );
        } else if (e.type === "done") {
          // Promote inflight to a persisted run regardless of success/error —
          // the user wants the history preserved (errors included). We read
          // the closure-captured locals to avoid stale state.
          const finalStatus: PersistedRun["status"] = didError
            ? "error"
            : "done";
          const persisted: PersistedRun = {
            id: Crypto.randomUUID(),
            prompt,
            response: accumulated,
            sessionId: resolvedSessionId,
            status: finalStatus,
            durationMs: resolvedDuration,
            costUsd: resolvedCost,
            toolUses: [...tools],
            error: resolvedError,
            followUp: "",
            createdAt: Date.now(),
          };
          appendRun(persisted);
          setInflight(null);
          // Focus the freshly-mounted follow-up input so the user can keep
          // typing without an extra tap.
          setTimeout(() => {
            const idx = runs.length; // about-to-be-appended index
            followUpRefs.current[idx]?.focus();
          }, 80);
        }
      },
    });
  }

  function handleStop() {
    // eslint-disable-next-line no-console
    console.log("[wend] stop tapped");
    cancel();
  }

  function handleConfirmChip() {
    setChipDismissed(true);
    void handleSend();
  }

  function handleDismissChip() {
    setChipDismissed(true);
  }

  /* ─── Style helpers ────────────────────────────────────────────────── */
  const inkColor = tokens["text-primary"];
  const subtleColor = tokens["text-secondary"];
  const placeholderColor = tokens["text-placeholder"];
  const accent = tokens["accent-default"];
  const accentOn = tokens["accent-on"];
  const borderColor = tokens["border-hairline"];
  const surfaceChip = tokens["surface-chip"];
  const canvas = tokens["surface-canvas"];

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: canvas }}
      edges={["top", "bottom"]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        {/* ─── Top app bar (S2 only) ──────────────────────────────────── */}
        {hasContent ? (
          <Animated.View
            entering={FadeIn.duration(220)}
            exiting={FadeOut.duration(160)}
            style={{
              height: TOP_BAR_HEIGHT,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 16,
              borderBottomWidth: 1,
              borderBottomColor: borderColor,
            }}
          >
            <IconButton
              icon={<TrayIcon size={22} color={subtleColor} weight="regular" />}
              accessibilityLabel="Inbox"
              onPress={() => setInboxOpen(true)}
            />
            <Text
              style={{
                fontFamily: "Inter-SemiBold",
                fontSize: 17,
                color: inkColor,
                letterSpacing: -0.17,
              }}
            >
              Wend
            </Text>
            <IconButton
              icon={
                <DotsThreeVerticalIcon
                  size={22}
                  color={subtleColor}
                  weight="bold"
                />
              }
              accessibilityLabel="More"
              onPress={() => {
                // Overflow menu not built yet — placeholder.
              }}
            />
          </Animated.View>
        ) : null}

        {/* ─── Config warning banner ─────────────────────────────────── */}
        {!daemonConfigured ? (
          <View
            style={{
              backgroundColor: tokens["status-warn"],
              paddingHorizontal: 16,
              paddingVertical: 8,
            }}
          >
            <Text
              style={{
                color: "#FFFFFF",
                fontFamily: "Inter-Medium",
                fontSize: 12,
                textAlign: "center",
              }}
            >
              Daemon not configured. Set EXPO_PUBLIC_DAEMON_URL + _TOKEN in
              .env.local and RESTART Metro.
            </Text>
          </View>
        ) : null}

        {/* ─── Editor body ────────────────────────────────────────────── */}
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: hasContent ? 16 : 40,
            paddingBottom: 12,
            alignSelf: "center",
            width: "100%",
            maxWidth: 680,
            flexGrow: 1,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={hasContent ? "Title" : "New note"}
            placeholderTextColor={placeholderColor}
            selectionColor={tokens["accent-caret"]}
            autoCorrect={false}
            spellCheck={false}
            autoCapitalize="sentences"
            returnKeyType="next"
            onSubmitEditing={() => bodyRef.current?.focus()}
            submitBehavior="submit"
            style={{
              fontFamily: "Inter-SemiBold",
              fontSize: typography.title.fontSize,
              lineHeight: typography.title.lineHeight,
              letterSpacing: -0.22,
              color: inkColor,
              paddingVertical: 0,
              marginBottom: 12,
            }}
          />

          <Pressable
            style={{ minHeight: 80 }}
            onPress={() => bodyRef.current?.focus()}
          >
            <View style={{ position: "relative" }}>
              {showCaretOverlay ? (
                <RNAnimated.View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    top: 2,
                    left: 0,
                    width: 2,
                    height: typography.body.lineHeight - 4,
                    backgroundColor: tokens["accent-caret"],
                    opacity: blink,
                  }}
                />
              ) : null}

              <TextInput
                ref={bodyRef}
                value={body}
                onChangeText={setBody}
                autoFocus
                multiline
                caretHidden={showCaretOverlay}
                textAlignVertical="top"
                placeholder={hasContent ? "Start typing..." : ""}
                placeholderTextColor={placeholderColor}
                selectionColor={tokens["accent-caret"]}
                onFocus={() => setBodyFocused(true)}
                onBlur={() => setBodyFocused(false)}
                scrollEnabled={false}
                style={{
                  minHeight: 80,
                  fontFamily: "Inter-Regular",
                  fontSize: typography.body.fontSize,
                  lineHeight: typography.body.lineHeight,
                  letterSpacing: -0.187,
                  color: inkColor,
                  padding: 0,
                  margin: 0,
                  textAlignVertical: "top",
                }}
              />
            </View>
          </Pressable>

          {/* Render completed runs + their follow-up inputs in chronological
              order. Each run is readonly; each follow-up is editable and
              becomes the next prompt when the user taps send. */}
          {runs.map((run, idx) => (
            <View key={run.id}>
              <AgentRunBlock
                state={persistedRunToBlockState(run)}
              />
              <FollowUpInput
                value={run.followUp}
                onChangeText={(t) => updateRunFollowUp(idx, t)}
                placeholder="Ask a follow-up..."
                placeholderColor={placeholderColor}
                inkColor={inkColor}
                caretColor={tokens["accent-caret"]}
                inputRef={(r) => {
                  followUpRefs.current[idx] = r;
                }}
                isLast={idx === lastRunIdx}
              />
            </View>
          ))}

          {/* The in-flight run (no PersistedRun yet) — same visual, with
              streaming text and a stop button in the header. */}
          {inflight ? (
            <AgentRunBlock
              state={inflightToBlockState(inflight)}
              onStop={handleStop}
            />
          ) : null}
        </ScrollView>

        {/* ─── Confidence chip (S13) ──────────────────────────────────── */}
        {showChip ? (
          <Animated.View
            entering={SlideInDown.springify().damping(15).mass(0.6)}
            exiting={SlideOutDown.duration(180)}
            style={{
              position: "absolute",
              left: 16,
              right: 16,
              bottom: TOOLBAR_HEIGHT + 12,
              alignItems: "center",
              zIndex: 40,
              pointerEvents: "box-none",
            }}
            pointerEvents="box-none"
          >
            <Pressable
              onPress={handleConfirmChip}
              accessibilityRole="button"
              accessibilityLabel="Send to Claude on Mac"
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                maxWidth: "100%",
                backgroundColor: tokens["surface-elevated"],
                borderColor: borderColor,
                borderWidth: 1,
                borderRadius: 999,
                paddingLeft: 16,
                paddingRight: 8,
                paddingVertical: 6,
                shadowColor: "#000",
                shadowOpacity: 0.1,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
                elevation: 4,
                opacity: pressed ? 0.8 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <Text
                style={{
                  fontFamily: "Inter-Medium",
                  fontSize: 13,
                  color: inkColor,
                  marginRight: 10,
                  flexShrink: 1,
                  flexGrow: 0,
                }}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                Send to Claude{dispatchSignal ? ` (${dispatchSignal})` : ""} on Mac
              </Text>
              <Pressable
                onPress={handleDismissChip}
                accessibilityRole="button"
                accessibilityLabel="Dismiss suggestion"
                hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                style={({ pressed }) => ({
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.5 : 1,
                  marginRight: 4,
                  flexShrink: 0,
                })}
              >
                <XIcon size={16} color={subtleColor} weight="bold" />
              </Pressable>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: accent,
                  flexShrink: 0,
                }}
              >
                <CheckIcon size={16} color={accentOn} weight="bold" />
              </View>
            </Pressable>
          </Animated.View>
        ) : null}

        {/* ─── Keyboard toolbar (S2 only) ─────────────────────────────── */}
        {hasContent ? (
          <Animated.View
            entering={SlideInDown.duration(220)}
            exiting={SlideOutDown.duration(160)}
            style={{
              height: TOOLBAR_HEIGHT,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 16,
              borderTopWidth: 1,
              borderTopColor: borderColor,
              backgroundColor: canvas,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <ToolbarButton
                onPress={() => {
                  if (isFirstSend) {
                    insertAtBodyEnd("# ", setBody, body);
                  } else {
                    insertAtFollowUpEnd(
                      "# ",
                      lastRunIdx,
                      lastFollowUp,
                      updateRunFollowUp,
                    );
                  }
                }}
                accessibilityLabel="Heading"
                icon={<TextHOneIcon size={22} color={subtleColor} weight="regular" />}
              />
              <ToolbarButton
                onPress={() => {
                  if (isFirstSend) {
                    insertAtBodyEnd("`code`", setBody, body);
                  } else {
                    insertAtFollowUpEnd(
                      "`code`",
                      lastRunIdx,
                      lastFollowUp,
                      updateRunFollowUp,
                    );
                  }
                }}
                accessibilityLabel="Inline code"
                content={
                  <Text
                    style={{
                      fontFamily: "JetBrainsMono-Medium",
                      fontSize: 16,
                      color: subtleColor,
                    }}
                  >
                    M
                  </Text>
                }
              />
              <ToolbarButton
                onPress={() => {
                  if (isFirstSend) {
                    insertAtBodyEnd("\n- ", setBody, body);
                  } else {
                    insertAtFollowUpEnd(
                      "\n- ",
                      lastRunIdx,
                      lastFollowUp,
                      updateRunFollowUp,
                    );
                  }
                }}
                accessibilityLabel="Bulleted list"
                icon={<ListBulletsIcon size={22} color={subtleColor} weight="regular" />}
              />
              <View
                style={{
                  width: 1,
                  height: 20,
                  backgroundColor: borderColor,
                  marginHorizontal: 4,
                }}
              />
              <ToolbarButton
                onPress={() => {
                  /* Attach not wired yet. */
                }}
                accessibilityLabel="Attach file"
                icon={<PaperclipIcon size={22} color={subtleColor} weight="regular" />}
              />
            </View>

            <Pressable
              onPress={isStreaming ? handleStop : handleSend}
              disabled={!isStreaming && !canSend}
              accessibilityRole="button"
              accessibilityState={{ disabled: !isStreaming && !canSend }}
              accessibilityLabel={isStreaming ? "Stop dispatch" : "Send note"}
              style={({ pressed }) => ({
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: isStreaming || canSend ? accent : surfaceChip,
                opacity: isStreaming || canSend ? 1 : 0.6,
                transform: [{ scale: pressed ? 0.94 : 1 }],
              })}
            >
              {isStreaming ? (
                <StopIcon size={16} color={accentOn} weight="fill" />
              ) : (
                <ArrowUpIcon
                  size={18}
                  color={canSend ? accentOn : tokens["text-tertiary"]}
                  weight="bold"
                />
              )}
            </Pressable>
          </Animated.View>
        ) : null}

        {/* ─── Floating send + coachmark (S1 only — blank canvas) ─────── */}
        {!hasContent ? (
          <Pressable
            // The whole right-bottom region is the dismissal hit area for
            // the coachmark (per design: "Tap anywhere on screen to dismiss
            // permanently"). The send button intercepts its own taps via
            // event ordering — nested Pressable's onPress fires first.
            onPress={() => {
              if (coachmarkVisible) dismissCoachmark();
            }}
            style={{
              position: "absolute",
              right: 0,
              left: 0,
              bottom: 0,
              top: 0,
              // pointerEvents-box-none: only the children handle taps.
              // We need the actual hits-anywhere-to-dismiss; let the
              // background Pressable claim them.
            }}
            pointerEvents={coachmarkVisible ? "auto" : "box-none"}
          >
            <View
              pointerEvents="box-none"
              style={{
                position: "absolute",
                right: 20,
                bottom: Math.max(insets.bottom, 16) + 8,
                alignItems: "flex-end",
              }}
            >
              {shouldShowCoachmark ? <FirstNoteCoachmark /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSend }}
                accessibilityLabel="Send note"
                onPress={() => {
                  if (coachmarkVisible) dismissCoachmark();
                  void handleSend();
                }}
                disabled={!canSend}
                style={({ pressed }) => ({
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: canSend ? accent : surfaceChip,
                  opacity: canSend ? 1 : 0.6,
                  borderWidth: canSend ? 0 : 1,
                  borderColor: borderColor,
                  shadowColor: "#000",
                  shadowOpacity: canSend ? 0.18 : 0.05,
                  shadowRadius: canSend ? 10 : 2,
                  shadowOffset: { width: 0, height: canSend ? 4 : 1 },
                  elevation: canSend ? 4 : 1,
                  transform: [{ scale: pressed && canSend ? 0.95 : 1 }],
                })}
              >
                <ArrowUpIcon
                  size={24}
                  color={canSend ? accentOn : tokens["text-tertiary"]}
                  weight="bold"
                />
              </Pressable>
            </View>
          </Pressable>
        ) : null}

        {/* TODO: <InboxSheet ... /> renders here once Agent 2 ships it */}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────────── */

function IconButton(props: {
  icon: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        opacity: pressed ? 0.55 : 1,
        transform: [{ scale: pressed ? 0.95 : 1 }],
      })}
    >
      {props.icon}
    </Pressable>
  );
}

function ToolbarButton(props: {
  onPress: () => void;
  accessibilityLabel: string;
  icon?: React.ReactNode;
  content?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        marginRight: 4,
        opacity: pressed ? 0.55 : 1,
      })}
    >
      {props.content ?? props.icon}
    </Pressable>
  );
}

function FollowUpInput(props: {
  value: string;
  onChangeText: (s: string) => void;
  placeholder: string;
  placeholderColor: string;
  inkColor: string;
  caretColor: string;
  inputRef: (r: TextInput | null) => void;
  isLast: boolean;
}) {
  return (
    <View style={{ marginTop: 16, marginBottom: props.isLast ? 0 : 4 }}>
      <TextInput
        ref={props.inputRef}
        value={props.value}
        onChangeText={props.onChangeText}
        multiline
        placeholder={props.placeholder}
        placeholderTextColor={props.placeholderColor}
        selectionColor={props.caretColor}
        scrollEnabled={false}
        textAlignVertical="top"
        style={{
          minHeight: 40,
          fontFamily: "Inter-Regular",
          fontSize: typography.body.fontSize,
          lineHeight: typography.body.lineHeight,
          letterSpacing: -0.187,
          color: props.inkColor,
          padding: 0,
          margin: 0,
          textAlignVertical: "top",
        }}
      />
    </View>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function persistedRunToBlockState(run: PersistedRun): AgentRunBlockState {
  return {
    status: run.status,
    prompt: run.prompt,
    response: run.response,
    toolUses: run.toolUses,
    durationMs: run.durationMs,
    costUsd: run.costUsd,
    error: run.error,
  };
}

function inflightToBlockState(run: InflightRun): AgentRunBlockState {
  return {
    status: run.status,
    prompt: run.prompt,
    response: run.response,
    toolUses: run.toolUses,
    durationMs: run.durationMs,
    costUsd: run.costUsd,
    error: run.error,
  };
}

function insertAtBodyEnd(
  fragment: string,
  setBody: (s: string) => void,
  current: string,
) {
  const next =
    current.length > 0 && !current.endsWith("\n") && !fragment.startsWith("\n")
      ? `${current}\n${fragment}`
      : `${current}${fragment}`;
  setBody(next);
}

function insertAtFollowUpEnd(
  fragment: string,
  idx: number,
  current: string,
  update: (idx: number, text: string) => void,
) {
  if (idx < 0) return;
  const next =
    current.length > 0 && !current.endsWith("\n") && !fragment.startsWith("\n")
      ? `${current}\n${fragment}`
      : `${current}${fragment}`;
  update(idx, next);
}

/** Phase 2 stub for dispatch detection — grabs the first ticket-like token
 *  (`ABC-123`) from the title or body. */
function extractDispatchSignal(title: string, body: string): string | null {
  const haystack = `${title}\n${body}`;
  const match = haystack.match(/\b[A-Z]{2,}-\d+\b/);
  return match ? match[0] : null;
}
