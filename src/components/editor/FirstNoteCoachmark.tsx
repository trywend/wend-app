/**
 * Wend — FirstNoteCoachmark.
 *
 * One-time tooltip that floats above the S1 floating send button on the
 * user's very first note. Bobs gently on the Y axis at ~3s cycle.
 *
 * Dismissal is permanent per-device — persisted to AsyncStorage under the
 * key `wend.coachmark.firstNote.dismissed`. After dismissal, the consumer
 * (HomeScreen) should not mount this component again.
 *
 * Visibility decision happens in the parent — this component just renders
 * the tooltip. Wrap it in a tappable backdrop (or use the parent's outer
 * Pressable) to dismiss.
 */
import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";

export const FIRST_NOTE_COACHMARK_KEY = "wend.coachmark.firstNote.dismissed";

export function FirstNoteCoachmark() {
  const { tokens } = useTheme();
  const offset = useSharedValue(0);

  useEffect(() => {
    offset.value = withRepeat(
      withSequence(
        withTiming(-4, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(offset);
    };
  }, [offset]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          marginBottom: 12,
          marginRight: 8,
          alignItems: "flex-end",
        },
        animatedStyle,
      ]}
    >
      <View
        style={{
          maxWidth: 220,
          backgroundColor: tokens["surface-elevated"],
          borderColor: tokens["border-hairline"],
          borderWidth: 1,
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 10,
          shadowColor: "#000",
          shadowOpacity: 0.1,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
          elevation: 3,
        }}
      >
        <Text
          style={{
            fontFamily: "Inter-Medium",
            fontSize: 13,
            color: tokens["text-secondary"],
            textAlign: "center",
          }}
        >
          Tap send. The note does the work.
        </Text>
      </View>
      {/* Arrow pointing down to the button — a rotated square that picks up
          the same bg + border so it merges seamlessly with the bubble. */}
      <View
        style={{
          width: 12,
          height: 12,
          backgroundColor: tokens["surface-elevated"],
          borderRightWidth: 1,
          borderBottomWidth: 1,
          borderColor: tokens["border-hairline"],
          transform: [{ rotate: "45deg" }],
          marginTop: -7,
          marginRight: 16,
        }}
      />
    </Animated.View>
  );
}
