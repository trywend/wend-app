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

export interface SpinnerProps {
  size?: number;
  color: string;
  durationMs?: number;
  weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
}

export function Spinner({
  size = 20,
  color,
  durationMs = 1200,
  weight = "bold",
}: SpinnerProps) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = 0;
    rotation.value = withRepeat(
      withTiming(360, { duration: durationMs, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(rotation);
  }, [rotation, durationMs]);

  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View style={style}>
      <CircleNotchIcon size={size} color={color} weight={weight} />
    </Animated.View>
  );
}
