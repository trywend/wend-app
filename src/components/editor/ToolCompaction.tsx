/**
 * Wend — ToolCompaction.
 *
 * Groups consecutive same-kind tool calls inside the tool drawer so a
 * long run (e.g. 8 Edits + 4 Reads + 2 Bash) collapses into 3 rows
 * instead of 14. Mixed sequences still render individually but adjacent
 * same-kind runs collapse.
 *
 * Each grouped row is tap-to-expand: tapping reveals the per-call input
 * preview (file path / command / etc.) as a sub-list. Single-call rows
 * render the same card as before — no extra chrome.
 *
 * The grouping helper `compactToolCalls` is exported standalone for
 * testing and for any other surface that wants the same compaction.
 */

import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { CaretDownIcon, CaretRightIcon } from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import type { ToolCall } from "@/components/editor/AgentRunBlock";

/* ─── Grouping ─────────────────────────────────────────────────────────── */

export type CompactedGroup =
  | { kind: "single"; call: ToolCall }
  | { kind: "group"; name: string; calls: ToolCall[] };

/**
 * Groups consecutive calls with the same `name` into a single CompactedGroup.
 * Only groups runs of 2+ — a lone call between two different-named calls
 * stays as a "single" row to avoid empty-looking expanders.
 */
export function compactToolCalls(calls: ToolCall[]): CompactedGroup[] {
  const out: CompactedGroup[] = [];
  let i = 0;
  while (i < calls.length) {
    const name = calls[i]!.name;
    let j = i + 1;
    while (j < calls.length && calls[j]!.name === name) j += 1;
    const run = calls.slice(i, j);
    if (run.length >= 2) {
      out.push({ kind: "group", name, calls: run });
    } else {
      out.push({ kind: "single", call: run[0]! });
    }
    i = j;
  }
  return out;
}

/* ─── Verbing — turn "Edit" into "Edited", "Read" into "Read" ──────────── */

function verbForGroup(name: string, count: number): string {
  // Map common Claude tool names to a natural past-tense action phrase.
  // Anything we don't recognize gets a generic "<Name> called N times".
  const lower = name.toLowerCase();
  switch (lower) {
    case "edit":
    case "multiedit":
      return `Edited ${count} files`;
    case "write":
    case "create":
      return `Wrote ${count} files`;
    case "read":
      return `Read ${count} files`;
    case "bash":
      return `Ran ${count} commands`;
    case "glob":
      return `Searched with ${count} globs`;
    case "grep":
      return `Ran ${count} searches`;
    case "webfetch":
      return `Fetched ${count} URLs`;
    case "websearch":
      return `Ran ${count} web searches`;
    case "task":
    case "agent":
      return `Ran ${count} subagents`;
    case "notebookedit":
      return `Edited ${count} notebook cells`;
    default:
      return `${name} ×${count}`;
  }
}

/* ─── Per-call preview text ────────────────────────────────────────────── */

/**
 * Produce a 1-line preview line for a tool call within a grouped sub-list.
 * Mirrors AgentRunBlock.summarizeToolInput but tuned for the sub-list
 * context — we drop the "key: " prefix and just show the value, since the
 * group header already establishes what kind of call this is.
 */
function previewForCall(call: ToolCall): string | null {
  const input = call.input;
  if (input == null) return null;
  if (typeof input === "string") return input;
  if (typeof input !== "object") return String(input);
  const obj = input as Record<string, unknown>;
  for (const key of [
    "file_path",
    "path",
    "command",
    "query",
    "pattern",
    "url",
    "description",
  ]) {
    const v = obj[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  try {
    const json = JSON.stringify(obj);
    return json.length > 120 ? json.slice(0, 119) + "…" : json;
  } catch {
    return null;
  }
}

/* ─── Components ───────────────────────────────────────────────────────── */

export interface ToolCompactionProps {
  calls: ToolCall[];
}

export function ToolCompaction({ calls }: ToolCompactionProps) {
  const groups = useMemo(() => compactToolCalls(calls), [calls]);

  return (
    <View style={{ gap: 6 }}>
      {groups.map((g, i) =>
        g.kind === "group" ? (
          <GroupRow key={`g-${i}`} group={g} startIndex={startIndexFor(groups, i)} />
        ) : (
          <SingleRow key={`s-${i}`} call={g.call} index={startIndexFor(groups, i) + 1} />
        ),
      )}
    </View>
  );
}

/**
 * Compute the 1-based index of the first call in group `i`. Used to keep
 * the numeric index consistent across compacted + expanded sub-lists so
 * a user can tell "this was the 7th tool call" at a glance.
 */
function startIndexFor(groups: CompactedGroup[], i: number): number {
  let n = 0;
  for (let k = 0; k < i; k++) {
    const g = groups[k]!;
    n += g.kind === "single" ? 1 : g.calls.length;
  }
  return n;
}

/* ─── Single-call row (same look as the old ToolCallCard) ──────────────── */

function SingleRow({ call, index }: { call: ToolCall; index: number }) {
  const { tokens } = useTheme();
  const preview = useMemo(() => previewForCall(call), [call]);
  const previewKey = useMemo(() => previewKeyFor(call), [call]);
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: tokens["border-hairline"],
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
        backgroundColor: tokens["surface-elevated"],
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text
          style={{
            fontFamily: "JetBrainsMono-Medium",
            fontSize: 10.5,
            color: tokens["text-tertiary"],
            minWidth: 18,
          }}
        >
          {String(index).padStart(2, "0")}
        </Text>
        <Text
          style={{
            fontFamily: "JetBrainsMono-Medium",
            fontSize: 12,
            color: tokens["text-primary"],
            letterSpacing: -0.2,
          }}
        >
          {call.name}
        </Text>
      </View>
      {preview ? (
        <Text
          numberOfLines={2}
          style={{
            marginTop: 4,
            marginLeft: 24,
            fontFamily: "JetBrainsMono",
            fontSize: 11,
            lineHeight: 16,
            color: tokens["text-secondary"],
          }}
        >
          {previewKey ? `${previewKey}: ${preview}` : preview}
        </Text>
      ) : null}
    </View>
  );
}

function previewKeyFor(call: ToolCall): string | null {
  const input = call.input;
  if (input == null || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  for (const key of [
    "file_path",
    "path",
    "command",
    "query",
    "pattern",
    "url",
    "description",
  ]) {
    if (typeof obj[key] === "string") return key;
  }
  return null;
}

/* ─── Grouped row — tap to expand sub-list ─────────────────────────────── */

function GroupRow({
  group,
  startIndex,
}: {
  group: Extract<CompactedGroup, { kind: "group" }>;
  startIndex: number;
}) {
  const { tokens } = useTheme();
  const [open, setOpen] = useState(false);
  const label = useMemo(
    () => verbForGroup(group.name, group.calls.length),
    [group],
  );

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: tokens["border-hairline"],
        borderRadius: 10,
        backgroundColor: tokens["surface-elevated"],
        overflow: "hidden",
      }}
    >
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={open ? `Hide ${group.name} sub-list` : `Show ${group.name} sub-list`}
        style={({ pressed }) => ({
          paddingHorizontal: 10,
          paddingVertical: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text
          style={{
            fontFamily: "JetBrainsMono-Medium",
            fontSize: 10.5,
            color: tokens["text-tertiary"],
            minWidth: 18,
          }}
        >
          {String(startIndex + 1).padStart(2, "0")}
        </Text>
        <Text
          style={{
            fontFamily: "Inter-SemiBold",
            fontSize: 12.5,
            color: tokens["text-primary"],
            letterSpacing: -0.1,
          }}
        >
          {label}
        </Text>
        <View style={{ flex: 1 }} />
        {open ? (
          <CaretDownIcon size={12} color={tokens["text-tertiary"]} weight="bold" />
        ) : (
          <CaretRightIcon size={12} color={tokens["text-tertiary"]} weight="bold" />
        )}
      </Pressable>
      {open ? (
        <Animated.View
          entering={FadeIn.duration(140)}
          style={{
            paddingHorizontal: 10,
            paddingBottom: 8,
            paddingTop: 0,
            gap: 2,
            borderTopWidth: 1,
            borderTopColor: tokens["border-hairline"],
          }}
        >
          {group.calls.map((c, i) => {
            const preview = previewForCall(c);
            return (
              <View
                key={i}
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  paddingTop: 6,
                  gap: 8,
                }}
              >
                <Text
                  style={{
                    fontFamily: "JetBrainsMono-Medium",
                    fontSize: 10.5,
                    color: tokens["text-tertiary"],
                    minWidth: 18,
                  }}
                >
                  {String(startIndex + 1 + i).padStart(2, "0")}
                </Text>
                <Text
                  numberOfLines={2}
                  style={{
                    flex: 1,
                    fontFamily: "JetBrainsMono",
                    fontSize: 11.5,
                    lineHeight: 17,
                    color: tokens["text-secondary"],
                  }}
                >
                  {preview ?? "(no input)"}
                </Text>
              </View>
            );
          })}
        </Animated.View>
      ) : null}
    </View>
  );
}
