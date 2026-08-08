/**
 * Wend — diff deliverable. Native patch viewer: monospace lines, green/red
 * backgrounds per +/- , per-file headers, horizontal scroll. The patch text is
 * fetched from the artifact URL.
 */
import { useMemo } from "react";
import { ScrollView, View } from "react-native";
import { GitDiffIcon } from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import type { Artifact } from "@/lib/notes-storage";
import { DeliverableCard, DownloadButton } from "./DownloadButton";
import { downloadText, downloadFromUrl } from "./download";
import { Spinner } from "./Spinner";
import { useArtifactText, useArtifactSource } from "./useArtifact";

type LineKind = "add" | "del" | "hunk" | "file" | "meta" | "context";

interface DiffLine {
  kind: LineKind;
  text: string;
}

function classify(line: string): LineKind {
  if (line.startsWith("diff --git") || line.startsWith("+++ ") || line.startsWith("--- "))
    return "file";
  if (line.startsWith("@@")) return "hunk";
  if (
    line.startsWith("index ") ||
    line.startsWith("new file") ||
    line.startsWith("deleted file") ||
    line.startsWith("rename ") ||
    line.startsWith("similarity ") ||
    line.startsWith("\\ No newline")
  )
    return "meta";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "context";
}

function parseDiff(patch: string): DiffLine[] {
  return patch.replace(/\n$/, "").split("\n").map((text) => ({
    kind: classify(text),
    text,
  }));
}

function countChanges(lines: DiffLine[]): { adds: number; dels: number; files: number } {
  let adds = 0;
  let dels = 0;
  let files = 0;
  for (const l of lines) {
    if (l.kind === "add") adds++;
    else if (l.kind === "del") dels++;
    else if (l.text.startsWith("diff --git")) files++;
  }
  return { adds, dels, files: files || (lines.length > 0 ? 1 : 0) };
}

export function DiffDeliverable({
  artifact,
  runId,
  compact,
}: {
  artifact: Artifact;
  runId: string | undefined;
  compact?: boolean;
}) {
  const { tokens } = useTheme();
  const accent = tokens["accent-default"];
  const subtle = tokens["text-secondary"];
  const tertiary = tokens["text-tertiary"];
  const border = tokens["border-hairline"];

  const { urlFor } = useArtifactSource(runId);
  const state = useArtifactText(runId, artifact.id, true);

  const lines = useMemo(
    () => (state.phase === "ready" ? parseDiff(state.text) : []),
    [state],
  );
  const stats = useMemo(() => countChanges(lines), [lines]);
  const name = artifact.name || "changes.diff";

  const url = urlFor(artifact.id);
  const mime = artifact.mime || "text/x-patch";
  const save = () => {
    if (state.phase === "ready") {
      return downloadText({ text: state.text, name, mime });
    }
    if (url) return downloadFromUrl({ url, name, mime });
    return Promise.resolve();
  };

  const statLine =
    state.phase === "ready"
      ? `+${stats.adds} −${stats.dels}`
      : state.phase === "loading"
        ? "Loading…"
        : "";

  if (compact) {
    return (
      <DeliverableCard
        icon={<GitDiffIcon size={13} color={accent} weight="regular" />}
        title={name}
        chip="Diff"
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
          }}
        >
          {state.phase === "loading" ? (
            <Spinner size={14} color={subtle} />
          ) : null}
          <Text
            style={{
              fontFamily: "JetBrainsMono",
              fontSize: 12.5,
              color: subtle,
              letterSpacing: -0.2,
            }}
          >
            {statLine || "Patch"}
          </Text>
        </View>
      </DeliverableCard>
    );
  }

  return (
    <DeliverableCard
      icon={<GitDiffIcon size={13} color={accent} weight="regular" />}
      title={name}
      chip={statLine || "Diff"}
    >
      {state.phase === "loading" ? (
        <View style={{ padding: 20, alignItems: "center" }}>
          <Spinner size={16} color={subtle} />
        </View>
      ) : state.phase === "ready" ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          contentContainerStyle={{ paddingVertical: 8 }}
        >
          <View>
            {lines.map((l, i) => (
              <DiffRow key={i} line={l} tokens={tokens} />
            ))}
          </View>
        </ScrollView>
      ) : (
        <View style={{ padding: 16 }}>
          <Text style={{ fontFamily: "Inter-Regular", fontSize: 13, color: tertiary }}>
            {state.phase === "unavailable"
              ? "Pair your Mac to load this patch. You can still download it."
              : state.phase === "gone"
                ? "This patch is no longer on your Mac."
                : "Couldn't load this patch from your Mac."}
          </Text>
        </View>
      )}
      {state.phase === "gone" ? null : (
        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 12,
            borderTopWidth: 1,
            borderTopColor: border,
            flexDirection: "row",
          }}
        >
          <DownloadButton label="Download .diff" onDownload={save} />
        </View>
      )}
    </DeliverableCard>
  );
}

function DiffRow({
  line,
  tokens,
}: {
  line: DiffLine;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tokens: any;
}) {
  const ink = tokens["text-primary"];
  const subtle = tokens["text-secondary"];
  const tertiary = tokens["text-tertiary"];
  const accent = tokens["accent-default"];

  const bg =
    line.kind === "add"
      ? tokens["diff-add-bg"]
      : line.kind === "del"
        ? tokens["diff-del-bg"]
        : "transparent";
  const color =
    line.kind === "add"
      ? tokens["diff-add-gutter"]
      : line.kind === "del"
        ? tokens["diff-del-gutter"]
        : line.kind === "hunk"
          ? accent
          : line.kind === "file"
            ? ink
            : line.kind === "meta"
              ? tertiary
              : subtle;

  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 12 }}>
      <Text
        style={{
          fontFamily:
            line.kind === "file" ? "JetBrainsMono-Medium" : "JetBrainsMono",
          fontSize: 12,
          lineHeight: 18,
          color,
        }}
      >
        {line.text.length > 0 ? line.text : " "}
      </Text>
    </View>
  );
}
