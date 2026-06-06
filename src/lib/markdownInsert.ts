/**
 * Wend — markdown insertion helpers for the editor toolbar.
 *
 * Two operation families:
 *
 *  - `prefixLine`: prepends a marker (e.g. "# ", "- ", "> ") at the start
 *    of the line containing the cursor. If the line already starts with
 *    the same marker, it removes it (toggle). Stays out of the way of
 *    existing content; doesn't insert at end-of-document.
 *
 *  - `wrapSelection`: wraps the current selection with paired markers
 *    (e.g. `**…**`, `*…*`, `` `…` ``). With no selection, inserts the
 *    pair and places the cursor between them.
 *
 *  - `insertAtCursor`: drops a template (`[text](url)`, fenced block) at
 *    the cursor with a sensible cursor target.
 *
 * Each helper returns `{ value, selection }` so the caller can drive
 * both the controlled text and the cursor in lockstep. We don't dispatch
 * the change ourselves — the editor wires this into setBody / selection
 * state.
 */

export interface InsertResult {
  value: string;
  selection: { start: number; end: number };
}

export interface CurrentSelection {
  start: number;
  end: number;
}

/** Find the [start, end) range of the line containing `pos`. */
function lineRange(text: string, pos: number): { start: number; end: number } {
  const start = text.lastIndexOf("\n", pos - 1) + 1;
  const nextNL = text.indexOf("\n", pos);
  const end = nextNL === -1 ? text.length : nextNL;
  return { start, end };
}

/**
 * Prepend `marker` to the line containing the cursor. If the line already
 * starts with `marker`, strip it (toggle). For an empty document, just
 * inserts the marker.
 *
 * When `sel` is null (selection unknown — typical first render before the
 * user has interacted), we treat the cursor as end-of-document.
 */
export function prefixLine(
  value: string,
  sel: CurrentSelection | null,
  marker: string,
): InsertResult {
  const pos = sel ? Math.min(sel.start, value.length) : value.length;
  const { start, end } = lineRange(value, pos);
  const line = value.slice(start, end);

  if (line.startsWith(marker)) {
    // Toggle off.
    const next = value.slice(0, start) + line.slice(marker.length) + value.slice(end);
    const newPos = Math.max(start, pos - marker.length);
    return { value: next, selection: { start: newPos, end: newPos } };
  }
  const next = value.slice(0, start) + marker + line + value.slice(end);
  const newPos = pos + marker.length;
  return { value: next, selection: { start: newPos, end: newPos } };
}

/**
 * Wrap the current selection with `open`/`close`. With no selection, inserts
 * `open + placeholder + close` and selects the placeholder for immediate
 * overwrite. Caller decides what `placeholder` is — empty string means
 * "drop cursor between markers".
 */
export function wrapSelection(
  value: string,
  sel: CurrentSelection | null,
  open: string,
  close: string,
  placeholder = "",
): InsertResult {
  const s = sel ? Math.min(sel.start, value.length) : value.length;
  const e = sel ? Math.min(sel.end, value.length) : value.length;
  const start = Math.min(s, e);
  const end = Math.max(s, e);

  if (start === end) {
    const inner = placeholder;
    const next = value.slice(0, start) + open + inner + close + value.slice(end);
    const cursor = start + open.length;
    return {
      value: next,
      selection: { start: cursor, end: cursor + inner.length },
    };
  }
  const inner = value.slice(start, end);
  const next = value.slice(0, start) + open + inner + close + value.slice(end);
  const cursor = start + open.length + inner.length + close.length;
  return { value: next, selection: { start: cursor, end: cursor } };
}

/**
 * Insert `template` at the cursor. If `selectFrom`/`selectTo` are provided,
 * the resulting selection covers that range relative to the start of the
 * inserted text — useful for templates like `[text](url)` where we want the
 * "text" portion highlighted for the user to overwrite.
 */
export function insertAtCursor(
  value: string,
  sel: CurrentSelection | null,
  template: string,
  selectFrom?: number,
  selectTo?: number,
): InsertResult {
  const s = sel ? Math.min(sel.start, value.length) : value.length;
  const e = sel ? Math.min(sel.end, value.length) : value.length;
  const start = Math.min(s, e);
  const end = Math.max(s, e);

  const next = value.slice(0, start) + template + value.slice(end);
  const base = start;
  if (selectFrom != null && selectTo != null) {
    return {
      value: next,
      selection: { start: base + selectFrom, end: base + selectTo },
    };
  }
  const cursor = base + template.length;
  return { value: next, selection: { start: cursor, end: cursor } };
}

/**
 * Insert a fenced code block. Ensures a leading newline if the current line
 * isn't empty so the fence opens on its own line. Cursor lands inside the
 * fence ready for code.
 */
export function insertCodeFence(
  value: string,
  sel: CurrentSelection | null,
): InsertResult {
  const pos = sel ? Math.min(sel.start, value.length) : value.length;
  const { start } = lineRange(value, pos);
  const lineSoFar = value.slice(start, pos);
  const needsLeadingNL = lineSoFar.length > 0;
  const prefix = needsLeadingNL ? "\n" : "";
  const template = `${prefix}\`\`\`\n\n\`\`\``;
  const next = value.slice(0, pos) + template + value.slice(pos);
  // Cursor between the fences.
  const cursor = pos + prefix.length + 4; // after "```\n"
  return { value: next, selection: { start: cursor, end: cursor } };
}
