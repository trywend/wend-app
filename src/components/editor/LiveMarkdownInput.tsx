/**
 * Wend — multiline input that renders markdown WYSIWYG as the user types.
 *
 * Backed by react-native-enriched-markdown's EnrichedMarkdownTextInput (by
 * Software Mansion), a Fabric/new-arch native input that renders headings,
 * lists, quotes, code, bold/italic/links as rich blocks inline. It replaces
 * @expensify/react-native-live-markdown, whose native decorator silently
 * no-ops on RN 0.85.
 *
 * Controlled→uncontrolled bridge: the enriched input is uncontrolled (seeded
 * once via `defaultValue`). Wend's editor keeps raw markdown as the source of
 * truth (`value`) so dispatch reads it verbatim. We mirror every edit back out
 * via `onChangeMarkdown` → `onChangeText`, and re-seed via `setValue` only when
 * the parent hands us a DIFFERENT value than the last markdown we emitted —
 * that is a note switch, not a keystroke. `lastEmittedRef` guards the feedback
 * loop.
 *
 * `theme` maps to the input's `markdownStyle`, which only themes strong/em/
 * link/spoiler. Headings/code/lists/quotes still render as rich blocks with
 * the library's defaults — there is no API to theme or toggle them on the
 * input.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Ref } from "react";
import type { ViewStyle, TextStyle, ColorValue } from "react-native";
import {
  EnrichedMarkdownTextInput,
  type EnrichedMarkdownTextInputInstance,
} from "react-native-enriched-markdown";

export interface LiveMarkdownTheme {
  ink: string;
  subtle: string;
  accent: string;
  surfaceChip: string;
}

/** What the screen can drive on a LiveMarkdownInput: the full enriched
 *  instance (focus/blur/toggleBold/setLink/getMarkdown/setSelection/…) plus
 *  `setMarkdown`, which re-seeds the native input AND records the value as
 *  self-emitted so the controlled `value` round-trip doesn't re-seed again. */
export interface LiveMarkdownInputHandle
  extends EnrichedMarkdownTextInputInstance {
  setMarkdown: (markdown: string) => void;
}

export interface LiveMarkdownInputProps {
  value: string;
  onChangeText: (v: string) => void;
  theme: LiveMarkdownTheme;
  placeholder?: string;
  placeholderTextColor?: ColorValue;
  selectionColor?: ColorValue;
  autoFocus?: boolean;
  scrollEnabled?: boolean;
  style?: ViewStyle | TextStyle;
  onFocus?: () => void;
  onBlur?: () => void;
  onSelectionChange?: (e: {
    nativeEvent: { selection: { start: number; end: number } };
  }) => void;
}

export const LiveMarkdownInput = forwardRef<
  LiveMarkdownInputHandle,
  LiveMarkdownInputProps
>(function LiveMarkdownInput(
  {
    value,
    onChangeText,
    theme,
    placeholder,
    placeholderTextColor,
    selectionColor,
    autoFocus,
    scrollEnabled,
    style,
    onFocus,
    onBlur,
    onSelectionChange,
  },
  ref,
) {
  const innerRef = useRef<EnrichedMarkdownTextInputInstance | null>(null);
  // The last markdown this input emitted (or was seeded with). When `value`
  // differs from it, the change came from the parent (note switch / toolbar
  // setValue), so we re-seed the native input; when it matches, it's our own
  // echo and we skip to avoid a feedback loop.
  const lastEmittedRef = useRef<string>(value);

  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      lastEmittedRef.current = value;
      innerRef.current?.setValue(value);
    }
  }, [value]);

  useImperativeHandle(
    ref,
    (): LiveMarkdownInputHandle => {
      const live = () => innerRef.current!;
      return {
        focus: () => live().focus(),
        blur: () => live().blur(),
        measure: (...a) => live().measure(...a),
        measureInWindow: (...a) => live().measureInWindow(...a),
        measureLayout: (...a) => live().measureLayout(...a),
        setValue: (md) => live().setValue(md),
        setSelection: (s, e) => live().setSelection(s, e),
        toggleBold: () => live().toggleBold(),
        toggleItalic: () => live().toggleItalic(),
        toggleUnderline: () => live().toggleUnderline(),
        toggleStrikethrough: () => live().toggleStrikethrough(),
        toggleSpoiler: () => live().toggleSpoiler(),
        setLink: (url) => live().setLink(url),
        insertLink: (text, url) => live().insertLink(text, url),
        insertMention: (text, url) => live().insertMention(text, url),
        startMention: (indicator) => live().startMention(indicator),
        removeLink: () => live().removeLink(),
        getMarkdown: () => live().getMarkdown(),
        getCaretRect: () => live().getCaretRect(),
        setMarkdown: (md) => {
          lastEmittedRef.current = md;
          live().setValue(md);
        },
      };
    },
    [],
  );

  return (
    <EnrichedMarkdownTextInput
      ref={innerRef}
      defaultValue={value}
      multiline
      autoFocus={autoFocus}
      scrollEnabled={scrollEnabled}
      placeholder={placeholder}
      placeholderTextColor={placeholderTextColor}
      selectionColor={selectionColor}
      cursorColor={selectionColor}
      style={style}
      markdownStyle={{
        strong: { color: theme.ink },
        em: { color: theme.ink },
        link: { color: theme.accent, underline: true },
      }}
      onChangeMarkdown={(md) => {
        lastEmittedRef.current = md;
        onChangeText(md);
      }}
      onChangeSelection={(selection) =>
        onSelectionChange?.({ nativeEvent: { selection } })
      }
      onFocus={onFocus}
      onBlur={onBlur}
    />
  );
});
