/**
 * Wend — lightweight streaming markdown parser for agent responses.
 *
 * Claude's text frames arrive incrementally as fragments of markdown. This
 * parser is intentionally minimal — it handles the subset Claude actually
 * emits (headings, code fences, lists, blockquotes, inline bold/italic/code/
 * links) and treats anything fancier (tables, footnotes, raw HTML) as a
 * plain paragraph. That tradeoff buys us a tiny dependency-free parser that
 * re-runs on every streamed chunk without dragging in `marked` or `mdast`.
 *
 * Block-level pass scans line by line and emits {@link Block}s. Inline pass
 * walks each block's text and emits {@link InlineNode}s. The renderer in
 * `components/editor/Markdown.tsx` consumes both.
 */

export type Block =
  | { type: "paragraph"; nodes: InlineNode[] }
  | { type: "heading"; level: 1 | 2 | 3; nodes: InlineNode[] }
  | { type: "codeBlock"; lang: string | null; code: string; closed: boolean }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "quote"; nodes: InlineNode[] }
  | { type: "hr" };

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "bold"; nodes: InlineNode[] }
  | { type: "italic"; nodes: InlineNode[] }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

/**
 * Parse a (possibly partial) markdown string into a block list. Safe to
 * call on every keystroke / streamed chunk.
 */
export function parseMarkdown(input: string): Block[] {
  const lines = input.split("\n");
  const out: Block[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // ─── Fenced code block ──────────────────────────────────────────────
    const fence = /^```\s*([A-Za-z0-9_+\-./]*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] || null;
      const codeLines: string[] = [];
      i += 1;
      let closed = false;
      while (i < lines.length) {
        if (/^```\s*$/.test(lines[i]!)) {
          closed = true;
          i += 1;
          break;
        }
        codeLines.push(lines[i]!);
        i += 1;
      }
      out.push({
        type: "codeBlock",
        lang,
        code: codeLines.join("\n"),
        closed,
      });
      continue;
    }

    // ─── Horizontal rule ────────────────────────────────────────────────
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push({ type: "hr" });
      i += 1;
      continue;
    }

    // ─── Heading ────────────────────────────────────────────────────────
    const heading = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1]!.length as 1 | 2 | 3;
      out.push({
        type: "heading",
        level,
        nodes: parseInline(heading[2]!),
      });
      i += 1;
      continue;
    }

    // ─── Blockquote ─────────────────────────────────────────────────────
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        buf.push(lines[i]!.replace(/^>\s?/, ""));
        i += 1;
      }
      out.push({ type: "quote", nodes: parseInline(buf.join(" ")) });
      continue;
    }

    // ─── List ───────────────────────────────────────────────────────────
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: InlineNode[][] = [];
      while (i < lines.length) {
        const m = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(lines[i]!);
        if (!m) break;
        // Capture continuation lines indented under the bullet.
        const itemLines = [m[2]!];
        i += 1;
        while (
          i < lines.length &&
          /^\s+\S/.test(lines[i]!) &&
          !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]!)
        ) {
          itemLines.push(lines[i]!.trim());
          i += 1;
        }
        items.push(parseInline(itemLines.join(" ")));
      }
      out.push({ type: "list", ordered, items });
      continue;
    }

    // ─── Blank line ─────────────────────────────────────────────────────
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // ─── Paragraph (consume until blank line / block trigger) ──────────
    const para: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const peek = lines[i]!;
      if (
        peek.trim() === "" ||
        /^```/.test(peek) ||
        /^(#{1,3})\s+/.test(peek) ||
        /^>\s?/.test(peek) ||
        /^\s*([-*+]|\d+\.)\s+/.test(peek) ||
        /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(peek)
      ) {
        break;
      }
      para.push(peek);
      i += 1;
    }
    out.push({ type: "paragraph", nodes: parseInline(para.join(" ")) });
  }

  return out;
}

/**
 * Inline parse — walk a string left-to-right, picking off the longest
 * marker match at each position. Order matters: code first (it doesn't
 * recurse), then link, then bold (2 chars), then italic (1 char).
 */
export function parseInline(input: string): InlineNode[] {
  const out: InlineNode[] = [];
  let i = 0;
  let buf = "";

  const flush = () => {
    if (buf.length > 0) {
      out.push({ type: "text", text: buf });
      buf = "";
    }
  };

  while (i < input.length) {
    const ch = input[i]!;

    // Inline code — `...` (or ``...``)
    if (ch === "`") {
      // Count run of backticks for the open marker.
      let openLen = 0;
      while (input[i + openLen] === "`") openLen += 1;
      const marker = "`".repeat(openLen);
      const closeIdx = input.indexOf(marker, i + openLen);
      if (closeIdx !== -1) {
        flush();
        out.push({
          type: "code",
          text: input.slice(i + openLen, closeIdx),
        });
        i = closeIdx + openLen;
        continue;
      }
    }

    // Link — [text](url)
    if (ch === "[") {
      const close = input.indexOf("]", i + 1);
      if (close !== -1 && input[close + 1] === "(") {
        const parenClose = input.indexOf(")", close + 2);
        if (parenClose !== -1) {
          flush();
          out.push({
            type: "link",
            text: input.slice(i + 1, close),
            href: input.slice(close + 2, parenClose),
          });
          i = parenClose + 1;
          continue;
        }
      }
    }

    // Bold — **...** or __...__
    if (
      (ch === "*" && input[i + 1] === "*") ||
      (ch === "_" && input[i + 1] === "_")
    ) {
      const marker = ch + ch;
      const close = input.indexOf(marker, i + 2);
      if (close !== -1 && close > i + 2) {
        flush();
        out.push({
          type: "bold",
          nodes: parseInline(input.slice(i + 2, close)),
        });
        i = close + 2;
        continue;
      }
    }

    // Italic — *...* or _..._
    if (ch === "*" || ch === "_") {
      // Skip if this is part of a bold opener we just rejected, or if
      // adjacent chars are non-word boundaries are off — keep simple.
      const close = input.indexOf(ch, i + 1);
      if (close !== -1 && close > i + 1) {
        const inner = input.slice(i + 1, close);
        // Don't treat *** ... *** as italic of an empty leading bold.
        if (!inner.startsWith(ch) && !inner.endsWith(ch)) {
          flush();
          out.push({
            type: "italic",
            nodes: parseInline(inner),
          });
          i = close + 1;
          continue;
        }
      }
    }

    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

/**
 * Produce a one-line, plain-text summary suitable for a collapsed
 * accordion header. Strips markdown markers, collapses whitespace,
 * truncates to `maxLen` with an ellipsis.
 */
export function summarizeMarkdown(input: string, maxLen = 96): string {
  // Strip code fences inline so the summary doesn't include their syntax.
  const noFences = input.replace(/```[\s\S]*?```/g, " (code) ");
  const noInlineCode = noFences.replace(/`([^`]+)`/g, "$1");
  const noLinks = noInlineCode.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  const noEmph = noLinks.replace(/(\*\*|__|\*|_)/g, "");
  const noBullets = noEmph.replace(/^\s*([-*+]|\d+\.)\s+/gm, "");
  const noHeadings = noBullets.replace(/^#{1,6}\s+/gm, "");
  const collapsed = noHeadings.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLen) return collapsed;
  return collapsed.slice(0, maxLen - 1).trimEnd() + "…";
}
