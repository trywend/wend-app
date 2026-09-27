/**
 * Wend — answer deliverable. The final markdown answer as a card with a
 * "Download .md" action. The bytes are the in-memory answer text, so this
 * never touches the network.
 */
import { useMemo } from "react";
import { View } from "react-native";
import { ArticleIcon } from "phosphor-react-native";

import { Markdown } from "@/components/editor/Markdown";
import { parseMarkdown, summarizeMarkdown } from "@/lib/agentMarkdown";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/components/primitives";
import type { Artifact } from "@/lib/notes-storage";
import { DeliverableCard, DownloadButton } from "./DownloadButton";
import { downloadText } from "./download";

export function AnswerDeliverable({
  artifact,
  text,
  compact,
  flush,
  onOpenFile,
}: {
  artifact: Artifact;
  text: string;
  compact?: boolean;
  flush?: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const { tokens } = useTheme();
  const accent = tokens["accent-default"];
  const subtle = tokens["text-secondary"];
  const border = tokens["border-hairline"];

  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const preview = useMemo(() => summarizeMarkdown(text, 140), [text]);
  const name = artifact.name || "answer.md";

  const save = () =>
    downloadText({ text, name, mime: artifact.mime || "text/markdown" });

  if (compact) {
    return (
      <DeliverableCard
        icon={<ArticleIcon size={13} color={accent} weight="regular" />}
        title={name}
        chip="Answer"
        flush={flush}
      >
        <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
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
            {preview}
          </Text>
        </View>
      </DeliverableCard>
    );
  }

  return (
    <DeliverableCard
      icon={<ArticleIcon size={13} color={accent} weight="regular" />}
      title={name}
      chip="Answer"
      flush={flush}
    >
      <View style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6 }}>
        <Markdown blocks={blocks} onOpenFile={onOpenFile} />
      </View>
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 12,
          borderTopWidth: 1,
          borderTopColor: border,
          flexDirection: "row",
        }}
      >
        <DownloadButton label="Download .md" onDownload={save} />
      </View>
    </DeliverableCard>
  );
}
