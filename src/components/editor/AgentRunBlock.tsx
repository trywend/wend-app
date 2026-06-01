/**
 * Wend — AgentRunBlock.
 *
 * The S3 design visual for a single agent run, rendered as a readonly,
 * card-shaped block inside the note. Three render states:
 *
 *   - Running: spinning circle in header, stop button, streaming text + caret.
 *   - Done:    check in header, full response, meta footer (duration · cost).
 *   - Error:   warning in header, error message in subtle color.
 *
 * Visually distinct from the user's editable text so the multi-block editor
 * reads as a transcript: [body] → [run 1] → [followUp 1] → [run 2] → ...
 *
 * Color mapping (Material → Paper & Ember tokens, per task spec):
 *   surface-container-low → tokens["surface-elevated"]
 *   paper-100             → tokens["surface-agent"]
 *   outline-variant       → tokens["border-hairline"]
 *   on-surface            → tokens["text-primary"]
 *   on-surface-variant    → tokens["text-secondary"]
 *   primary               → tokens["accent-default"]
 *   tertiary              → tokens["status-running"] (closest amber/ember match)
 */
import { useEffect, useRef } from "react";
import { Animated as RNAnimated, Easing, Pressable, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing as REasing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import {
  CheckIcon,
  CircleNotchIcon,
  StopIcon,
  WarningIcon,
} from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";

export interface AgentRunBlockState {
  status: "running" | "done" | "error";
  /** What was sent to Claude — used to extract a ticket chip. */
  prompt: string;
  /** Accumulated streamed text. */
  response: string;
  toolUses: string[];
  durationMs: number;
  costUsd: number;
  error: string | null;
}

export interface AgentRunBlockProps {
  state: AgentRunBlockState;
  /** Only rendered when status === "running". */
  onStop?: () => void;
  /** Project the daemon resolved this run into — surfaced as the 3rd chip in
   *  the header. `null`/undefined falls back to a static "Mac" label, matching
   *  the design before smart routing landed. */
  projectName?: string | null;
}

export function AgentRunBlock({ state, onStop, projectName }: AgentRunBlockProps) {
  const { tokens } = useTheme();
  const running = state.status === "running";
  const errored = state.status === "error";
  const done = state.status === "done";

  const ticket = extractTicket(state.prompt);

  /* ─── Header icon ───────────────────────────────────────────────────── */
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
    return () => {
      cancelAnimation(rotation);
    };
  }, [running, rotation]);

  const spinnerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  /* ─── Streaming caret (1Hz blink, RN Animated to match existing pattern) ─ */
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

  const headerIcon = running ? (
    <Animated.View style={spinnerStyle}>
      <CircleNotchIcon size={14} color={tokens["accent-default"]} weight="bold" />
    </Animated.View>
  ) : errored ? (
    <WarningIcon size={14} color={tokens["status-failed"]} weight="fill" />
  ) : (
    <CheckIcon size={14} color={tokens["accent-default"]} weight="bold" />
  );

  return (
    <View
      style={{
        marginTop: 16,
        borderWidth: 1,
        borderColor: tokens["border-hairline"],
        borderRadius: 12,
        backgroundColor: tokens["surface-agent"],
        overflow: "hidden",
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      }}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: tokens["border-hairline"],
          backgroundColor: tokens["surface-elevated"],
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            flexShrink: 1,
          }}
        >
          {headerIcon}
          <Text
            style={{
              marginLeft: 8,
              fontFamily: "Inter-Medium",
              fontSize: 12,
              color: tokens["text-secondary"],
            }}
          >
            Claude
          </Text>
          <Dot color={tokens["text-tertiary"]} />
          <Text
            style={{
              fontFamily: projectName ? "JetBrainsMono-Medium" : "Inter-Medium",
              fontSize: 12,
              color: projectName
                ? tokens["text-primary"]
                : tokens["text-secondary"],
              letterSpacing: projectName ? -0.2 : 0,
            }}
            numberOfLines={1}
          >
            {projectName || "Mac"}
          </Text>
          {ticket ? (
            <>
              <Dot color={tokens["text-tertiary"]} />
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
        </View>

        {running && onStop ? (
          <Pressable
            onPress={onStop}
            accessibilityRole="button"
            accessibilityLabel="Stop dispatch"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={({ pressed }) => ({
              width: 28,
              height: 28,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.55 : 1,
            })}
          >
            <StopIcon
              size={16}
              color={tokens["text-secondary"]}
              weight="fill"
            />
          </Pressable>
        ) : null}
      </View>

      {/* Tool-use chips */}
      {state.toolUses.length > 0 ? (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            paddingHorizontal: 14,
            paddingTop: 10,
          }}
        >
          {state.toolUses.map((name, i) => (
            <View
              key={`${name}-${i}`}
              style={{
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 4,
                borderWidth: 1,
                borderColor: tokens["border-hairline"],
                marginRight: 6,
                marginBottom: 4,
              }}
            >
              <Text
                style={{
                  fontFamily: "JetBrainsMono-Medium",
                  fontSize: 11,
                  color: tokens["text-secondary"],
                }}
              >
                {name}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Body — streaming or final response */}
      {state.response.length > 0 || running ? (
        <View
          style={{
            paddingHorizontal: 14,
            paddingVertical: 12,
          }}
        >
          <Text
            style={{
              fontFamily: "JetBrainsMono",
              fontSize: 14,
              lineHeight: 22,
              color: tokens["text-primary"],
            }}
          >
            {state.response}
            {running ? (
              <RNAnimated.Text
                style={{
                  opacity: caret,
                  color: tokens["accent-caret"],
                  fontFamily: "JetBrainsMono",
                }}
              >
                {"▍"}
              </RNAnimated.Text>
            ) : null}
          </Text>
        </View>
      ) : null}

      {/* Error caption */}
      {errored && state.error ? (
        <View style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
          <Text
            style={{
              fontFamily: "Inter-Regular",
              fontSize: 13,
              color: tokens["text-secondary"],
            }}
          >
            {state.error}
          </Text>
        </View>
      ) : null}

      {/* Meta footer — done state only */}
      {done && (state.durationMs > 0 || state.costUsd > 0) ? (
        <View
          style={{
            paddingHorizontal: 14,
            paddingBottom: 12,
            paddingTop: 2,
          }}
        >
          <Text
            style={{
              fontFamily: "JetBrainsMono",
              fontSize: 11,
              color: tokens["text-tertiary"],
            }}
          >
            {formatDuration(state.durationMs)}
            {state.costUsd > 0 ? ` · $${state.costUsd.toFixed(4)}` : ""}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function Dot({ color }: { color: string }) {
  return (
    <Text
      style={{
        marginHorizontal: 6,
        fontSize: 12,
        color,
      }}
    >
      •
    </Text>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function extractTicket(text: string): string | null {
  const match = text.match(/\b[A-Z]{2,}-\d+\b/);
  return match ? match[0] : null;
}
