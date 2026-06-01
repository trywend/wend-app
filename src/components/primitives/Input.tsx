/**
 * Wend — Input primitive.
 *
 * A labelled TextInput with hairline border that turns ember on focus (the
 * focus token) and rose on error. Error text renders below in caption/failed.
 * Color comes exclusively from semantic classes; selectionColor (which can't be
 * a className) reads the resolved accent-caret token from the theme.
 *
 * Note: this is the generic form input. The note editor (Phase 2) uses its own
 * bespoke TextInput — this primitive is for sign-in fields, settings, etc.
 */
import { useState } from "react";
import { TextInput, View, type TextInputProps } from "react-native";

import { cn } from "@/lib/cn";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "./Text";

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerClassName?: string;
}

export function Input({
  label,
  error,
  containerClassName,
  className,
  onFocus,
  onBlur,
  ...props
}: InputProps) {
  const { tokens } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View className={cn("w-full", containerClassName)}>
      {label ? (
        <Text variant="meta" className="mb-1.5 text-secondary">
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={tokens["text-placeholder"]}
        selectionColor={tokens["accent-caret"]}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        className={cn(
          "min-h-[48px] rounded-block border bg-surface px-4 py-3 text-body font-sans text-primary",
          error ? "border-failed" : focused ? "border-focus" : "border-hairline",
          className,
        )}
        {...props}
      />
      {error ? (
        <Text variant="caption" className="mt-1.5 text-failed">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
