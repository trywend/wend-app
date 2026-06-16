import { EditorView } from "@codemirror/view";
import { Compartment } from "@codemirror/state";

export interface Theme {
  ink: string;
  subtle: string;
  accent: string;
  paper: string;
  surfaceChip: string;
  codeBg: string;
  border: string;
  fontBody: string;
  fontMono: string;
  fontSize: number;
  lineHeight: number;
}

export const defaultTheme: Theme = {
  ink: "#1A1714",
  subtle: "#6B645A",
  accent: "#D85A3C",
  paper: "#FBFAF7",
  surfaceChip: "#EFEAE0",
  codeBg: "#F7F4EE",
  border: "#E2DCD0",
  fontBody:
    'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontMono:
    'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  fontSize: 17,
  lineHeight: 26,
};

export const themeCompartment = new Compartment();

export function buildTheme(t: Theme) {
  const lhRatio = (t.lineHeight / t.fontSize).toFixed(4);
  return EditorView.theme(
    {
      "&": {
        color: t.ink,
        backgroundColor: "transparent",
        fontSize: `${t.fontSize}px`,
        fontFamily: t.fontBody,
        height: "auto",
      },
      ".cm-scroller": {
        fontFamily: t.fontBody,
        lineHeight: String(lhRatio),
        overflow: "visible",
        WebkitOverflowScrolling: "touch",
      },
      ".cm-content": {
        padding: "16px 2px 48px 2px",
        caretColor: t.accent,
        maxWidth: "100%",
        letterSpacing: "0.002em",
      },
      "&.cm-focused": { outline: "none" },
      ".cm-line": { padding: "1px 0", position: "relative" },

      // Caret + selection — ember.
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: t.accent,
        borderLeftWidth: "2px",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
        {
          backgroundColor: hexWithAlpha(t.accent, 0.18),
        },
      ".cm-selectionMatch": {
        backgroundColor: hexWithAlpha(t.accent, 0.12),
      },

      // Headings.
      ".cm-wend-h1": {
        fontSize: "28px",
        lineHeight: "1.18",
        fontWeight: "600",
        letterSpacing: "-0.02em",
        margin: "10px 0 4px",
        color: t.ink,
      },
      ".cm-wend-h2": {
        fontSize: "23px",
        lineHeight: "1.2",
        fontWeight: "600",
        letterSpacing: "-0.018em",
        margin: "8px 0 3px",
        color: t.ink,
      },
      ".cm-wend-h3": {
        fontSize: "20px",
        lineHeight: "1.25",
        fontWeight: "600",
        letterSpacing: "-0.014em",
        margin: "6px 0 2px",
        color: t.ink,
      },
      ".cm-wend-h4": {
        fontSize: "18px",
        fontWeight: "600",
        letterSpacing: "-0.01em",
        color: t.ink,
      },
      ".cm-wend-h5": {
        fontSize: "16px",
        fontWeight: "600",
        color: t.subtle,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      },
      ".cm-wend-h6": {
        fontSize: "14px",
        fontWeight: "600",
        color: t.subtle,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      },

      // Inline emphasis.
      ".cm-wend-strong": { fontWeight: "700", color: t.ink },
      ".cm-wend-em": { fontStyle: "italic" },
      ".cm-wend-strike": { textDecoration: "line-through", color: t.subtle },

      // Inline code.
      ".cm-wend-code": {
        fontFamily: t.fontMono,
        fontSize: "0.86em",
        backgroundColor: t.codeBg,
        border: `1px solid ${t.border}`,
        borderRadius: "5px",
        padding: "1px 5px",
        color: t.ink,
      },

      // Fenced code block.
      ".cm-wend-codeblock, .cm-wend-codeblock-first, .cm-wend-codeblock-last": {
        fontFamily: t.fontMono,
        fontSize: "0.86em",
        backgroundColor: t.codeBg,
        lineHeight: "1.55",
        paddingLeft: "16px",
        paddingRight: "16px",
        color: t.ink,
      },
      ".cm-wend-codeblock-first": {
        borderTopLeftRadius: "8px",
        borderTopRightRadius: "8px",
        paddingTop: "8px",
        marginTop: "6px",
      },
      ".cm-wend-codeblock-last": {
        borderBottomLeftRadius: "8px",
        borderBottomRightRadius: "8px",
        paddingBottom: "8px",
        marginBottom: "6px",
      },

      // Blockquote.
      ".cm-wend-quote": {
        borderLeft: `3px solid ${hexWithAlpha(t.accent, 0.55)}`,
        paddingLeft: "14px",
        color: t.subtle,
        fontStyle: "italic",
        backgroundColor: hexWithAlpha(t.accent, 0.04),
      },

      // Links.
      ".cm-wend-link": {
        color: t.accent,
        textDecoration: "none",
        cursor: "pointer",
      },

      // List bullet widget.
      ".cm-wend-bullet": {
        color: t.accent,
        fontWeight: "700",
        paddingRight: "2px",
      },

      // Task checkbox widget.
      ".cm-wend-task": {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "16px",
        height: "16px",
        marginRight: "4px",
        borderRadius: "4px",
        border: `1.5px solid ${t.border}`,
        fontSize: "11px",
        lineHeight: "1",
        color: t.accent,
        verticalAlign: "-2px",
      },
      ".cm-wend-task-done": {
        backgroundColor: hexWithAlpha(t.accent, 0.12),
        borderColor: t.accent,
      },

      // Horizontal rule.
      ".cm-wend-hrline": { textAlign: "center" },
      ".cm-wend-hr": {
        display: "inline-block",
        width: "100%",
        borderTop: `1px solid ${t.border}`,
        height: "0",
        verticalAlign: "middle",
        margin: "10px 0",
      },

      ".cm-placeholder": { color: hexWithAlpha(t.ink, 0.32) },
    },
    { dark: isDark(t.paper) },
  );
}

function isDark(hex: string): boolean {
  const { r, g, b } = parseHex(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace("#", "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const n = parseInt(h.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function hexWithAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
