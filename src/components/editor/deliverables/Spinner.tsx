import { useEffect } from "react";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { CircleNotchIcon } from "phosphor-react-native";

import { useTheme } from "@/theme/ThemeProvider";

export function Spinner({ size = 15, color }: { size?: number; color?: string }) {
  const { tokens } = useTheme();
  const tint = color ?? tokens["text-secondary"];
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 1000, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(rotation);
  }, [rotation]);

  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View style={style}>
      <CircleNotchIcon size={size} color={tint} weight="bold" />
    </Animated.View>
  );
}
