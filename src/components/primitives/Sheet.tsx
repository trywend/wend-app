/**
 * Wend — Sheet primitive (base).
 *
 * The foundation for the inbox pull-down sheet (Phase 6) and the routing
 * half-sheet (Phase 7). Phase 1 ships the base only: a controlled sheet that
 * slides from an edge over a dim backdrop, with a drag handle and swipe-to-
 * dismiss. The full inbox choreography (resting at ~88%, search-on-pull, spring
 * 280/30/0.9) is layered on top later.
 *
 * Motion uses the locked spring (Design Doc § 3.4): stiffness 280, damping 30,
 * mass 0.9. Reduce-Motion downgrade to a 200ms ease is a polish-phase concern.
 *
 * `edge="bottom"` is the routing half-sheet shape; `edge="top"` is the inbox
 * pull-down shape. Both share this base.
 */
import { useEffect } from "react";
import { Modal, Pressable, View } from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
} from "react-native-reanimated";

import { cn } from "@/lib/cn";

const SPRING = { stiffness: 280, damping: 30, mass: 0.9 } as const;

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  edge?: "bottom" | "top";
  children: React.ReactNode;
  /** Sheet panel height as a fraction of available space (0–1). */
  heightFraction?: number;
  className?: string;
}

export function Sheet({
  open,
  onClose,
  edge = "bottom",
  children,
  heightFraction = 0.88,
  className,
}: SheetProps) {
  // translateY: 0 = resting (visible). Off-screen sign depends on the edge.
  const hidden = edge === "bottom" ? 1200 : -1200;
  const translateY = useSharedValue(hidden);
  const backdrop = useSharedValue(0);

  useEffect(() => {
    if (open) {
      translateY.value = withSpring(0, SPRING);
      backdrop.value = withTiming(1, { duration: 240 });
    } else {
      translateY.value = withTiming(hidden, { duration: 200 });
      backdrop.value = withTiming(0, { duration: 200 });
    }
  }, [open, hidden, translateY, backdrop]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  // Swipe toward the originating edge dismisses.
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      const dy = e.translationY;
      const toward = edge === "bottom" ? dy > 0 : dy < 0;
      if (toward) translateY.value = dy;
    })
    .onEnd((e) => {
      const past = Math.abs(e.translationY) > 120 || Math.abs(e.velocityY) > 800;
      if (past) {
        translateY.value = withTiming(hidden, { duration: 200 });
        runOnJS(onClose)();
      } else {
        translateY.value = withSpring(0, SPRING);
      }
    });

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <Animated.View
          style={backdropStyle}
          className="absolute inset-0 bg-black/40"
        >
          <Pressable className="flex-1" onPress={onClose} accessibilityRole="button" />
        </Animated.View>

        <GestureDetector gesture={pan}>
          <Animated.View
            style={[panelStyle, { maxHeight: `${heightFraction * 100}%` }]}
            className={cn(
              "rounded-t-3xl border-t border-hairline bg-surface px-5 pb-8 pt-3",
              edge === "top" && "absolute inset-x-0 top-0 rounded-b-3xl rounded-t-none border-b border-t-0 pb-3 pt-12",
              className,
            )}
          >
            {/* Drag handle (Design Doc § 4.11 — 4×36pt pill). */}
            <View className="mb-3 items-center">
              <View className="h-1 w-9 rounded-full bg-border-default" />
            </View>
            {children}
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  );
}
