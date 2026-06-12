/**
 * Wend — AgentRunBlock.
 *
 * Card-shaped block that renders one Claude run inside the note transcript.
 * Lives between user text and the follow-up input. Three statuses:
 *
 *   - running: spinner in header, optional stop button, streaming markdown
 *               body, blinking caret.
 *   - done:    check in header, markdown body, meta footer (duration · cost).
 *               Collapsible — the whole header is tap-to-toggle.
 *   - error:   warning in header, error caption + Retry pill.
 *
 * Goals of the redesign:
 *   1. Body reads as a note, not a terminal. Inter prose for text, mono only
 *      for inline code and code blocks. Headings, lists, blockquotes all
 *      rendered with native typography (see `Markdown.tsx`).
 *   2. Header collapses. Tap the title row to fold the run into a one-line
 *      summary while keeping the meta visible — useful in long conversations.
 *   3. Tool calls are first-class. The chip strip stays compact; expanding
 *      reveals a list of structured cards with each tool name + input preview.
 *
 * State surface keeps a backward-compat field (`toolUses: string[]`) plus a
 * richer optional `toolCalls?: ToolCall[]` for newer runs. Old persisted runs
 * without toolCalls fall back to the name-only chip strip.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated as RNAnimated, Easing, Pressable, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing as REasing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  CircleNotchIcon,
  StopIcon,
  WarningIcon,
  WrenchIcon,
} from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import { Markdown } from "@/components/editor/Markdown";
import { parseMarkdown, summarizeMarkdown } from "@/lib/agentMarkdown";
import { ToolCompaction } from "@/components/editor/ToolCompaction";
import { FileChangesSummary } from "@/components/editor/FileChangesSummary";
import { RunLinksSummary } from "@/components/editor/RunLinksSummary";

export interface ToolCall {
  name: string;
  /** Raw input object from Claude — rendered as a 1-2 line preview. Optional
   *  because older persisted runs don't carry input. */
  input?: unknown;
}

export interface AgentRunBlockState {
  status: "running" | "done" | "error";
  /** What was sent to Claude — used to extract a ticket chip. */
  prompt: string;
  /** Accumulated streamed text (markdown). */
  response: string;
  /** Name-only chip strip — preserved for back-compat. */
  toolUses: string[];
  /** Richer per-call records when available. */
  toolCalls?: ToolCall[];
  /** Deliverable URLs persisted on the run (cloud backend). */
  links?: string[];
  durationMs: number;
  costUsd: number;
  error: string | null;
}

export interface AgentRunBlockProps {
  state: AgentRunBlockState;
  /** Only rendered when status === "running". */
  onStop?: () => void;
  /** Project the daemon resolved into — surfaced as the 2nd chip. */
  projectName?: string | null;
  /** Re-run the failed prompt. */
  onRetry?: () => void;
  /** Called when the user taps a file path in the markdown response. The
   *  parent screen owns the FileViewerModal state and shows it on demand. */
  onOpenFile?: (path: string) => void;
}

export function AgentRunBlock({
  state,
  onStop,
  projectName,
  onRetry,
  onOpenFile,
}: AgentRunBlockProps) {
  const { tokens } = useTheme();
  const running = state.status === "running";
  const errored = state.status === "error";
  const done = state.status === "done";

  const ticket = useMemo(() => extractTicket(state.prompt), [state.prompt]);
  const blocks = useMemo(
    () => parseMarkdown(state.response),
    [state.response],
  );
  const summary = useMemo(
    () => summarizeMarkdown(state.response, 90),
    [state.response],
  );

  // Body fold state. Done starts COLLAPSED — long conversations stay
  // skimmable, the user taps to expand. Running and error force-open below.
  const [bodyOpen, setBodyOpen] = useState(false);
  // Tool drawer fold state. Closed by default to keep the body the focus.
  const [toolsOpen, setToolsOpen] = useState(false);

  // Running: force-open so streaming text is visible.
  // Error: force-open so the error message + retry are visible.
  // Done: respect the user's tap state (collapsed by default).
  const showBody = running || errored || bodyOpen;

  /* ─── Header spinner ──────────────────────────────────────────────── */
  const rotation = useSharedValue(0);
  useEffect(() => {
    if (running) {
      rotation.value = 0;
      rotation.value = withRepeat(
        withTiming(360, { duration: 1200, easing: REasing.linear }),
        -1,
        false,
      );
    } else {
      cancelAnimation(rotation);
      rotation.value = 0;
    }
    return () => cancelAnimation(rotation);
  }, [running, rotation]);

  const spinnerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  /* ─── Streaming caret ─────────────────────────────────────────────── */
  const caret = useRef(new RNAnimated.Value(1)).current;
  useEffect(() => {
    if (!running) return;
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(caret, {
          toValue: 0,
          duration: 0,
          delay: 500,
          easing: Easing.step0,
          useNativeDriver: true,
        }),
        RNAnimated.timing(caret, {
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
  }, [running, caret]);

  /* ─── Tokens ─────────────────────────────────────────────────────── */
  const ink = tokens["text-primary"];
  const subtle = tokens["text-secondary"];
  const tertiary = tokens["text-tertiary"];
  const border = tokens["border-hairline"];
  const accent = tokens["accent-default"];
  const surfaceAgent = tokens["surface-agent"];
  const surfaceElev = tokens["surface-elevated"];

  const headerIcon = running ? (
    <Animated.View style={spinnerStyle}>
      <CircleNotchIcon size={14} color={accent} weight="bold" />
    </Animated.View>
  ) : errored ? (
    <WarningIcon size={14} color={tokens["status-failed"]} weight="fill" />
  ) : (
    <CheckIcon size={14} color={accent} weight="bold" />
  );

  // Tool call data — prefer toolCalls if present, fall back to toolUses.
  const calls: ToolCall[] = state.toolCalls?.length
    ? state.toolCalls
    : state.toolUses.map((name) => ({ name }));
  const hasTools = calls.length > 0;

  return (
    <View
      style={{
        marginTop: 16,
        borderWidth: 1,
        borderColor: border,
        borderRadius: 14,
        backgroundColor: surfaceAgent,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOpacity: 0.05,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      }}
    >
      {/* ─── Header — tap to toggle (only when done) ─────────────────── */}
      <Pressable
        onPress={done ? () => setBodyOpen((v) => !v) : undefined}
        accessibilityRole={done ? "button" : undefined}
        accessibilityLabel={done ? (bodyOpen ? "Collapse response" : "Expand response") : undefined}
        disabled={!done}
        style={({ pressed }) => ({
          opacity: pressed && done ? 0.7 : 1,
        })}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderBottomWidth: showBody ? 1 : 0,
            borderBottomColor: border,
            backgroundColor: surfaceElev,
            gap: 8,
          }}
        >
          {headerIcon}
          <Text
            style={{
              fontFamily: "Inter-SemiBold",
              fontSize: 12.5,
              color: ink,
              letterSpacing: -0.1,
            }}
          >
            Claude
          </Text>
          <Dot color={tertiary} />
          <Text
            style={{
              fontFamily: projectName ? "JetBrainsMono-Medium" : "Inter-Medium",
              fontSize: 12,
              color: projectName ? ink : subtle,
              letterSpacing: projectName ? -0.2 : 0,
              flexShrink: 1,
            }}
            numberOfLines={1}
          >
            {projectName || "Mac"}
          </Text>
          {ticket ? (
            <>
              <Dot color={tertiary} />
              <Text
                style={{
                  fontFamily: "JetBrainsMono-Medium",
                  fontSize: 12,
                  color: tokens["status-running"],
                  letterSpacing: -0.2,
                }}
              >
                {ticket}
              </Text>
            </>
          ) : null}

          {/* Spacer */}
          <View style={{ flex: 1 }} />

          {/* Done: cost/duration in header, then caret. */}
          {done && (state.durationMs > 0 || state.costUsd > 0) ? (
            <Text
              style={{
                fontFamily: "JetBrainsMono",
                fontSize: 11,
                color: tertiary,
              }}
            >
              {formatDuration(state.durationMs)}
              {state.costUsd > 0 ? ` · $${state.costUsd.toFixed(3)}` : ""}
            </Text>
          ) : null}
          {done ? (
            bodyOpen ? (
              <CaretDownIcon size={14} color={tertiary} weight="bold" />
            ) : (
              <CaretRightIcon size={14} color={tertiary} weight="bold" />
            )
          ) : null}

          {/* Running: stop button. */}
          {running && onStop ? (
            <Pressable
              onPress={onStop}
              accessibilityRole="button"
              accessibilityLabel="Stop dispatch"
              hitSlop={8}
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <StopIcon size={14} color={subtle} weight="fill" />
            </Pressable>
          ) : null}
        </View>
      </Pressable>

      {/* ─── Collapsed summary line (done && !bodyOpen) ───────────────── */}
      {done && !bodyOpen && (summary.length > 0 || hasTools) ? (
        <Animated.View entering={FadeIn.duration(160)}>
          <View
            style={{
              paddingHorizontal: 14,
              paddingVertical: 12,
            }}
          >
            {summary.length > 0 ? (
              <Text
                numberOfLines={2}
                style={{
                  fontFamily: "Inter-Regular",
                  fontSize: 13.5,
                  lineHeight: 20,
                  color: subtle,
                  letterSpacing: -0.1,
                }}
              >
                {summary}
              </Text>
            ) : null}
            {hasTools ? (
              <Text
                style={{
                  marginTop: summary.length > 0 ? 6 : 0,
                  fontFamily: "Inter-Medium",
                  fontSize: 11.5,
                  color: tertiary,
                  letterSpacing: -0.1,
                }}
              >
                {`+${calls.length} ${calls.length === 1 ? "tool" : "tools"}`}
              </Text>
            ) : null}
          </View>
        </Animated.View>
      ) : null}

      {/* ─── Body — markdown + tool drawer + meta ─────────────────────── */}
      {showBody ? (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
          {/* Tool drawer */}
          {hasTools ? (
            <ToolDrawer
              calls={calls}
              open={toolsOpen}
              onToggle={() => setToolsOpen((v) => !v)}
              ink={ink}
              tertiary={tertiary}
              border={border}
              accent={accent}
            />
          ) : null}

          {/* File changes summary — surfaces edits ahead of the prose so
              the user doesn't have to expand the tool drawer to know
              what touched. Renders nothing if there are no paths. */}
          <FileChangesSummary
            blocks={blocks}
            toolCalls={calls}
            onOpenFile={onOpenFile}
          />

          {/* Deliverables — PRs, branches, dashboards the run produced. */}
          <RunLinksSummary blocks={blocks} toolCalls={calls} links={state.links} />

          {/* Response body */}
          {state.response.length > 0 || running ? (
            <View
              style={{
                paddingHorizontal: 14,
                paddingTop: hasTools ? 4 : 14,
                paddingBottom: errored || (done && state.costUsd === 0 && state.durationMs === 0) ? 14 : 6,
              }}
            >
              <Markdown blocks={blocks} onOpenFile={onOpenFile} />
              {running ? (
                <RNAnimated.Text
                  style={{
                    marginTop: 2,
                    opacity: caret,
                    color: tokens["accent-caret"],
                    fontFamily: "JetBrainsMono",
                    fontSize: 14,
                  }}
                >
                  {"▍"}
                </RNAnimated.Text>
              ) : null}
            </View>
          ) : null}

          {/* Error caption + Retry */}
          {errored && state.error ? (
            <View
              style={{
                paddingHorizontal: 14,
                paddingVertical: 12,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                borderTopWidth: state.response.length > 0 ? 1 : 0,
                borderTopColor: border,
                backgroundColor: `${tokens["status-failed"]}0A`,
              }}
            >
              <Text
                style={{
                  flex: 1,
                  fontFamily: "Inter-Regular",
                  fontSize: 13,
                  color: tokens["status-failed"],
                  lineHeight: 19,
                }}
              >
                {state.error}
              </Text>
              {onRetry ? (
                <View
                  style={{
                    position: "relative",
                    height: 30,
                    borderRadius: 15,
                    paddingHorizontal: 12,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: accent,
                    overflow: "hidden",
                  }}
                >
                  <ArrowClockwiseIcon size={12} color="#FFFFFF" weight="bold" />
                  <Text
                    style={{
                      marginLeft: 6,
                      fontFamily: "Inter-SemiBold",
                      fontSize: 12.5,
                      color: "#FFFFFF",
                    }}
                  >
                    Retry
                  </Text>
                  <Pressable
                    onPress={onRetry}
                    accessibilityRole="button"
                    accessibilityLabel="Retry dispatch"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                    }}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

/* ─── Tool drawer ───────────────────────────────────────────────────────── */

function ToolDrawer({
  calls,
  open,
  onToggle,
  ink,
  tertiary,
  border,
  accent,
}: {
  calls: ToolCall[];
  open: boolean;
  onToggle: () => void;
  ink: string;
  tertiary: string;
  border: string;
  accent: string;
}) {
  return (
    <View>
      {/* Drawer header — sits on the agent surface, no border, just a
       *  tappable row. Visually it reads as "this is a section divider",
       *  not "this is a card". */}
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={open ? "Hide tool calls" : "Show tool calls"}
        style={{
          paddingHorizontal: 14,
          paddingTop: 12,
          paddingBottom: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Text
          style={{
            fontFamily: "Inter-Medium",
            fontSize: 10.5,
            color: tertiary,
            letterSpacing: 1.2,
            textTransform: "uppercase",
          }}
        >
          {`${calls.length} ${calls.length === 1 ? "tool" : "tools"}`}
        </Text>
        <View style={{ flex: 1 }} />
        {open ? (
          <CaretDownIcon size={11} color={tertiary} weight="bold" />
        ) : (
          <CaretRightIcon size={11} color={tertiary} weight="bold" />
        )}
      </Pressable>

      {open ? (
        <Animated.View
          entering={FadeIn.duration(160)}
          style={{
            paddingHorizontal: 14,
            paddingBottom: 8,
          }}
        >
          <ToolCompaction calls={calls} />
        </Animated.View>
      ) : null}
    </View>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function Dot({ color }: { color: string }) {
  return (
    <View
      style={{
        width: 3,
        height: 3,
        borderRadius: 999,
        backgroundColor: color,
        opacity: 0.6,
      }}
    />
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function extractTicket(text: string): string | null {
  const match = text.match(/\b[A-Z]{2,}-\d+\b/);
  return match ? match[0] : null;
}
