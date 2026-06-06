/**
 * Wend — multiline TextInput that highlights markdown live as the user types.
 *
 * Approach: React Native's <TextInput multiline> accepts <Text> children
 * which override its visual rendering while the controlled `value` prop
 * remains the source of truth for the editing buffer. We tokenize `value`
 * into per-character styled spans (see `lib/liveMarkdownSpans.ts`) and
 * render them as children. The TextInput owns selection / cursor / IME;
 * we never mutate text length, so the cursor positions remain correct.
 *
 * Why not the transparent-overlay technique: it forced exact font-metric
 * matching (impossible across heading sizes) and the cursor still drifted
 * on Android. Children-as-display is RN-native and works across both
 * platforms without metrics gymnastics.
 *
 * `value` is left undefined intentionally when passing children — instead
 * we read it back via children content. To keep this controlled, callers
 * pass both `value` and `onChangeText`; we pass `value` to the input AND
 * render children. RN merges these correctly (children supplies the
 * rendered glyphs; value remains the editing buffer).
 */
import { forwardRef } from "react";
import { TextInput, type TextInputProps } from "react-native";

import {
  tokenizeLiveMarkdown,
  type LiveMarkdownTheme,
} from "@/lib/liveMarkdownSpans";
import { Text } from "@/components/primitives";

export interface LiveMarkdownInputProps
  extends Omit<TextInputProps, "children"> {
  value: string;
  onChangeText: (v: string) => void;
  theme: LiveMarkdownTheme;
}

export const LiveMarkdownInput = forwardRef<TextInput, LiveMarkdownInputProps>(
  function LiveMarkdownInput({ value, theme, style, ...rest }, ref) {
    const spans = tokenizeLiveMarkdown(value, theme);

    return (
      <TextInput
        ref={ref}
        value={value}
        multiline
        style={style}
        {...rest}
      >
        {spans.length > 0
          ? spans.map((s, i) => (
              <Text key={i} style={s.style}>
                {s.text}
              </Text>
            ))
          : null}
      </TextInput>
    );
  },
);
