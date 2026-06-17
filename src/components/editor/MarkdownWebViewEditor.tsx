/**
 * Wend — CodeMirror 6 live-preview markdown editor in a WebView.
 *
 * Wraps the self-contained editor bundled at
 * `markdownEditorHtml.generated.ts`. The WebView owns the document; the RN
 * side mirrors the raw markdown into `value` and feeds edits out through
 * `onChangeText`. The HTML's bridge contract is implemented verbatim:
 *
 *  - initial state via `window.__WEND_INIT__` (injected before content loads)
 *  - RN → WebView via `window.WendEditor.receive(JSON.stringify(msg))`
 *  - WebView → RN via `onMessage` (event.nativeEvent.data = JSON)
 *
 * Cursor preservation: a `setValue` re-seed resets the CodeMirror selection,
 * so we only re-seed when the parent `value` diverges from the last markdown
 * the editor itself emitted. Normal typing round-trips (`change` → onChangeText
 * → parent re-renders with the same string) never re-seed.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { View } from "react-native";
import Animated, { FadeOut } from "react-native-reanimated";
import type { StyleProp, ViewStyle } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";

import { EDITOR_HTML } from "./markdownEditorHtml.generated";

export interface MarkdownEditorTheme {
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

export type EditorCommand =
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

export interface MarkdownWebViewEditorHandle {
  focus: () => void;
  blur: () => void;
  command: (name: EditorCommand) => void;
}

export interface MarkdownWebViewEditorProps {
  value: string;
  onChangeText: (markdown: string) => void;
  theme: MarkdownEditorTheme;
  placeholder?: string;
  autoFocus?: boolean;
  onSelectionChange?: (sel: { start: number; end: number }) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  style?: StyleProp<ViewStyle>;
  minHeight?: number;
}

const DEFAULT_MIN_HEIGHT = 80;

export const MarkdownWebViewEditor = forwardRef<
  MarkdownWebViewEditorHandle,
  MarkdownWebViewEditorProps
>(function MarkdownWebViewEditor(
  {
    value,
    onChangeText,
    theme,
    placeholder,
    autoFocus,
    onSelectionChange,
    onFocus,
    onBlur,
    style,
    minHeight = DEFAULT_MIN_HEIGHT,
  },
  ref,
) {
  const webRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  // `ready` drives the paper cover below; Android's WebView surface flashes
  // dark while the ~500KB bundle loads (most visible right after an OTA
  // reload), so we paint paper over it until CodeMirror reports `ready`.
  const [ready, setReady] = useState(false);
  // The markdown the editor last reported. We treat this as the editor's
  // own view of the document so we can distinguish a genuine external change
  // (note switch / toolbar-free programmatic edit) from the controlled
  // round-trip that follows every keystroke.
  const lastEmittedRef = useRef(value);
  const heightRef = useRef(minHeight);
  // The auto-height is driven imperatively (animating the host View's height
  // via setNativeProps) so a height message doesn't trigger a React re-render
  // on every keystroke.
  const hostRef = useRef<View>(null);

  const themeKey = useMemo(() => JSON.stringify(theme), [theme]);

  // Sent into the page BEFORE first paint. Re-created only when the theme or
  // the initial markdown identity changes; the WebView itself is keyed on
  // nothing, so this string is read once at mount.
  const injectedBefore = useMemo(() => {
    const init = JSON.stringify({ markdown: value, theme });
    return `window.__WEND_INIT__ = ${init}; true;`;
    // value/placeholder intentionally captured at mount only — subsequent
    // updates go through the message bridge, not a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const post = useCallback((msg: Record<string, unknown>) => {
    const json = JSON.stringify(msg);
    webRef.current?.injectJavaScript(
      `window.WendEditor && window.WendEditor.receive(${JSON.stringify(json)}); true;`,
    );
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => post({ type: "focus" }),
      blur: () => post({ type: "blur" }),
      command: (name) => post({ type: "command", name }),
    }),
    [post],
  );

  // Push theme updates after the page is ready (scheme flip, etc.).
  useEffect(() => {
    if (!readyRef.current) return;
    post({ type: "setTheme", theme });
  }, [themeKey, post, theme]);

  // External value changes: re-seed only when the incoming value diverges
  // from what the editor itself last emitted. This is the cursor-preservation
  // guard — typing produces value === lastEmitted, so we never re-seed mid-keystroke.
  useEffect(() => {
    if (!readyRef.current) return;
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    post({ type: "setValue", markdown: value });
  }, [value, post]);

  const applyHeight = useCallback(
    (px: number) => {
      const h = Math.max(minHeight, Math.round(px));
      if (h === heightRef.current) return;
      heightRef.current = h;
      hostRef.current?.setNativeProps({ style: { height: h } });
    },
    [minHeight],
  );

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let msg: { type?: string } & Record<string, unknown>;
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case "ready": {
          readyRef.current = true;
          setReady(true);
          // Re-apply theme + placeholder in case they changed between mount
          // and ready (injectedBefore captured them at mount).
          post({ type: "setTheme", theme });
          if (autoFocus) post({ type: "focus" });
          break;
        }
        case "change": {
          const md = typeof msg.markdown === "string" ? msg.markdown : "";
          lastEmittedRef.current = md;
          onChangeText(md);
          break;
        }
        case "selection": {
          if (onSelectionChange) {
            const from = typeof msg.from === "number" ? msg.from : 0;
            const to = typeof msg.to === "number" ? msg.to : from;
            onSelectionChange({ start: from, end: to });
          }
          break;
        }
        case "height": {
          if (typeof msg.px === "number") applyHeight(msg.px);
          break;
        }
        case "focus": {
          onFocus?.();
          break;
        }
        case "blur": {
          onBlur?.();
          break;
        }
      }
    },
    [post, theme, autoFocus, onChangeText, onSelectionChange, applyHeight, onFocus, onBlur],
  );

  return (
    <View
      ref={hostRef}
      style={[
        { height: heightRef.current, overflow: "hidden", backgroundColor: theme.paper },
        style,
      ]}
    >
      <WebView
        ref={webRef}
        source={{ html: EDITOR_HTML }}
        originWhitelist={["*"]}
        injectedJavaScriptBeforeContentLoaded={injectedBefore}
        onMessage={onMessage}
        scrollEnabled={false}
        // Transparent so the editor blends into the note canvas. This version
        // of react-native-webview has no `opaque` prop in its types; a
        // transparent style + a paper background behind the host View is the
        // supported route to a see-through WebView on iOS.
        style={{ flex: 1, backgroundColor: "transparent" }}
        // Android: let the soft keyboard rise on programmatic focus.
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView
        androidLayerType="hardware"
        automaticallyAdjustContentInsets={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        bounces={false}
        textInteractionEnabled
        // The bundle is local + self-contained; no network, no new windows.
        setSupportMultipleWindows={false}
        javaScriptEnabled
      />
      {!ready ? (
        <Animated.View
          exiting={FadeOut.duration(160)}
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: theme.paper,
          }}
        />
      ) : null}
    </View>
  );
});
