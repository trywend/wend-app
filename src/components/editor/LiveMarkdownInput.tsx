/**
 * Wend — multiline input that highlights markdown live as the user types.
 *
 * Backed by @expensify/react-native-live-markdown's MarkdownTextInput: a
 * native drop-in TextInput replacement that styles ranges produced by a
 * worklet parser (see `lib/liveMarkdownParser.ts`). The previous approach —
 * styled <Text> spans as TextInput children — rendered plain on Android
 * under the new architecture, so styling now happens at the native layer.
 *
 * `value` remains the raw markdown editing buffer (dispatch reads it); the
 * parser only decorates ranges. All TextInput props (selection, focus refs,
 * caretHidden, placeholder) pass straight through.
 */
import { forwardRef, useMemo } from "react";
import type { Ref, ComponentRef } from "react";
import { TurboModuleRegistry } from "react-native";
import type { TextInput, TextInputProps } from "react-native";
import { MarkdownTextInput } from "@expensify/react-native-live-markdown";

import {
  buildMarkdownStyle,
  parseWendMarkdown,
  type LiveMarkdownTheme,
} from "@/lib/liveMarkdownParser";

// Missing native module means markdown renders as plain text with no crash —
// the failure mode of an OTA landing on a binary built before the lib. Surface
// it so it never again reads as a parser bug.
if (__DEV__ && TurboModuleRegistry.get("LiveMarkdownModule") == null) {
  console.warn(
    "[Wend] LiveMarkdownModule native module is missing from this binary. " +
      "Live markdown will render as plain text. Ship a fresh `eas build` — " +
      "an OTA update cannot deliver the native decorator.",
  );
}

export interface LiveMarkdownInputProps
  extends Omit<TextInputProps, "children"> {
  value: string;
  onChangeText: (v: string) => void;
  theme: LiveMarkdownTheme;
}

export const LiveMarkdownInput = forwardRef<TextInput, LiveMarkdownInputProps>(
  function LiveMarkdownInput({ value, theme, style, ...rest }, ref) {
    const markdownStyle = useMemo(() => buildMarkdownStyle(theme), [theme]);

    return (
      <MarkdownTextInput
        // MarkdownTextInput's instance extends TextInput, so a TextInput ref
        // receives a compatible instance — TS just can't prove it across the
        // intersection type.
        ref={ref as Ref<ComponentRef<typeof MarkdownTextInput>>}
        value={value}
        multiline
        parser={parseWendMarkdown}
        markdownStyle={markdownStyle}
        style={style}
        {...rest}
      />
    );
  },
);
