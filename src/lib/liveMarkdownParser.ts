/**
 * Wend — worklet parser + style map for @expensify/react-native-live-markdown.
 *
 * Replaces the old children-span approach: styled
 * <Text> children inside a multiline TextInput render unstyled on Android
 * under the new architecture, so styling now happens natively via
 * MarkdownTextInput. The input's `value` stays raw markdown — dispatch reads
 * it verbatim; ranges only describe visual treatment.
 *
 * The parser runs as a worklet on every keystroke. It must emit ranges over
 * the EXACT source offsets (markers included, dimmed as 'syntax') so cursor
 * positions line up. Mistyped / partial markers degrade to plain text.
 *
 * Mapping notes: the native style sheet has a single heading type ('h1'), so
 * `# ` maps to h1 at the title size while `## ` / `### ` map to 'bold' — the
 * closest available treatment. List markers have no native type; they dim as
 * 'syntax' like other markers.
 */
import type { MarkdownRange, MarkdownStyle } from "@expensify/react-native-live-markdown";

import { typography } from "@/theme/tokens";

export interface LiveMarkdownTheme {
  ink: string;
  subtle: string;
  accent: string;
  surfaceChip: string;
}

const MAX_PARSABLE_LENGTH = 8000;

export function parseWendMarkdown(input: string): MarkdownRange[] {
  "worklet";

  const ranges: MarkdownRange[] = [];
  if (!input || input.length > MAX_PARSABLE_LENGTH) return ranges;

  const lines = input.split("\n");
  let offset = 0;
  let inFence = false;

  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li]!;
    const len = line.length;

    if (/^```/.test(line)) {
      ranges.push({ type: "syntax", start: offset, length: len });
      inFence = !inFence;
      offset += len + 1;
      continue;
    }
    if (inFence) {
      if (len > 0) ranges.push({ type: "pre", start: offset, length: len });
      offset += len + 1;
      continue;
    }

    const heading = /^(#{1,6})\s+/.exec(line);
    if (heading) {
      const markerLen = heading[0].length;
      const level = heading[1]!.length;
      ranges.push({ type: "syntax", start: offset, length: markerLen });
      if (len > markerLen) {
        ranges.push({
          type: level === 1 ? "h1" : "bold",
          start: offset + markerLen,
          length: len - markerLen,
        });
        parseInline(ranges, line.slice(markerLen), offset + markerLen);
      }
      offset += len + 1;
      continue;
    }

    const quote = /^>\s?/.exec(line);
    if (quote) {
      const markerLen = quote[0].length;
      ranges.push({ type: "syntax", start: offset, length: markerLen });
      if (len > markerLen) {
        ranges.push({
          type: "blockquote",
          start: offset + markerLen,
          length: len - markerLen,
          depth: 1,
        });
        parseInline(ranges, line.slice(markerLen), offset + markerLen);
      }
      offset += len + 1;
      continue;
    }

    const list = /^(\s*)([-*+]|\d+\.)(\s+)/.exec(line);
    if (list) {
      const markerLen = list[0].length;
      ranges.push({
        type: "syntax",
        start: offset + list[1]!.length,
        length: list[2]!.length,
      });
      parseInline(ranges, line.slice(markerLen), offset + markerLen);
      offset += len + 1;
      continue;
    }

    parseInline(ranges, line, offset);
    offset += len + 1;
  }

  ranges.sort(
    (a, b) => a.start - b.start || b.length - a.length,
  );
  return ranges;
}

function parseInline(
  out: MarkdownRange[],
  line: string,
  base: number,
): void {
  "worklet";

  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;

    if (ch === "`") {
      const close = line.indexOf("`", i + 1);
      if (close !== -1 && close > i + 1) {
        out.push({ type: "syntax", start: base + i, length: 1 });
        out.push({ type: "code", start: base + i + 1, length: close - i - 1 });
        out.push({ type: "syntax", start: base + close, length: 1 });
        i = close + 1;
        continue;
      }
    }

    if (ch === "[") {
      const closeBracket = line.indexOf("]", i + 1);
      if (closeBracket !== -1 && line[closeBracket + 1] === "(") {
        const closeParen = line.indexOf(")", closeBracket + 2);
        if (closeParen !== -1) {
          out.push({ type: "syntax", start: base + i, length: 1 });
          if (closeBracket > i + 1) {
            out.push({
              type: "link",
              start: base + i + 1,
              length: closeBracket - i - 1,
            });
          }
          out.push({ type: "syntax", start: base + closeBracket, length: 2 });
          if (closeParen > closeBracket + 2) {
            out.push({
              type: "syntax",
              start: base + closeBracket + 2,
              length: closeParen - closeBracket - 2,
            });
          }
          out.push({ type: "syntax", start: base + closeParen, length: 1 });
          i = closeParen + 1;
          continue;
        }
      }
    }

    if (
      (ch === "*" && line[i + 1] === "*") ||
      (ch === "_" && line[i + 1] === "_")
    ) {
      const marker = ch + ch;
      const close = line.indexOf(marker, i + 2);
      if (close !== -1 && close > i + 2) {
        out.push({ type: "syntax", start: base + i, length: 2 });
        out.push({ type: "bold", start: base + i + 2, length: close - i - 2 });
        parseInline(out, line.slice(i + 2, close), base + i + 2);
        out.push({ type: "syntax", start: base + close, length: 2 });
        i = close + 2;
        continue;
      }
    }

    if (ch === "*" || ch === "_") {
      const close = line.indexOf(ch, i + 1);
      if (close !== -1 && close > i + 1) {
        const inner = line.slice(i + 1, close);
        if (!inner.startsWith(ch) && !inner.endsWith(ch)) {
          out.push({ type: "syntax", start: base + i, length: 1 });
          out.push({
            type: "italic",
            start: base + i + 1,
            length: inner.length,
          });
          parseInline(out, inner, base + i + 1);
          out.push({ type: "syntax", start: base + close, length: 1 });
          i = close + 1;
          continue;
        }
      }
    }

    i += 1;
  }
}

export function buildMarkdownStyle(theme: LiveMarkdownTheme): MarkdownStyle {
  return {
    syntax: { color: theme.subtle },
    link: { color: theme.accent },
    h1: { fontSize: typography.title.fontSize },
    blockquote: {
      borderColor: theme.accent,
      borderWidth: 2,
      marginLeft: 0,
      paddingLeft: 8,
    },
    code: {
      fontFamily: "JetBrainsMono",
      fontSize: typography.body.fontSize - 1,
      color: theme.ink,
      backgroundColor: theme.surfaceChip,
    },
    pre: {
      fontFamily: "JetBrainsMono",
      fontSize: typography.body.fontSize - 1,
      color: theme.ink,
      backgroundColor: theme.surfaceChip,
    },
  };
}
