/**
 * Wend — ToolCompaction.
 *
 * The tool drawer's inner content. Renders Claude's tool calls as a
 * clean IDE-style list:
 *
 *   - Each row is icon + label + (optional) target — no borders, no
 *     per-row cards, no debug-log numbering.
 *   - Consecutive same-kind calls compact into a single row ("Edited 8
 *     files") with a chevron to expand and see each one.
 *   - File path / command targets render in mono-tertiary as a subtle
 *     secondary line; everything else uses Inter.
 *   - Icons are kind-mapped: pencil for Edit, eye for Read, terminal
 *     for Bash, magnifier for search, etc.
 *
 * `compactToolCalls` is exported standalone so any other surface that
 * wants the same grouping (notification subtitle, history view) can
 * reuse it without dragging the React component along.
 */

import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import {
  CaretDownIcon,
  CaretRightIcon,
  CodeIcon,
  EyeIcon,
  FilePlusIcon,
  GlobeIcon,
  LightningIcon,
  MagnifyingGlassIcon,
  NotebookIcon,
  PencilSimpleIcon,
  TerminalIcon,
  WrenchIcon,
  type Icon as PhosphorIcon,
} from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import type { ToolCall } from "@/components/editor/AgentRunBlock";

/* ─── Grouping ─────────────────────────────────────────────────────────── */

export type CompactedGroup =
  | { kind: "single"; call: ToolCall }
  | { kind: "group"; name: string; calls: ToolCall[] };

/**
 * Groups consecutive calls with the same `name`. Runs of 2+ collapse into
 * an expandable group; lone calls stay as single rows.
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

/* ─── Tool-kind → icon + label ──────────────────────────────────────────── */

/** Returns the icon component, a short verb (e.g. "Edited"), and a noun
 *  (e.g. "files") for a given tool name. The verb is what the row reads
 *  as for the user; noun pluralizes with count. */
function metaFor(name: string): {
  Icon: PhosphorIcon;
  singularVerb: string;
  pastVerb: string;
  noun: string;
} {
  const lower = name.toLowerCase();
  switch (lower) {
    case "edit":
    case "multiedit":
      return { Icon: PencilSimpleIcon, singularVerb: "Edit", pastVerb: "Edited", noun: "files" };
    case "write":
    case "create":
      return { Icon: FilePlusIcon, singularVerb: "Wrote", pastVerb: "Wrote", noun: "files" };
    case "read":
      return { Icon: EyeIcon, singularVerb: "Read", pastVerb: "Read", noun: "files" };
    case "bash":
      return { Icon: TerminalIcon, singularVerb: "Ran", pastVerb: "Ran", noun: "commands" };
    case "glob":
      return { Icon: MagnifyingGlassIcon, singularVerb: "Searched", pastVerb: "Searched", noun: "globs" };
    case "grep":
      return { Icon: MagnifyingGlassIcon, singularVerb: "Searched", pastVerb: "Searched", noun: "patterns" };
    case "webfetch":
      return { Icon: GlobeIcon, singularVerb: "Fetched", pastVerb: "Fetched", noun: "URLs" };
    case "websearch":
      return { Icon: GlobeIcon, singularVerb: "Searched", pastVerb: "Searched", noun: "queries" };
    case "task":
    case "agent":
      return { Icon: LightningIcon, singularVerb: "Ran", pastVerb: "Ran", noun: "subagents" };
    case "notebookedit":
      return { Icon: NotebookIcon, singularVerb: "Edited", pastVerb: "Edited", noun: "cells" };
    case "code":
      return { Icon: CodeIcon, singularVerb: "Wrote", pastVerb: "Wrote", noun: "snippets" };
    default:
      return { Icon: WrenchIcon, singularVerb: name, pastVerb: name, noun: "calls" };
  }
}

/* ─── Per-call target extraction ────────────────────────────────────────── */

/** Returns a short, user-facing target string for a tool call — typically
 *  the file path / command / query the call operated on. Returns null when
 *  the input has nothing relatable. */
function targetFor(call: ToolCall): string | null {
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
  return null;
}

/** Compact a file path to "…/parent/file.ts" so long absolute paths don't
 *  bust the row layout. Leaves short paths alone. */
function shortenPath(path: string, maxLen = 44): string {
  if (path.length <= maxLen) return path;
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 2) {
    // Single very long segment — truncate with ellipsis from the LEFT so
    // the actual filename remains visible.
    return "…" + path.slice(path.length - (maxLen - 1));
  }
  // Keep last 2 segments — `parent/file.ext` — prefixed with ellipsis.
  const tail = segments.slice(-2).join("/");
  const short = "…/" + tail;
  if (short.length <= maxLen) return short;
  return "…/" + tail.slice(tail.length - (maxLen - 2));
}

/* ─── Public render component ───────────────────────────────────────────── */

export interface ToolCompactionProps {
  calls: ToolCall[];
}

export function ToolCompaction({ calls }: ToolCompactionProps) {
  const groups = useMemo(() => compactToolCalls(calls), [calls]);
  return (
    <View>
      {groups.map((g, i) =>
        g.kind === "group" ? (
          <GroupRow key={`g-${i}`} group={g} />
        ) : (
          <SingleRow key={`s-${i}`} call={g.call} />
        ),
      )}
    </View>
  );
}

/* ─── Atomic row primitives ─────────────────────────────────────────────── */

function RowFrame({
  onPress,
  children,
}: {
  onPress?: () => void;
  children: React.ReactNode;
}) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => ({
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View
          style={{
            paddingHorizontal: 4,
            paddingVertical: 8,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          {children}
        </View>
      </Pressable>
    );
  }
  return (
    <View
      style={{
        paddingHorizontal: 4,
        paddingVertical: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
      }}
    >
      {children}
    </View>
  );
}

function IconWell({
  Icon,
  color,
  bg,
}: {
  Icon: PhosphorIcon;
  color: string;
  bg: string;
}) {
  return (
    <View
      style={{
        width: 26,
        height: 26,
        borderRadius: 7,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon size={14} color={color} weight="regular" />
    </View>
  );
}

/* ─── Single-call row ──────────────────────────────────────────────────── */

function SingleRow({ call }: { call: ToolCall }) {
  const { tokens } = useTheme();
  const meta = useMemo(() => metaFor(call.name), [call.name]);
  const target = useMemo(() => targetFor(call), [call]);
  const isPath = target != null && target.includes("/");
  const display = useMemo(
    () => (target && isPath ? shortenPath(target) : target),
    [target, isPath],
  );

  return (
    <RowFrame>
      <IconWell
        Icon={meta.Icon}
        color={tokens["accent-default"]}
        bg={`${tokens["accent-default"]}14`}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            fontFamily: "Inter-SemiBold",
            fontSize: 13,
            color: tokens["text-primary"],
            letterSpacing: -0.1,
          }}
          numberOfLines={1}
        >
          {meta.singularVerb}
          {display ? "" : "…"}
        </Text>
        {display ? (
          <Text
            style={{
              marginTop: 1,
              fontFamily: isPath ? "JetBrainsMono" : "Inter-Regular",
              fontSize: 11.5,
              lineHeight: 15,
              color: tokens["text-tertiary"],
            }}
            numberOfLines={1}
          >
            {display}
          </Text>
        ) : null}
      </View>
    </RowFrame>
  );
}

/* ─── Grouped row — tap to expand sub-list ─────────────────────────────── */

function GroupRow({
  group,
}: {
  group: Extract<CompactedGroup, { kind: "group" }>;
}) {
  const { tokens } = useTheme();
  const [open, setOpen] = useState(false);
  const meta = useMemo(() => metaFor(group.name), [group.name]);

  return (
    <View>
      <RowFrame onPress={() => setOpen((v) => !v)}>
        <IconWell
          Icon={meta.Icon}
          color={tokens["accent-default"]}
          bg={`${tokens["accent-default"]}14`}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{
              fontFamily: "Inter-SemiBold",
              fontSize: 13,
              color: tokens["text-primary"],
              letterSpacing: -0.1,
            }}
            numberOfLines={1}
          >
            {meta.pastVerb} {group.calls.length} {meta.noun}
          </Text>
        </View>
        {open ? (
          <CaretDownIcon
            size={12}
            color={tokens["text-tertiary"]}
            weight="bold"
          />
        ) : (
          <CaretRightIcon
            size={12}
            color={tokens["text-tertiary"]}
            weight="bold"
          />
        )}
      </RowFrame>
      {open ? (
        <Animated.View
          entering={FadeIn.duration(120)}
          style={{
            paddingLeft: 40, // icon (26) + gap (10) + frame padding (4)
            paddingBottom: 4,
          }}
        >
          {group.calls.map((c, i) => {
            const target = targetFor(c);
            const isPath = target != null && target.includes("/");
            const display = target && isPath ? shortenPath(target, 50) : target;
            return (
              <View
                key={i}
                style={{
                  paddingVertical: 4,
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    fontFamily: isPath ? "JetBrainsMono" : "Inter-Regular",
                    fontSize: 11.5,
                    lineHeight: 16,
                    color: tokens["text-secondary"],
                  }}
                >
                  {display ?? "—"}
                </Text>
              </View>
            );
          })}
        </Animated.View>
      ) : null}
    </View>
  );
}
