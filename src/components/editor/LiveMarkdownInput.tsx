/**
 * Wend — live-preview markdown editor (CodeMirror 6 in a WebView).
 *
 * This is the body editor for a note. It replaces the old Expensify
 * MarkdownTextInput: the document now lives inside a self-contained
 * CodeMirror 6 page (`markdownEditorHtml.generated.ts`) that renders an
 * Obsidian-grade live preview. `value` stays the raw markdown buffer
 * (dispatch reads it verbatim); the WebView reports edits back.
 *
 * The public surface is kept close to the old TextInput-ish one so callers
 * change minimally: `value`, `onChangeText`, `theme`, `style`, plus a
 * forwarded ref exposing `.focus()` / `.blur()` / `.command(name)`. Props
 * that only made sense for a native TextInput (caretHidden, selectionColor,
 * textAlignVertical, placeholderTextColor, scrollEnabled) are accepted and
 * ignored so existing call sites keep compiling.
 */
import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { StyleSheet } from "react-native";
import type { StyleProp, TextStyle } from "react-native";

import { fontFamily, typography } from "@/theme/tokens";

import {
  MarkdownWebViewEditor,
  type EditorCommand,
  type MarkdownEditorTheme,
  type MarkdownWebViewEditorHandle,
} from "./MarkdownWebViewEditor";

export type { EditorCommand } from "./MarkdownWebViewEditor";

export interface LiveMarkdownTheme {
  ink: string;
  subtle: string;
  accent: string;
  surfaceChip: string;
  /** Editor surface — transparent/paper so it blends into the note canvas. */
  paper?: string;
  /** Code background; falls back to surfaceChip. */
  codeBg?: string;
  border?: string;
}

export interface LiveMarkdownInputRef {
  focus: () => void;
  blur: () => void;
  command: (name: EditorCommand) => void;
}

export interface LiveMarkdownInputProps {
  value: string;
  onChangeText: (v: string) => void;
  theme: LiveMarkdownTheme;
  style?: StyleProp<TextStyle>;
  placeholder?: string;
  autoFocus?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onSelectionChange?: (sel: { start: number; end: number }) => void;
}

export const LiveMarkdownInput = forwardRef<
  LiveMarkdownInputRef,
  LiveMarkdownInputProps
>(function LiveMarkdownInput(
  {
    value,
    onChangeText,
    theme,
    style,
    placeholder,
    autoFocus,
    onFocus,
    onBlur,
    onSelectionChange,
  },
  ref,
) {
  const inner = useRef<MarkdownWebViewEditorHandle>(null);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => inner.current?.focus(),
      blur: () => inner.current?.blur(),
      command: (name) => inner.current?.command(name),
    }),
    [],
  );

  // The body/follow-up call sites pass a TextStyle tuned for the old native
  // input (font, color, padding). Only the layout-affecting bits transfer to
  // the WebView host View; typography is reconstructed into the editor theme.
  const flat = StyleSheet.flatten(style) ?? {};
  const minHeight =
    typeof flat.minHeight === "number" ? flat.minHeight : undefined;
  const inkColor =
    typeof flat.color === "string" ? flat.color : theme.ink;
  const fontSize =
    typeof flat.fontSize === "number" ? flat.fontSize : typography.body.fontSize;
  const lineHeight =
    typeof flat.lineHeight === "number"
      ? flat.lineHeight
      : typography.body.lineHeight;

  const hostStyle = useMemo(
    () => ({
      marginTop: flat.marginTop,
      marginBottom: flat.marginBottom,
      marginVertical: flat.marginVertical,
    }),
    [flat.marginTop, flat.marginBottom, flat.marginVertical],
  );

  const editorTheme: MarkdownEditorTheme = useMemo(
    () => ({
      ink: inkColor,
      subtle: theme.subtle,
      accent: theme.accent,
      paper: theme.paper ?? "transparent",
      surfaceChip: theme.surfaceChip,
      codeBg: theme.codeBg ?? theme.surfaceChip,
      border: theme.border ?? theme.subtle,
      fontBody: fontFamily.sans,
      fontMono: fontFamily.mono,
      fontSize,
      lineHeight,
    }),
    [
      inkColor,
      theme.subtle,
      theme.accent,
      theme.paper,
      theme.surfaceChip,
      theme.codeBg,
      theme.border,
      fontSize,
      lineHeight,
    ],
  );

  return (
    <MarkdownWebViewEditor
      ref={inner}
      value={value}
      onChangeText={onChangeText}
      theme={editorTheme}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onFocus={onFocus}
      onBlur={onBlur}
      onSelectionChange={onSelectionChange}
      minHeight={minHeight}
      style={hostStyle}
    />
  );
});
