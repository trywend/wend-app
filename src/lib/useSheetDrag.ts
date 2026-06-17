/**
 * Wend — shared swipe-to-dismiss for the full-height sheets (inbox, settings).
 *
 * The panel must be rendered as TWO stacked Animated.Views: the outer one owns
 * the SlideInDown/SlideOutDown layout animation, the inner one (styled visually)
 * carries `panelStyle`. On Fabric a single node cannot run a layout animation
 * AND a gesture-driven transform at once — the layout-animation manager wins and
 * the drag silently does nothing. Splitting the nodes is what makes the handle
 * actually drag.
 */
import { useMemo } from "react";
import type { ViewStyle } from "react-native";
import {
  Gesture,
  type PanGesture,
} from "react-native-gesture-handler";
import {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type AnimatedStyle,
} from "react-native-reanimated";

const SPRING = { stiffness: 280, damping: 30, mass: 0.9 } as const;
const DISMISS_PX = 80;
const DISMISS_VELOCITY = 600;

export interface SheetDrag {
  /** Attach to the GestureDetector wrapping the handle + header row. */
  pan: PanGesture;
  /** Apply to the inner (visually styled) panel Animated.View. */
  panelStyle: AnimatedStyle<ViewStyle>;
  /** Apply to the backdrop Animated.View so it fades as the panel slides. */
  backdropStyle: AnimatedStyle<ViewStyle>;
}

export function useSheetDrag(onClose: () => void): SheetDrag {
  const dragY = useSharedValue(0);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dragY.value, [0, 300], [1, 0.2], Extrapolation.CLAMP),
  }));

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Only follow downward drag; upward is a no-op so the panel never
        // lifts past its resting position.
        .onUpdate((e) => {
          dragY.value = Math.max(0, e.translationY);
        })
        .onEnd((e) => {
          if (e.translationY > DISMISS_PX || e.velocityY > DISMISS_VELOCITY) {
            runOnJS(onClose)();
          } else {
            dragY.value = withSpring(0, SPRING);
          }
        }),
    [dragY, onClose],
  );

  return { pan, panelStyle, backdropStyle };
}
