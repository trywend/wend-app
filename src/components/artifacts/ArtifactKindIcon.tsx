import {
  ArticleIcon,
  FileIcon,
  GitDiffIcon,
  GlobeIcon,
  ImageSquareIcon,
} from "phosphor-react-native";

import type { ArtifactKind } from "@/lib/notes-storage";

export function ArtifactKindIcon({
  kind,
  size,
  color,
}: {
  kind: ArtifactKind;
  size: number;
  color: string;
}) {
  switch (kind) {
    case "diff":
      return <GitDiffIcon size={size} color={color} weight="regular" />;
    case "html":
      return <GlobeIcon size={size} color={color} weight="regular" />;
    case "image":
      return <ImageSquareIcon size={size} color={color} weight="regular" />;
    case "answer":
      return <ArticleIcon size={size} color={color} weight="regular" />;
    default:
      return <FileIcon size={size} color={color} weight="regular" />;
  }
}
