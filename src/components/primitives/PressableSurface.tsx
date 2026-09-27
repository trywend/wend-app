/**
 * Wend — tappable surface. NativeWind 4 drops every property a function-form
 * `Pressable.style` returns, so the Pressable stays unstyled and all visuals
 * live on the inner View, with pressed state tracked in React state.
 */
import { useState } from "react";
import {
  Pressable,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

export interface PressableSurfaceProps
  extends Pick<
    PressableProps,
    | "onPress"
    | "onLongPress"
    | "delayLongPress"
    | "disabled"
    | "hitSlop"
    | "accessibilityRole"
    | "accessibilityLabel"
    | "accessibilityHint"
    | "accessibilityState"
  > {
  style?: StyleProp<ViewStyle>;
  pressedStyle?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function PressableSurface({
  style,
  pressedStyle,
  children,
  ...pressableProps
}: PressableSurfaceProps) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      {...pressableProps}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
    >
      <View style={[style, pressed && pressedStyle]}>{children}</View>
    </Pressable>
  );
}
