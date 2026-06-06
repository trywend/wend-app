/**
 * Wend — live markdown styling for editable TextInputs.
 *
 * Produces a flat array of `{ text, style }` spans that we render as
 * `<Text>` children inside a multiline `<TextInput>`. The TextInput's
 * `value` prop still holds the raw markdown — so the dispatch path
 * (handleSend) always sees plain markdown source. The children only
 * affect the VISUAL representation.
 *
 * Why a separate tokenizer (and not reusing parseMarkdown from
 * agentMarkdown.ts): the renderer here MUST emit every character of the
 * source (including markers like `# `, `**`, backticks) so the TextInput's
 * cursor positions line up with the underlying string. The block parser
 * strips those markers — it's designed for read-only display, not for
 * preserving source layout.
 *
 * Span styles describe purely visual treatment (weight, size, family,
 * color). They never change the text length. The tokenizer scans
 * line-by-line for block prefixes (#, >, list markers, fenced code) then
 * scans each line's content for inline markers (** _ ` [..](..) ). Mistyped
 * / partial markers degrade to plain text — typical user-as-they-type
 * experience.
 */
import type { TextStyle } from "react-native";

import { typography } from "@/theme/tokens";

export interface MarkdownSpan {
  text: string;
  style?: TextStyle;
}

export interface LiveMarkdownTheme {
  ink: string;
  subtle: string;
  accent: string;
  surfaceChip: string;
}

/**
 * Tokenize `source` into a flat list of styled spans whose concatenated
 * `text` equals `source` exactly. Safe to call on every keystroke.
 */
export function tokenizeLiveMarkdown(
  source: string,
  theme: LiveMarkdownTheme,
): MarkdownSpan[] {
  if (!source) return [];

  const spans: MarkdownSpan[] = [];
  const lines = source.split("\n");
  let inFence = false;

  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li]!;
    const isLast = li === lines.length - 1;

    // ── Fenced code block ──────────────────────────────────────────────
    // Opening or closing fence — whole line styled mono+subtle.
    if (/^```/.test(line)) {
      spans.push({
        text: line,
        style: monoStyle(theme.subtle),
      });
      inFence = !inFence;
      if (!isLast) spans.push({ text: "\n" });
      continue;
    }
    if (inFence) {
      spans.push({ text: line, style: monoStyle(theme.ink) });
      if (!isLast) spans.push({ text: "\n" });
      continue;
    }

    // ── Heading ────────────────────────────────────────────────────────
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1]!.length, 3) as 1 | 2 | 3;
      const markerLen = heading[1]!.length + 1; // `#`s + one space
      const markerText = line.slice(0, markerLen);
      const rest = line.slice(markerLen);
      const headingStyle = headingStyleFor(level, theme.ink);
      spans.push({
        text: markerText,
        style: { ...headingStyle, color: theme.subtle, opacity: 0.5 },
      });
      pushInlineSpans(spans, rest, headingStyle, theme);
      if (!isLast) spans.push({ text: "\n" });
      continue;
    }

    // ── Blockquote ─────────────────────────────────────────────────────
    const quote = /^(>\s?)(.*)$/.exec(line);
    if (quote) {
      const quoteStyle: TextStyle = {
        fontFamily: "Inter-Regular",
        fontSize: typography.body.fontSize,
        color: theme.subtle,
        fontStyle: "italic",
      };
      spans.push({
        text: quote[1]!,
        style: { ...quoteStyle, color: theme.accent, fontStyle: "normal" },
      });
      pushInlineSpans(spans, quote[2]!, quoteStyle, theme);
      if (!isLast) spans.push({ text: "\n" });
      continue;
    }

    // ── List item (unordered / ordered) ────────────────────────────────
    const list = /^(\s*)([-*+]|\d+\.)(\s+)(.*)$/.exec(line);
    if (list) {
      const baseStyle: TextStyle = bodyStyle(theme.ink);
      const markerStyle: TextStyle = { ...baseStyle, color: theme.accent };
      spans.push({ text: list[1]!, style: baseStyle });
      spans.push({ text: list[2]!, style: markerStyle });
      spans.push({ text: list[3]!, style: baseStyle });
      pushInlineSpans(spans, list[4]!, baseStyle, theme);
      if (!isLast) spans.push({ text: "\n" });
      continue;
    }

    // ── Plain line (with inline markers) ───────────────────────────────
    pushInlineSpans(spans, line, bodyStyle(theme.ink), theme);
    if (!isLast) spans.push({ text: "\n" });
  }

  return spans;
}

function bodyStyle(color: string): TextStyle {
  return {
    fontFamily: "Inter-Regular",
    fontSize: typography.body.fontSize,
    color,
  };
}

function monoStyle(color: string): TextStyle {
  return {
    fontFamily: "JetBrainsMono",
    fontSize: typography.body.fontSize - 1,
    color,
  };
}

function headingStyleFor(level: 1 | 2 | 3, color: string): TextStyle {
  // Scale H1 > H2 > H3 cleanly. Sizes tuned against typography.title/heading
  // tokens to stay in the existing scale without introducing new values.
  if (level === 1) {
    return {
      fontFamily: "Inter-SemiBold",
      fontSize: typography.title.fontSize, // 22
      color,
    };
  }
  if (level === 2) {
    return {
      fontFamily: "Inter-SemiBold",
      fontSize: typography.heading.fontSize, // 19
      color,
    };
  }
  return {
    fontFamily: "Inter-SemiBold",
    fontSize: 17,
    color,
  };
}

/**
 * Walk a single line, emitting inline-styled spans. Base style is the
 * line's resting style (heading body, list body, quote body, etc.). Inline
 * markers MAY override fontFamily/fontStyle/fontWeight on top of base.
 *
 * Marker text itself stays in the output (we never delete characters) but
 * dims to `subtle` so the rendered text reads cleanly while the user can
 * still see what they typed.
 */
function pushInlineSpans(
  out: MarkdownSpan[],
  line: string,
  base: TextStyle,
  theme: LiveMarkdownTheme,
): void {
  if (!line) return;

  let i = 0;
  let buf = "";

  const flush = () => {
    if (buf.length === 0) return;
    out.push({ text: buf, style: base });
    buf = "";
  };

  const dimMarker = (text: string): MarkdownSpan => ({
    text,
    style: { ...base, color: theme.subtle, opacity: 0.55 },
  });

  while (i < line.length) {
    const ch = line[i]!;

    // ── Inline code `…` ─────────────────────────────────────────────────
    if (ch === "`") {
      const close = line.indexOf("`", i + 1);
      if (close !== -1 && close > i + 1) {
        flush();
        out.push(dimMarker("`"));
        out.push({
          text: line.slice(i + 1, close),
          style: {
            ...base,
            fontFamily: "JetBrainsMono",
            fontSize: (base.fontSize ?? typography.body.fontSize) - 1,
            color: theme.ink,
            backgroundColor: theme.surfaceChip,
          },
        });
        out.push(dimMarker("`"));
        i = close + 1;
        continue;
      }
    }

    // ── Link [text](url) ────────────────────────────────────────────────
    if (ch === "[") {
      const closeBracket = line.indexOf("]", i + 1);
      if (closeBracket !== -1 && line[closeBracket + 1] === "(") {
        const closeParen = line.indexOf(")", closeBracket + 2);
        if (closeParen !== -1) {
          flush();
          out.push(dimMarker("["));
          out.push({
            text: line.slice(i + 1, closeBracket),
            style: {
              ...base,
              color: theme.accent,
              textDecorationLine: "underline",
            },
          });
          out.push(dimMarker("]("));
          out.push({
            text: line.slice(closeBracket + 2, closeParen),
            style: { ...base, color: theme.subtle, opacity: 0.7 },
          });
          out.push(dimMarker(")"));
          i = closeParen + 1;
          continue;
        }
      }
    }

    // ── Bold **…** or __…__ ─────────────────────────────────────────────
    if (
      (ch === "*" && line[i + 1] === "*") ||
      (ch === "_" && line[i + 1] === "_")
    ) {
      const marker = ch + ch;
      const close = line.indexOf(marker, i + 2);
      if (close !== -1 && close > i + 2) {
        flush();
        out.push(dimMarker(marker));
        const inner = line.slice(i + 2, close);
        pushInlineSpans(
          out,
          inner,
          { ...base, fontFamily: "Inter-SemiBold", fontWeight: "600" },
          theme,
        );
        out.push(dimMarker(marker));
        i = close + 2;
        continue;
      }
    }

    // ── Italic *…* or _…_ ───────────────────────────────────────────────
    if (ch === "*" || ch === "_") {
      const close = line.indexOf(ch, i + 1);
      if (close !== -1 && close > i + 1) {
        const inner = line.slice(i + 1, close);
        if (!inner.startsWith(ch) && !inner.endsWith(ch)) {
          flush();
          out.push(dimMarker(ch));
          pushInlineSpans(
            out,
            inner,
            { ...base, fontStyle: "italic" },
            theme,
          );
          out.push(dimMarker(ch));
          i = close + 1;
          continue;
        }
      }
    }

    buf += ch;
    i += 1;
  }
  flush();
}
