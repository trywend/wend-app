import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, placeholder, drawSelection } from "@codemirror/view";
import { history, historyKeymap, defaultKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";

import { livePreview } from "./livePreview";
import { Theme, defaultTheme, buildTheme, themeCompartment } from "./theme";
import { runCommand, CommandName } from "./commands";

declare global {
  interface Window {
    WendEditor?: { receive: (json: string) => void };
    ReactNativeWebView?: { postMessage: (m: string) => void };
    __WEND_INIT__?: { markdown?: string; theme?: Partial<Theme> };
  }
}

type Outbound =
  | { type: "ready" }
  | { type: "change"; markdown: string }
  | { type: "selection"; from: number; to: number }
  | { type: "height"; px: number }
  | { type: "focus" }
  | { type: "blur" };

function post(msg: Outbound) {
  const s = JSON.stringify(msg);
  if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === "function") {
    window.ReactNativeWebView.postMessage(s);
  } else if (window.parent && window.parent !== window) {
    window.parent.postMessage(s, "*");
  }
}

const init = window.__WEND_INIT__ ?? {};
let theme: Theme = { ...defaultTheme, ...(init.theme ?? {}) };

const mount = document.getElementById("wend-editor")!;

// Suppress the change echo while applying a host-driven setValue.
let suppressChange = false;

let changeTimer: ReturnType<typeof setTimeout> | undefined;
function emitChangeDebounced(markdown: string) {
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = setTimeout(() => post({ type: "change", markdown }), 30);
}

let lastHeight = -1;
function emitHeight() {
  const px = Math.ceil(view.contentDOM.getBoundingClientRect().height) + 4;
  if (px !== lastHeight) {
    lastHeight = px;
    post({ type: "height", px });
  }
}

const updateListener = EditorView.updateListener.of((u) => {
  if (u.docChanged && !suppressChange) {
    emitChangeDebounced(u.state.doc.toString());
  }
  if (u.selectionSet) {
    const r = u.state.selection.main;
    post({ type: "selection", from: r.from, to: r.to });
  }
  if (u.docChanged || u.geometryChanged) {
    emitHeight();
  }
});

const focusListener = EditorView.focusChangeEffect.of(() => null);
const domFocus = EditorView.domEventHandlers({
  focus: () => {
    post({ type: "focus" });
    return false;
  },
  blur: () => {
    post({ type: "blur" });
    return false;
  },
});

const state = EditorState.create({
  doc: init.markdown ?? "",
  extensions: [
    history(),
    drawSelection(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    markdown({ base: markdownLanguage, extensions: GFM, addKeymap: false }),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    livePreview,
    themeCompartment.of(buildTheme(theme)),
    EditorView.lineWrapping,
    placeholder("Write a note…"),
    updateListener,
    focusListener,
    domFocus,
  ],
});

const view = new EditorView({ state, parent: mount });

const observer = new ResizeObserver(() => emitHeight());
observer.observe(view.contentDOM);

function receive(json: string) {
  let msg: any;
  try {
    msg = JSON.parse(json);
  } catch {
    return;
  }
  switch (msg?.type) {
    case "setValue": {
      suppressChange = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: String(msg.markdown ?? "") },
        selection: { anchor: 0 },
      });
      suppressChange = false;
      emitHeight();
      break;
    }
    case "setTheme": {
      theme = { ...defaultTheme, ...(msg.theme ?? {}) };
      view.dispatch({ effects: themeCompartment.reconfigure(buildTheme(theme)) });
      emitHeight();
      break;
    }
    case "command": {
      view.focus();
      runCommand(view, msg.name as CommandName);
      break;
    }
    case "focus":
      view.focus();
      break;
    case "blur":
      view.contentDOM.blur();
      break;
  }
}

window.WendEditor = { receive };

post({ type: "ready" });
emitHeight();
