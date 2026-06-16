import { EditorView } from "@codemirror/view";
import { EditorSelection, ChangeSpec } from "@codemirror/state";

export type CommandName =
  | "h1"
  | "h2"
  | "h3"
  | "bold"
  | "italic"
  | "code"
  | "codeblock"
  | "quote"
  | "ul"
  | "ol"
  | "link"
  | "strikethrough";

function wrapInline(view: EditorView, marker: string) {
  const changes: ChangeSpec[] = [];
  const sel = view.state.selection;
  const ranges = sel.ranges.map((r) => {
    const text = view.state.sliceDoc(r.from, r.to);
    const mlen = marker.length;
    const before = view.state.sliceDoc(Math.max(0, r.from - mlen), r.from);
    const after = view.state.sliceDoc(r.to, Math.min(view.state.doc.length, r.to + mlen));
    if (before === marker && after === marker) {
      // toggle off
      changes.push({ from: r.from - mlen, to: r.from, insert: "" });
      changes.push({ from: r.to, to: r.to + mlen, insert: "" });
      return EditorSelection.range(r.from - mlen, r.to - mlen);
    }
    changes.push({ from: r.from, insert: marker });
    changes.push({ from: r.to, insert: marker });
    if (!text) {
      // Empty selection: drop the caret between the two markers.
      return EditorSelection.cursor(r.from + mlen);
    }
    return EditorSelection.range(r.from + mlen, r.to + mlen);
  });
  view.dispatch({
    changes,
    selection: EditorSelection.create(ranges, sel.mainIndex),
    scrollIntoView: true,
  });
}

function toggleLinePrefix(view: EditorView, prefix: string, exclusive = true) {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  const seen = new Set<number>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      const stripped = line.text.replace(/^(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/, "");
      const already = line.text.startsWith(prefix);
      if (already && exclusive) {
        changes.push({ from: line.from, to: line.to, insert: stripped });
      } else {
        changes.push({ from: line.from, to: line.to, insert: prefix + stripped });
      }
    }
  }
  view.dispatch({ changes, scrollIntoView: true });
}

function toggleOrdered(view: EditorView) {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  let idx = 1;
  const seen = new Set<number>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      const isOrdered = /^\d+\.\s+/.test(line.text);
      const stripped = line.text.replace(/^(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/, "");
      if (isOrdered) {
        changes.push({ from: line.from, to: line.to, insert: stripped });
      } else {
        changes.push({ from: line.from, to: line.to, insert: `${idx}. ${stripped}` });
        idx++;
      }
    }
  }
  view.dispatch({ changes, scrollIntoView: true });
}

function insertCodeBlock(view: EditorView) {
  const r = view.state.selection.main;
  const text = view.state.sliceDoc(r.from, r.to);
  const block = "```\n" + text + "\n```";
  view.dispatch({
    changes: { from: r.from, to: r.to, insert: block },
    selection: EditorSelection.cursor(r.from + 4 + text.length),
    scrollIntoView: true,
  });
}

function insertLink(view: EditorView) {
  const sel = view.state.selection;
  const changes: ChangeSpec[] = [];
  const ranges = sel.ranges.map((r) => {
    const text = view.state.sliceDoc(r.from, r.to) || "text";
    const inserted = `[${text}](url)`;
    changes.push({ from: r.from, to: r.to, insert: inserted });
    // place cursor inside (url)
    const urlStart = r.from + 1 + text.length + 2;
    return EditorSelection.range(urlStart, urlStart + 3);
  });
  view.dispatch({
    changes,
    selection: EditorSelection.create(ranges, sel.mainIndex),
    scrollIntoView: true,
  });
}

export function runCommand(view: EditorView, name: CommandName) {
  switch (name) {
    case "h1":
      return toggleLinePrefix(view, "# ");
    case "h2":
      return toggleLinePrefix(view, "## ");
    case "h3":
      return toggleLinePrefix(view, "### ");
    case "bold":
      return wrapInline(view, "**");
    case "italic":
      return wrapInline(view, "*");
    case "strikethrough":
      return wrapInline(view, "~~");
    case "code":
      return wrapInline(view, "`");
    case "codeblock":
      return insertCodeBlock(view);
    case "quote":
      return toggleLinePrefix(view, "> ");
    case "ul":
      return toggleLinePrefix(view, "- ");
    case "ol":
      return toggleOrdered(view);
    case "link":
      return insertLink(view);
  }
}
