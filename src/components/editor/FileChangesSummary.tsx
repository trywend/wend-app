/**
 * Wend — FileChangesSummary.
 *
 * Compact summary block rendered above the agent response markdown when
 * a run touched files. Surfaces what changed so the user doesn't have to
 * scroll the prose or expand the tool drawer.
 *
 * Sources of paths (unioned, deduped, in encounter order):
 *
 *   1. Mutation tool calls (Edit / MultiEdit / Write / Create / NotebookEdit)
 *      pulled out of `toolCalls[].input` via extractFilePathsFromToolCalls.
 *   2. File paths Claude mentioned in prose, detected by the existing
 *      `filePath` inline node in the parsed markdown.
 *
 * Each path renders as a tappable mono row (JetBrainsMono + ember color)
 * that fires the parent's `onOpenFile` handler. Tap target is the full row,
 * not just the text, for mobile reachability.
 *
 * Renders nothing if there are no paths to show — the parent doesn't have
 * to gate on this.
 */

import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { FileTextIcon } from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import {
  extractFilePathsFromBlocks,
  extractFilePathsFromToolCalls,
  FILE_MUTATION_TOOL_NAMES,
  type Block,
} from "@/lib/agentMarkdown";
import type { ToolCall } from "@/components/editor/AgentRunBlock";

export interface FileChangesSummaryProps {
  blocks: Block[];
  toolCalls: ToolCall[];
  onOpenFile?: (path: string) => void;
}

export function FileChangesSummary({
  blocks,
  toolCalls,
  onOpenFile,
}: FileChangesSummaryProps) {
  const { tokens } = useTheme();

  const paths = useMemo(() => {
    // Mutation-only tool calls. We don't surface Read calls here — the
    // intent of this block is "what changed", not "what was looked at".
    const mutations = toolCalls.filter((c) => FILE_MUTATION_TOOL_NAMES.has(c.name));
    const fromTools = extractFilePathsFromToolCalls(mutations);
    const fromProse = extractFilePathsFromBlocks(blocks);

    // Union with tools first — they're the authoritative "this file was
    // actually edited" signal. Prose mentions backfill anything the tools
    // missed (and any file the agent merely referenced without editing).
    const out: string[] = [];
    const seen = new Set<string>();
    for (const p of fromTools) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
    for (const p of fromProse) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
    return out;
  }, [blocks, toolCalls]);

  // Decide whether to render. Render only if EITHER:
  //   - there's at least one mutation tool call (authoritative), OR
  //   - there's at least one file path in prose AND we have paths to show.
  // The bare "prose-only" case (no mutation tools, no prose paths) falls
  // through to "render nothing".
  const hasMutation = toolCalls.some((c) => FILE_MUTATION_TOOL_NAMES.has(c.name));
  const shouldRender = (hasMutation || paths.length > 0) && paths.length > 0;
  if (!shouldRender) return null;

  const ink = tokens["text-primary"];
  const subtle = tokens["text-secondary"];
  const tertiary = tokens["text-tertiary"];
  const border = tokens["border-hairline"];
  const accent = tokens["accent-default"];
  const surface = tokens["surface-elevated"];

  const heading = `${paths.length} ${paths.length === 1 ? "file" : "files"} changed`;

  return (
    <View
      style={{
        marginHorizontal: 14,
        marginTop: 12,
        marginBottom: 4,
        borderWidth: 1,
        borderColor: border,
        borderRadius: 12,
        backgroundColor: surface,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 9,
          borderBottomWidth: 1,
          borderBottomColor: border,
        }}
      >
        <FileTextIcon size={13} color={accent} weight="regular" />
        <Text
          style={{
            fontFamily: "Inter-SemiBold",
            fontSize: 12,
            color: ink,
            letterSpacing: -0.1,
          }}
        >
          {heading}
        </Text>
      </View>
      <View>
        {paths.map((p, i) => (
          <FileRow
            key={p}
            path={p}
            isLast={i === paths.length - 1}
            onOpenFile={onOpenFile}
            ink={ink}
            subtle={subtle}
            tertiary={tertiary}
            border={border}
            accent={accent}
          />
        ))}
      </View>
    </View>
  );
}

function FileRow({
  path,
  isLast,
  onOpenFile,
  ink,
  subtle,
  tertiary,
  border,
  accent,
}: {
  path: string;
  isLast: boolean;
  onOpenFile?: (path: string) => void;
  ink: string;
  subtle: string;
  tertiary: string;
  border: string;
  accent: string;
}) {
  // Reachability detail: render the basename in mono accent (the part the
  // user actually scans for) and the leading directory in a lighter
  // tertiary color. This keeps each row scannable without truncation.
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const base = slash >= 0 ? path.slice(slash + 1) : path;

  const content = (
    <View
      style={{
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: border,
        flexDirection: "row",
        alignItems: "center",
      }}
    >
      <Text
        numberOfLines={1}
        ellipsizeMode="middle"
        style={{
          flex: 1,
          fontFamily: "JetBrainsMono",
          fontSize: 12,
          lineHeight: 18,
          letterSpacing: -0.2,
          color: onOpenFile ? accent : ink,
        }}
      >
        {dir ? (
          <Text
            style={{
              fontFamily: "JetBrainsMono",
              fontSize: 12,
              color: tertiary,
            }}
          >
            {dir}
          </Text>
        ) : null}
        {base}
      </Text>
    </View>
  );

  if (!onOpenFile) return content;

  return (
    <Pressable
      onPress={() => onOpenFile(path)}
      accessibilityRole="link"
      accessibilityLabel={`Open ${path}`}
      style={({ pressed }) => ({
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {content}
    </Pressable>
  );
}
