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
import { humanizeDispatchError } from "@/lib/dispatch/humanizeError";
import { ToolCompaction } from "@/components/editor/ToolCompaction";
import { FileChangesSummary } from "@/components/editor/FileChangesSummary";
import { RunLinksSummary } from "@/components/editor/RunLinksSummary";
import { DeliverablesSection } from "@/components/editor/deliverables/DeliverablesSection";
import type { Artifact } from "@/lib/notes-storage";

export interface ToolCall {
  name: string;
  /** Raw input object from Claude — rendered as a 1-2 line preview. Optional
   *  because older persisted runs don't carry input. */
  input?: unknown;
}

export interface AgentRunBlockState {
  /** The PersistedRun id — used to build artifact download URLs
   *  (`/run/<runId>/artifact/<id>`). Absent on the in-flight run. */
  runId?: string;
  status: "running" | "done" | "error";
  /** What was sent to Claude — used to extract a ticket chip. */
  prompt: string;
  /** Accumulated streamed text (markdown) — interim reasoning + final answer
   *  in order. Used for expansion and file/link extraction. */
  response: string;
  /** Interim "thinking" text between tool calls. Hidden by default, revealed
   *  on tap. Absent on old rows → treated as empty. */
  reasoning?: string;
  /** Final deliverable text — the trailing segment after the last tool call.
   *  This is what the note produced. Absent on old rows / catch-up → falls
   *  back to `response`. */
  answer?: string;
  /** Name-only chip strip — preserved for back-compat. */
  toolUses: string[];
  /** Richer per-call records when available. */
  toolCalls?: ToolCall[];
  /** Deliverable URLs persisted on the run (cloud backend). */
  links?: string[];
  /** Downloadable deliverables the run produced — diff, files, html, answer. */
  artifacts?: Artifact[];
  /** stderr lines from a run that still succeeded. Rendered as a subtle
   *  collapsed "N warnings" one-liner, never with the error treatment. */
  warnings?: string[];
  durationMs: number;
  costUsd: number;
  /** Total tokens (input + output + cache). Shown in the header instead of
   *  cost. Absent on old rows → header shows duration only. */
  tokens?: number;
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
  /** The Mac stream dropped and the dispatcher is re-attaching — shows
   *  "Reconnecting…" in the header while the run keeps going on the Mac. */
  reconnecting?: boolean;
}

export function AgentRunBlock({
  state,
  onStop,
  projectName,
  onRetry,
  onOpenFile,
  reconnecting,
}: AgentRunBlockProps) {
  const { tokens } = useTheme();
  const running = state.status === "running";
  const errored = state.status === "error";
  const done = state.status === "done";

  const ticket = useMemo(() => extractTicket(state.prompt), [state.prompt]);

  // The final deliverable text is what the note produced — shown as the run's
  // output. `reasoning` is the interim thinking, hidden by default. Old rows
  // and cross-device catch-up carry only `response`; fall back to it as the
  // answer so nothing is lost.
  const answerText = state.answer ?? state.response;
  const reasoningText = state.reasoning ?? "";
  const hasReasoning = reasoningText.trim().length > 0;

  // Full-response blocks feed file/link extraction (a path may be mentioned in
  // reasoning). Answer blocks render the deliverable body.
  const fullBlocks = useMemo(
    () => parseMarkdown(state.response),
    [state.response],
  );
  const answerBlocks = useMemo(
    () => parseMarkdown(answerText),
    [answerText],
  );
  const summary = useMemo(
    () => summarizeMarkdown(answerText, 90),
    [answerText],
  );

  // Body fold state. Done starts COLLAPSED — long conversations stay
  // skimmable, the user taps to expand. Running and error force-open below.
  const [bodyOpen, setBodyOpen] = useState(false);
  // Tool drawer fold state. Closed by default to keep the body the focus.
  const [toolsOpen, setToolsOpen] = useState(false);
  // Thinking drawer fold state. Closed by default — the larp stays minimized
  // unless the user asks for it.
  const [thinkingOpen, setThinkingOpen] = useState(false);
  // Warnings fold state — the "N warnings" one-liner expands on tap.
  const [warningsOpen, setWarningsOpen] = useState(false);
  const warnings = state.warnings ?? [];

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

  // Deliverables the run produced — the primary one leads the collapsed card,
  // all of them render on expand. Only surfaced on completed runs (they land
  // with the done event).
  const artifacts = state.artifacts ?? [];
  const hasArtifacts = done && artifacts.length > 0;

  // Deliverables — files touched + links produced. Rendered in every state
  // (collapsed, expanded, running) so the note's output is always the focus.
  const deliverables = (
    <>
      <FileChangesSummary
        blocks={fullBlocks}
        toolCalls={calls}
        onOpenFile={onOpenFile}
      />
      <RunLinksSummary blocks={fullBlocks} toolCalls={calls} links={state.links} />
    </>
  );

  // Running with no deliverable text yet: show one terse activity line derived
  // from the latest tool, not the streaming reasoning prose.
  const activity = running ? activityLabel(calls) : null;
  // Stream text as the answer only before any tool fires (a tool-free Q&A).
  // Once tools are in play the run is "reason → act → deliver"; we hold the
  // deliverable until completion and show just the activity line meanwhile,
  // so the reasoning chatter never lands on screen.
  const answerStreaming =
    running && !hasTools && answerText.trim().length > 0;

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

          {/* Running + dropped stream: re-attach status. */}
          {running && reconnecting ? (
            <Text
              style={{
                fontFamily: "Inter-Medium",
                fontSize: 11.5,
                color: tertiary,
              }}
            >
              Reconnecting to your Mac…
            </Text>
          ) : null}

          {/* Done: tokens/duration in header, then caret. */}
          {done && (state.durationMs > 0 || (state.tokens ?? 0) > 0) ? (
            <Text
              style={{
                fontFamily: "JetBrainsMono",
                fontSize: 11,
                color: tertiary,
              }}
            >
              {formatDuration(state.durationMs)}
              {(state.tokens ?? 0) > 0 ? ` · ${formatTokens(state.tokens!)}` : ""}
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

      {/* ─── Collapsed card (done && !bodyOpen) — deliverable first ────────
          Leads with what the note produced (files / links), then a short
          summary of the FINAL answer (not the run's opening reasoning), then
          a muted tool count. The full AI output lives behind expansion. */}
      {done && !bodyOpen ? (
        <Animated.View entering={FadeIn.duration(160)}>
          {deliverables}
          {hasArtifacts ? (
            <>
              <DeliverablesSection
                artifacts={artifacts}
                runId={state.runId}
                answerText={answerText}
                mode="collapsed"
                onOpenFile={onOpenFile}
              />
              {hasTools ? (
                <View style={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: 12 }}>
                  <Text
                    style={{
                      fontFamily: "Inter-Medium",
                      fontSize: 11.5,
                      color: tertiary,
                      letterSpacing: -0.1,
                    }}
                  >
                    {`+${calls.length} ${calls.length === 1 ? "tool" : "tools"}`}
                  </Text>
                </View>
              ) : null}
            </>
          ) : summary.length > 0 || hasTools ? (
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
          ) : null}
        </Animated.View>
      ) : null}

      {/* ─── Body — deliverable-first: files/links, the final answer, then
          the thinking + raw tools tucked behind disclosures ────────────── */}
      {showBody ? (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
          {/* What the note produced — always first. */}
          {deliverables}

          {/* Running, no deliverable text yet — one terse activity line
              instead of streaming the reasoning. The larp stays off-screen;
              tap "Thinking" to see it. */}
          {running && !answerStreaming && !errored ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 14,
                paddingTop: 12,
                paddingBottom: 12,
              }}
            >
              <Text
                style={{
                  fontFamily: "Inter-Medium",
                  fontSize: 13,
                  color: subtle,
                  letterSpacing: -0.1,
                }}
              >
                {activity}
              </Text>
              {hasTools ? (
                <Text
                  style={{
                    fontFamily: "Inter-Medium",
                    fontSize: 11.5,
                    color: tertiary,
                    letterSpacing: -0.1,
                  }}
                >
                  {`· ${calls.length} ${calls.length === 1 ? "tool" : "tools"}`}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Final deliverable text — the answer. While running with tools we
              withhold it (answerStreaming is false) so mid-run reasoning text
              never renders here; it lands only once the run is done. On error,
              show whatever came back. */}
          {(errored
            ? state.response.length > 0
            : done
              ? answerText.length > 0 && !hasArtifacts
              : answerStreaming) ? (
            <View
              style={{
                paddingHorizontal: 14,
                paddingTop: 14,
                paddingBottom: errored || (done && (state.tokens ?? 0) === 0 && state.durationMs === 0) ? 14 : 6,
              }}
            >
              <Markdown
                blocks={errored ? fullBlocks : answerBlocks}
                onOpenFile={onOpenFile}
              />
              {answerStreaming ? (
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

          {/* Deliverables in full — every artifact, primary first. Replaces
              the plain answer markdown above once the run has artifacts. */}
          {hasArtifacts ? (
            <DeliverablesSection
              artifacts={artifacts}
              runId={state.runId}
              answerText={answerText}
              mode="expanded"
              onOpenFile={onOpenFile}
            />
          ) : null}

          {/* Thinking — interim reasoning, collapsed by default. */}
          {hasReasoning ? (
            <ThinkingDrawer
              text={reasoningText}
              open={thinkingOpen}
              onToggle={() => setThinkingOpen((v) => !v)}
              tertiary={tertiary}
            />
          ) : null}

          {/* Raw tool calls. */}
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

          {/* Error caption + Retry */}
          {errored && state.error ? (
            <View
              style={{
                paddingHorizontal: 14,
                paddingVertical: 12,
                gap: 10,
                borderTopWidth: state.response.length > 0 ? 1 : 0,
                borderTopColor: border,
                backgroundColor: `${tokens["status-failed"]}0A`,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 9,
                }}
              >
                <View style={{ marginTop: 1 }}>
                  <WarningIcon
                    size={15}
                    color={tokens["status-failed"]}
                    weight="fill"
                  />
                </View>
                <Text
                  style={{
                    flex: 1,
                    fontFamily: "Inter-Regular",
                    fontSize: 13,
                    color: tokens["status-failed"],
                    lineHeight: 19,
                  }}
                >
                  {humanizeDispatchError(state.error)}
                </Text>
              </View>
              {onRetry ? (
                <View style={{ flexDirection: "row" }}>
                  <View
                    style={{
                      position: "relative",
                      height: 30,
                      borderRadius: 15,
                      paddingHorizontal: 14,
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
                </View>
              ) : null}
            </View>
          ) : null}
        </Animated.View>
      ) : null}

      {/* ─── Warnings (done runs only) — subtle one-liner, expands on tap.
          Deliberately NOT the red error treatment: these are stderr lines
          from a run that succeeded. ─────────────────────────────────────── */}
      {done && warnings.length > 0 ? (
        <View>
          <Pressable
            onPress={() => setWarningsOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={warningsOpen ? "Hide warnings" : "Show warnings"}
            style={{
              paddingHorizontal: 14,
              paddingTop: 2,
              paddingBottom: warningsOpen ? 6 : 12,
            }}
          >
            <Text
              style={{
                fontFamily: "Inter-Medium",
                fontSize: 11.5,
                color: tertiary,
                letterSpacing: -0.1,
              }}
            >
              {`${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}`}
            </Text>
          </Pressable>
          {warningsOpen ? (
            <Animated.View
              entering={FadeIn.duration(160)}
              style={{ paddingHorizontal: 14, paddingBottom: 12 }}
            >
              {warnings.map((w, i) => (
                <Text
                  key={i}
                  style={{
                    fontFamily: "JetBrainsMono",
                    fontSize: 11,
                    lineHeight: 16,
                    color: tertiary,
                    marginTop: i === 0 ? 0 : 4,
                  }}
                >
                  {w}
                </Text>
              ))}
            </Animated.View>
          ) : null}
        </View>
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

/* ─── Thinking drawer ───────────────────────────────────────────────────────
   Holds the interim reasoning — the "let me get context…" chatter Claude
   streams between tool calls. Collapsed by default; the note's output is the
   final answer above, not this. Rendered as dim prose, never the focus. */

function ThinkingDrawer({
  text,
  open,
  onToggle,
  tertiary,
}: {
  text: string;
  open: boolean;
  onToggle: () => void;
  tertiary: string;
}) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <View>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={open ? "Hide thinking" : "Show thinking"}
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
          Thinking
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
            paddingBottom: 10,
            opacity: 0.75,
          }}
        >
          <Markdown blocks={blocks} />
        </Animated.View>
      ) : null}
    </View>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────────── */

/**
 * One terse present-tense line for the running state, derived from the most
 * recent tool call. Deliberately generic — enough to say "it's doing
 * something" without leaking the reasoning stream onto the phone.
 */
function activityLabel(calls: ToolCall[]): string {
  const last = calls[calls.length - 1];
  if (!last) return "Working…";
  const name = last.name;
  if (/^(Read|Grep|Glob|LS|NotebookRead)$/.test(name)) return "Reading…";
  if (/^(Edit|MultiEdit|Write|Create|NotebookEdit)$/.test(name)) return "Writing…";
  if (name === "Bash") return "Running a command…";
  if (/^(WebFetch|WebSearch)$/.test(name)) return "Searching…";
  if (name === "Task") return "Working…";
  return "Working…";
}

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

function formatTokens(n: number): string {
  if (n < 1000) return `${n} tok`;
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k tok`;
  }
  const m = n / 1_000_000;
  return `${m.toFixed(1).replace(/\.0$/, "")}M tok`;
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
