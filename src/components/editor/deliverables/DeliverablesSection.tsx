/**
 * Wend — deliverables section. Routes each run artifact to its renderer and, in
 * the collapsed card, leads with the single PRIMARY deliverable rendered
 * compactly. Priority: html > diff > image > file > answer.
 *
 *   - collapsed → the primary artifact only, compact preview.
 *   - expanded  → every artifact in full, primary first.
 */
import { useMemo } from "react";
import { View } from "react-native";

import type { Artifact, ArtifactKind } from "@/lib/notes-storage";
import { AnswerDeliverable } from "./AnswerDeliverable";
import { DiffDeliverable } from "./DiffDeliverable";
import { FileDeliverable } from "./FileDeliverable";
import { HtmlDeliverable } from "./HtmlDeliverable";

const PRIORITY: ArtifactKind[] = ["html", "diff", "image", "file", "answer"];

function rank(kind: ArtifactKind): number {
  const i = PRIORITY.indexOf(kind);
  return i === -1 ? PRIORITY.length : i;
}

export function DeliverablesSection({
  artifacts,
  runId,
  answerText,
  mode,
  onOpenFile,
}: {
  artifacts: Artifact[];
  runId: string | undefined;
  /** In-memory text used to render + download the virtual `answer` artifact. */
  answerText: string;
  mode: "collapsed" | "expanded";
  onOpenFile?: (path: string) => void;
}) {
  const ordered = useMemo(
    () => [...artifacts].sort((a, b) => rank(a.kind) - rank(b.kind)),
    [artifacts],
  );
  if (ordered.length === 0) return null;

  const list = mode === "collapsed" ? ordered.slice(0, 1) : ordered;
  const compact = mode === "collapsed";

  return (
    <View>
      {list.map((a) => (
        <Renderer
          key={a.id}
          artifact={a}
          runId={runId}
          answerText={answerText}
          compact={compact}
          onOpenFile={onOpenFile}
        />
      ))}
    </View>
  );
}

function Renderer({
  artifact,
  runId,
  answerText,
  compact,
  onOpenFile,
}: {
  artifact: Artifact;
  runId: string | undefined;
  answerText: string;
  compact: boolean;
  onOpenFile?: (path: string) => void;
}) {
  switch (artifact.kind) {
    case "html":
      return <HtmlDeliverable artifact={artifact} runId={runId} compact={compact} />;
    case "diff":
      return <DiffDeliverable artifact={artifact} runId={runId} compact={compact} />;
    case "file":
    case "image":
      return <FileDeliverable artifact={artifact} runId={runId} compact={compact} />;
    case "answer":
      return (
        <AnswerDeliverable
          artifact={artifact}
          text={answerText}
          compact={compact}
          onOpenFile={onOpenFile}
        />
      );
    default:
      return null;
  }
}
