/**
 * Wend — RunLinksSummary.
 *
 * Card sibling of FileChangesSummary that surfaces deliverable URLs for a
 * run: PRs Claude opened, pushed branches, dashboards. Sources, deduped in
 * order:
 *
 *   1. `links` persisted on the run (cloud backend reports them).
 *   2. https URLs in the response markdown (link nodes + bare URLs).
 *   3. URLs buried in tool call inputs (e.g. a `gh pr create` command).
 *
 * Renders nothing when there's nothing to show.
 */

import { useMemo } from "react";
import { Linking, Pressable, View } from "react-native";
import {
  GitCommitIcon,
  GitPullRequestIcon,
  LinkIcon,
} from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import {
  extractHttpsUrlsFromBlocks,
  extractHttpsUrlsFromToolCalls,
  isNoiseUrl,
  type Block,
} from "@/lib/agentMarkdown";
import type { ToolCall } from "@/components/editor/AgentRunBlock";

type LinkKind = "pr" | "commit" | "web";

interface LinkRowData {
  url: string;
  label: string;
  kind: LinkKind;
}

function describeLink(url: string): LinkRowData {
  const pr = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
  if (pr) {
    return { url, label: `PR #${pr[3]} · ${pr[1]}/${pr[2]}`, kind: "pr" };
  }
  const commit =
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/commit\/([0-9a-fA-F]{7,40})/.exec(
      url,
    );
  if (commit) {
    return {
      url,
      label: `${commit[1]}/${commit[2]} @ ${commit[3]!.slice(0, 7)}`,
      kind: "commit",
    };
  }
  const m = /^https:\/\/([^/?#]+)([^?#]*)/.exec(url);
  const host = m?.[1] ?? url;
  let path = m?.[2] ?? "";
  if (path === "/") path = "";
  if (path.length > 32) path = `${path.slice(0, 31)}…`;
  return { url, label: `${host}${path}`, kind: "web" };
}

export interface RunLinksSummaryProps {
  blocks: Block[];
  toolCalls: ToolCall[];
  /** URLs persisted on the run record (cloud backend). Highest priority. */
  links?: string[];
}

export function RunLinksSummary({
  blocks,
  toolCalls,
  links,
}: RunLinksSummaryProps) {
  const { tokens } = useTheme();

  const rows = useMemo(() => {
    const out: LinkRowData[] = [];
    const seen = new Set<string>();
    const push = (url: string) => {
      if (typeof url !== "string" || !/^https:\/\//i.test(url)) return;
      if (seen.has(url) || isNoiseUrl(url)) return;
      seen.add(url);
      out.push(describeLink(url));
    };
    for (const u of links ?? []) push(u);
    for (const u of extractHttpsUrlsFromBlocks(blocks)) push(u);
    for (const u of extractHttpsUrlsFromToolCalls(toolCalls)) push(u);
    return out;
  }, [blocks, toolCalls, links]);

  if (rows.length === 0) return null;

  const ink = tokens["text-primary"];
  const tertiary = tokens["text-tertiary"];
  const border = tokens["border-hairline"];
  const accent = tokens["accent-default"];
  const surface = tokens["surface-elevated"];

  const heading = `${rows.length} ${rows.length === 1 ? "link" : "links"}`;

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
        <LinkIcon size={13} color={accent} weight="regular" />
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
        {rows.map((row, i) => (
          <LinkRow
            key={row.url}
            row={row}
            isLast={i === rows.length - 1}
            tertiary={tertiary}
            border={border}
            accent={accent}
          />
        ))}
      </View>
    </View>
  );
}

function LinkRow({
  row,
  isLast,
  tertiary,
  border,
  accent,
}: {
  row: LinkRowData;
  isLast: boolean;
  tertiary: string;
  border: string;
  accent: string;
}) {
  const icon =
    row.kind === "pr" ? (
      <GitPullRequestIcon size={13} color={accent} weight="regular" />
    ) : row.kind === "commit" ? (
      <GitCommitIcon size={13} color={accent} weight="regular" />
    ) : (
      <LinkIcon size={13} color={tertiary} weight="regular" />
    );

  return (
    <Pressable
      onPress={() => void Linking.openURL(row.url).catch(() => {})}
      accessibilityRole="link"
      accessibilityLabel={`Open ${row.label}`}
      style={({ pressed }) => ({
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 9,
          borderBottomWidth: isLast ? 0 : 1,
          borderBottomColor: border,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        {icon}
        <Text
          numberOfLines={1}
          ellipsizeMode="middle"
          style={{
            flex: 1,
            fontFamily: "JetBrainsMono",
            fontSize: 12,
            lineHeight: 18,
            letterSpacing: -0.2,
            color: accent,
          }}
        >
          {row.label}
        </Text>
      </View>
    </Pressable>
  );
}
