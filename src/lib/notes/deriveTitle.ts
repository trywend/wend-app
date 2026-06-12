/**
 * Wend — auto-derived display titles for untitled notes.
 *
 * One rule, used everywhere a title is derived from body text (inbox cards,
 * dispatch noteTitle for push notifications): strip markdown markers, take
 * the first non-empty line, cap at 4 words and ~32 chars without cutting a
 * word mid-way, and append a single … only when something was dropped.
 * Explicit user-typed titles never pass through here.
 */

const MAX_WORDS = 4;
const MAX_CHARS = 32;

export function deriveTitleFromBody(bodyText: string): string | null {
  const firstLine = bodyText
    .split("\n")
    .map((line) => stripMarkdownMarkers(line).trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;

  const words = firstLine.split(/\s+/);
  let truncated = words.length > MAX_WORDS;
  let title = words.slice(0, MAX_WORDS).join(" ");

  if (title.length > MAX_CHARS) {
    truncated = true;
    const cut = title.slice(0, MAX_CHARS);
    const lastSpace = cut.lastIndexOf(" ");
    title = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
  }

  return truncated ? `${title}…` : title;
}

function stripMarkdownMarkers(line: string): string {
  return line
    .replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/, "")
    .replace(/^```.*$/, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/([*_`])(.+?)\1/g, "$2");
}
