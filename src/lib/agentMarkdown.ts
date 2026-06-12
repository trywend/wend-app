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
  | { type: "link"; text: string; href: string }
  /**
   * File path referenced in agent prose (e.g. `src/foo.ts`, `/Users/foo/bar.swift`).
   * Detected by {@link parseInline} via a conservative heuristic that requires
   * a file-shaped extension and at least one slash so plain ".tsx" tokens
   * don't get hijacked. The renderer turns these into tappable mono spans
   * that fire `onOpenFile(path)`.
   */
  | { type: "filePath"; path: string };

/**
 * Extensions we recognize as file paths. Conservative on purpose — anything
 * we miss just falls back to plain text, which is fine. The opposite (a
 * false positive making prose into a tappable nonsense link) is worse.
 */
const FILE_PATH_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "swift",
  "py",
  "rs",
  "go",
  "java",
  "kt",
  "kts",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "m",
  "mm",
  "rb",
  "php",
  "md",
  "mdx",
  "json",
  "yaml",
  "yml",
  "toml",
  "sh",
  "bash",
  "zsh",
  "html",
  "css",
  "scss",
  "sql",
  "txt",
  "log",
  "lock",
  "xml",
  "plist",
  "gradle",
  "podspec",
]);

/**
 * @internal — exported for tests. Returns true if `s` looks like a file path
 * we want to make tappable. Conservative: requires at least one `/` and a
 * known extension, and refuses URLs.
 */
export function looksLikeFilePath(s: string): boolean {
  if (!s) return false;
  // Strip URLs first — never hijack an http(s) link.
  if (/^https?:\/\//i.test(s)) return false;
  // Must contain a slash.
  if (!s.includes("/")) return false;
  // Must have an extension we know about.
  const dot = s.lastIndexOf(".");
  if (dot === -1 || dot === s.length - 1) return false;
  const ext = s.slice(dot + 1).toLowerCase();
  // Strip a trailing punctuation char if present (e.g. trailing `.` was the
  // extension dot — already handled — but `foo.ts,` shouldn't happen because
  // the outer regex's lookahead excludes those).
  return FILE_PATH_EXTENSIONS.has(ext);
}

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

    // File path detection. Only at a word-start position (start of input, or
    // after whitespace / opening bracket). Cheap to skip otherwise so this
    // doesn't tank the whole inline loop.
    if (
      (ch === "/" ||
        ch === "~" ||
        ch === "." ||
        (/[A-Za-z0-9_]/.test(ch) &&
          (i === 0 || /[\s([{`"']/.test(input[i - 1]!))))
    ) {
      // Greedy match — walk forward across path-character runs and capture
      // the longest substring that still satisfies looksLikeFilePath().
      let j = i;
      while (j < input.length && /[A-Za-z0-9_./~-]/.test(input[j]!)) j += 1;
      // Trim trailing punctuation that path-chars consumed but shouldn't be
      // part of the path (a dot at the end always belongs to the extension,
      // never a sentence terminator — but a comma can't have leaked in
      // since it's not in the char class). For safety, also peel trailing
      // dot/dash that look like punctuation.
      let end = j;
      while (end > i && (input[end - 1] === "." || input[end - 1] === "-")) {
        // Keep the dot if it's part of an extension (preceded by alnum and
        // followed by alnum — but we've already consumed forward). The
        // simplest rule: if peeling the dot still leaves a recognized path,
        // peel it. Otherwise keep it (extension dot).
        const candidate = input.slice(i, end - 1);
        if (looksLikeFilePath(candidate)) {
          end -= 1;
        } else {
          break;
        }
      }
      const candidate = input.slice(i, end);
      if (end > i && looksLikeFilePath(candidate)) {
        flush();
        out.push({ type: "filePath", path: candidate });
        i = end;
        continue;
      }
    }

    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

/**
 * Walk a parsed Block[] and collect every `filePath` InlineNode in document
 * order, deduped. Used by FileChangesSummary to surface files mentioned in
 * agent prose alongside files touched by tool calls.
 *
 * Document order matters — the first mention is usually the primary
 * subject of the response, and we want it at the top of the summary list.
 */
export function extractFilePathsFromBlocks(blocks: Block[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const visitInline = (nodes: InlineNode[]): void => {
    for (const n of nodes) {
      switch (n.type) {
        case "filePath":
          if (!seen.has(n.path)) {
            seen.add(n.path);
            out.push(n.path);
          }
          break;
        case "bold":
        case "italic":
          visitInline(n.nodes);
          break;
        // text / code / link have no nested file paths we care about
        default:
          break;
      }
    }
  };

  for (const b of blocks) {
    switch (b.type) {
      case "paragraph":
      case "heading":
      case "quote":
        visitInline(b.nodes);
        break;
      case "list":
        for (const item of b.items) visitInline(item);
        break;
      // codeBlock + hr have no inline nodes
      default:
        break;
    }
  }
  return out;
}

/**
 * Pull file paths out of a flat ToolCall[]. Looks at the common Claude
 * tool input keys (`file_path`, `path`, `files`, `notebook_path`) and
 * returns a deduped list in encounter order.
 *
 * The shape is `Array<{ name: string; input?: unknown }>` to stay aligned
 * with AgentRunBlock's ToolCall interface without creating a circular
 * import — we accept the loose shape and pick fields defensively.
 */
export function extractFilePathsFromToolCalls(
  calls: Array<{ name?: string; input?: unknown }>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (p: unknown): void => {
    if (typeof p !== "string") return;
    const trimmed = p.trim();
    if (trimmed.length === 0) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };

  for (const call of calls) {
    const input = call?.input;
    if (input == null || typeof input !== "object") continue;
    const obj = input as Record<string, unknown>;
    push(obj.file_path);
    push(obj.path);
    push(obj.notebook_path);
    // MultiEdit and similar list-form inputs.
    const files = obj.files;
    if (Array.isArray(files)) {
      for (const f of files) {
        if (typeof f === "string") push(f);
        else if (f && typeof f === "object") {
          const o = f as Record<string, unknown>;
          push(o.file_path);
          push(o.path);
        }
      }
    }
    // Some tools nest under `edits` with file_path on each edit.
    const edits = obj.edits;
    if (Array.isArray(edits)) {
      for (const e of edits) {
        if (e && typeof e === "object") {
          const o = e as Record<string, unknown>;
          push(o.file_path);
          push(o.path);
        }
      }
    }
  }
  return out;
}

/**
 * Tool names that indicate a file mutation (vs a read-only operation).
 * Used by FileChangesSummary to decide whether the block should render —
 * we only want to surface CHANGES, not "I read 5 files".
 */
export const FILE_MUTATION_TOOL_NAMES = new Set([
  "Edit",
  "MultiEdit",
  "Write",
  "Create",
  "NotebookEdit",
]);

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

function inputPathMatches(obj: Record<string, unknown>, path: string): boolean {
  return (
    obj.file_path === path || obj.path === path || obj.notebook_path === path
  );
}

/**
 * Full file content from the LAST Write/Create tool call targeting `path`.
 * Cloud runs execute in a throwaway container — this embedded content is
 * the only way the phone can show what got written.
 */
export function findWriteContentForPath(
  calls: Array<{ name?: string; input?: unknown }>,
  path: string,
): string | null {
  let found: string | null = null;
  for (const call of calls) {
    if (call?.name !== "Write" && call?.name !== "Create") continue;
    const input = call.input;
    if (input == null || typeof input !== "object") continue;
    const obj = input as Record<string, unknown>;
    if (!inputPathMatches(obj, path)) continue;
    if (typeof obj.content === "string") found = obj.content;
  }
  return found;
}

/**
 * The `new_string` from the last Edit-family tool call targeting `path`.
 * Best-effort excerpt for when the full file isn't reachable.
 */
export function findEditNewStringForPath(
  calls: Array<{ name?: string; input?: unknown }>,
  path: string,
): string | null {
  let found: string | null = null;
  for (const call of calls) {
    if (
      call?.name !== "Edit" &&
      call?.name !== "MultiEdit" &&
      call?.name !== "NotebookEdit"
    ) {
      continue;
    }
    const input = call.input;
    if (input == null || typeof input !== "object") continue;
    const obj = input as Record<string, unknown>;
    if (!inputPathMatches(obj, path)) continue;
    if (typeof obj.new_string === "string" && obj.new_string.length > 0) {
      found = obj.new_string;
    }
    const edits = obj.edits;
    if (Array.isArray(edits)) {
      for (const e of edits) {
        if (e && typeof e === "object") {
          const o = e as Record<string, unknown>;
          if (typeof o.new_string === "string" && o.new_string.length > 0) {
            found = o.new_string;
          }
        }
      }
    }
  }
  return found;
}

/* ───────────────────────── deliverable URL extraction ────────────────── */

const HTTPS_URL_RE = /https:\/\/[^\s<>"'`\\)\]}]+/g;

const NOISE_HOSTS = new Set(["localhost", "127.0.0.1", "example.com"]);

/** Hosts never surfaced as deliverables: local dev servers + doc placeholders. */
export function isNoiseUrl(url: string): boolean {
  const m = /^https:\/\/([^/:?#]+)/i.exec(url);
  if (!m) return true;
  const host = m[1]!.toLowerCase();
  return (
    NOISE_HOSTS.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".example.com")
  );
}

function cleanUrl(raw: string): string | null {
  const url = raw.replace(/[.,;:!?]+$/, "");
  if (url.length <= "https://".length) return null;
  return url;
}

function pushUrlsFromText(text: string, push: (url: string) => void): void {
  for (const m of text.matchAll(HTTPS_URL_RE)) {
    const cleaned = cleanUrl(m[0]);
    if (cleaned) push(cleaned);
  }
}

/**
 * Collect https URLs from a parsed block list — both explicit `link` nodes
 * and bare URLs in text / code spans / code blocks. Deduped, document
 * order, noise hosts excluded.
 */
export function extractHttpsUrlsFromBlocks(blocks: Block[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (url: string) => {
    if (isNoiseUrl(url) || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };

  const visitInline = (nodes: InlineNode[]): void => {
    for (const n of nodes) {
      switch (n.type) {
        case "link":
          if (/^https:\/\//i.test(n.href)) {
            const cleaned = cleanUrl(n.href);
            if (cleaned) push(cleaned);
          }
          break;
        case "text":
        case "code":
          pushUrlsFromText(n.text, push);
          break;
        case "bold":
        case "italic":
          visitInline(n.nodes);
          break;
        default:
          break;
      }
    }
  };

  for (const b of blocks) {
    switch (b.type) {
      case "paragraph":
      case "heading":
      case "quote":
        visitInline(b.nodes);
        break;
      case "list":
        for (const item of b.items) visitInline(item);
        break;
      case "codeBlock":
        pushUrlsFromText(b.code, push);
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * Collect https URLs from tool call inputs (e.g. a Bash `gh pr create`
 * command string). Skips file-content keys (`content`, `old_string`,
 * `new_string`) so a written README full of links doesn't flood the list.
 */
export function extractHttpsUrlsFromToolCalls(
  calls: Array<{ name?: string; input?: unknown }>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (url: string) => {
    if (isNoiseUrl(url) || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };

  const SKIP_KEYS = new Set(["content", "old_string", "new_string"]);
  const visit = (v: unknown, depth: number): void => {
    if (depth > 5 || v == null) return;
    if (typeof v === "string") {
      pushUrlsFromText(v, push);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    if (typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (SKIP_KEYS.has(k)) continue;
        visit(val, depth + 1);
      }
    }
  };

  for (const call of calls) visit(call?.input, 0);
  return out;
}
