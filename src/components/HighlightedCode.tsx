/**
 * Wend — themed renderer for the syntax highlighter.
 *
 * Renders one outer monospace <Text> with colored child spans (RN flattens
 * nested Text efficiently). `plain` tokens render as bare strings so the node
 * count tracks syntax density, not file length. Falls back to flat text for
 * unknown languages or oversized files.
 */
import { useMemo } from "react";
import { Text } from "react-native";

import {
  HIGHLIGHT_MAX_BYTES,
  specForFilename,
  tokenize,
  type TokenType,
} from "@/lib/syntax/highlight";

type Palette = Record<Exclude<TokenType, "plain">, string>;

const LIGHT: Palette = {
  comment: "#A29A8C",
  string: "#5E8C3F",
  number: "#B07A3C",
  keyword: "#B5485F",
  type: "#2E6E8E",
  function: "#3A66B0",
};
const DARK: Palette = {
  comment: "#7C756B",
  string: "#9BD17A",
  number: "#E0B070",
  keyword: "#E8849B",
  type: "#6FB3CE",
  function: "#7FA8E8",
};

export interface HighlightedCodeProps {
  code: string;
  /** Filename or path — its extension picks the language. */
  filename: string;
  scheme: "light" | "dark";
  /** Color for plain text (theme ink). */
  ink: string;
  fontSize?: number;
  lineHeight?: number;
}

export function HighlightedCode({
  code,
  filename,
  scheme,
  ink,
  fontSize = 12.5,
  lineHeight = 19,
}: HighlightedCodeProps) {
  const palette = scheme === "dark" ? DARK : LIGHT;

  const children = useMemo(() => {
    const spec = specForFilename(filename);
    if (!spec || code.length > HIGHLIGHT_MAX_BYTES) return null;
    const tokens = tokenize(code, spec);
    return tokens.map((t, idx) =>
      t.type === "plain" ? (
        t.value
      ) : (
        <Text key={idx} style={{ color: palette[t.type] }}>
          {t.value}
        </Text>
      ),
    );
  }, [code, filename, palette]);

  return (
    <Text
      style={{ fontFamily: "JetBrainsMono", fontSize, lineHeight, color: ink }}
      selectable
    >
      {children ?? code}
    </Text>
  );
}
