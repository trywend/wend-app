import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { Range, RangeSetBuilder } from "@codemirror/state";
import { syntaxTree, ensureSyntaxTree } from "@codemirror/language";

/**
 * Obsidian-style "live preview" for CommonMark/GFM.
 *
 * Strategy:
 *  - Walk the Lezer markdown tree across the viewport.
 *  - For every formatted construct, emit (a) mark/line decorations that STYLE
 *    the rendered content and (b) replace decorations that HIDE the raw marker
 *    tokens (e.g. `**`, `#`, backticks, `[`/`]`/`(`/`)`, `>`).
 *  - Hiding is suppressed for any construct whose line range intersects the
 *    cursor/selection. On the active line the raw markdown is revealed so it
 *    stays editable. The document text is never mutated — decorations only.
 */

// Lezer markdown node names that are pure syntax markers we want to hide.
const MARKER_NODES = new Set<string>([
  "HeaderMark",
  "EmphasisMark",
  "StrongEmphasisMark",
  "CodeMark",
  "StrikethroughMark",
  "LinkMark",
  "QuoteMark",
  "ListMark",
]);

type LineFlag = (lineFrom: number) => boolean;

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    const box = document.createElement("span");
    box.className = "cm-wend-task" + (this.checked ? " cm-wend-task-done" : "");
    box.setAttribute("aria-hidden", "true");
    box.textContent = this.checked ? "✓" : "";
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

class BulletWidget extends WidgetType {
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-wend-bullet";
    dot.setAttribute("aria-hidden", "true");
    dot.textContent = "•";
    return dot;
  }
  ignoreEvent() {
    return true;
  }
}

class HRWidget extends WidgetType {
  toDOM() {
    const hr = document.createElement("span");
    hr.className = "cm-wend-hr";
    hr.setAttribute("aria-hidden", "true");
    return hr;
  }
  ignoreEvent() {
    return true;
  }
}

const hiddenMark = Decoration.replace({});

function buildDecorations(view: EditorView): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  const { state } = view;
  const doc = state.doc;

  // Lines that intersect the cursor/selection — on these, reveal raw markers.
  const activeLines = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = doc.lineAt(range.from).number;
    const last = doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) activeLines.add(n);
  }
  const isActive: LineFlag = (pos: number) => activeLines.has(doc.lineAt(pos).number);

  const push = (from: number, to: number, deco: Decoration) => {
    if (from <= to) widgets.push(deco.range(from, to));
  };
  // Replace decorations (zero-length allowed for widgets, but marker hides need from<to).
  const hide = (from: number, to: number) => {
    if (from < to && !isActive(from)) widgets.push(hiddenMark.range(from, to));
  };

  for (const { from, to } of view.visibleRanges) {
    const tree =
      ensureSyntaxTree(state, to, 200) ?? syntaxTree(state);
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;

        // --- Block: headings -------------------------------------------------
        if (/^ATXHeading[1-6]$/.test(name)) {
          const level = Number(name.slice("ATXHeading".length));
          const line = doc.lineAt(node.from);
          push(line.from, line.from, Decoration.line({ class: `cm-wend-h${level}` }));
          return;
        }

        // --- Block: blockquote (may span lines) ------------------------------
        if (name === "Blockquote") {
          const startLine = doc.lineAt(node.from).number;
          const endLine = doc.lineAt(Math.min(node.to, doc.length)).number;
          for (let n = startLine; n <= endLine; n++) {
            const line = doc.line(n);
            push(line.from, line.from, Decoration.line({ class: "cm-wend-quote" }));
          }
          return;
        }

        // --- Block: fenced & indented code (span lines) ----------------------
        if (name === "FencedCode" || name === "CodeBlock") {
          const startLine = doc.lineAt(node.from).number;
          const endLine = doc.lineAt(Math.min(node.to, doc.length)).number;
          for (let n = startLine; n <= endLine; n++) {
            const line = doc.line(n);
            const pos = n === startLine ? "-first" : n === endLine ? "-last" : "";
            push(
              line.from,
              line.from,
              Decoration.line({ class: `cm-wend-codeblock${pos}` }),
            );
          }
          return;
        }

        // --- Block: horizontal rule -----------------------------------------
        if (name === "HorizontalRule") {
          const line = doc.lineAt(node.from);
          push(line.from, line.from, Decoration.line({ class: "cm-wend-hrline" }));
          if (!isActive(node.from)) {
            push(node.from, node.to, Decoration.replace({ widget: new HRWidget() }));
          }
          return;
        }

        // --- Inline: emphasis / strong / strike ------------------------------
        if (name === "StrongEmphasis") {
          push(node.from, node.to, Decoration.mark({ class: "cm-wend-strong" }));
          return;
        }
        if (name === "Emphasis") {
          push(node.from, node.to, Decoration.mark({ class: "cm-wend-em" }));
          return;
        }
        if (name === "Strikethrough") {
          push(node.from, node.to, Decoration.mark({ class: "cm-wend-strike" }));
          return;
        }

        // --- Inline: code span ----------------------------------------------
        if (name === "InlineCode") {
          push(node.from, node.to, Decoration.mark({ class: "cm-wend-code" }));
          return;
        }

        // --- Inline: links ---------------------------------------------------
        if (name === "Link") {
          // Style the visible label; hide URL + title + brackets via LinkMark/URL.
          push(node.from, node.to, Decoration.mark({ class: "cm-wend-link" }));
          if (!isActive(node.from)) {
            const cursor = node.node.cursor();
            if (cursor.firstChild()) {
              do {
                const cn = cursor.name;
                if (cn === "URL" || cn === "LinkTitle") {
                  hide(cursor.from, cursor.to);
                }
              } while (cursor.nextSibling());
            }
          }
          return;
        }

        // --- Task list checkbox ([ ] / [x]) ---------------------------------
        if (name === "TaskMarker") {
          if (!isActive(node.from)) {
            const text = doc.sliceString(node.from, node.to);
            const checked = /x/i.test(text);
            push(
              node.from,
              node.to,
              Decoration.replace({ widget: new CheckboxWidget(checked) }),
            );
          }
          return;
        }

        // --- Markers (hide on inactive lines) -------------------------------
        if (MARKER_NODES.has(name)) {
          if (name === "ListMark") {
            // Render unordered bullets as a real dot; leave ordered "1." as-is.
            const text = doc.sliceString(node.from, node.to);
            const isBullet = /^[-*+]$/.test(text.trim());
            if (isBullet && !isActive(node.from)) {
              push(
                node.from,
                node.to,
                Decoration.replace({ widget: new BulletWidget() }),
              );
            }
            return;
          }
          if (name === "HeaderMark") {
            // Hide "# " including the trailing space so the heading reads clean.
            let end = node.to;
            if (doc.sliceString(end, end + 1) === " ") end += 1;
            hide(node.from, end);
            return;
          }
          hide(node.from, node.to);
          return;
        }
      },
    });
  }

  widgets.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  const builder = new RangeSetBuilder<Decoration>();
  for (const w of widgets) builder.add(w.from, w.to, w.value);
  return builder.finish();
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    // Atomic ranges so the cursor steps over hidden markers cleanly.
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => {
        return view.plugin(plugin)?.decorations ?? Decoration.none;
      }),
  },
);

