/**
 * Wend — the arm bar.
 *
 * The inline preview + consent surface that replaces the old send chip. Sits
 * in the chip's absolute slot above the keyboard toolbar. Layout:
 *
 *   ⌖ {repoName} · read-only  …  Wending in {n}  …  ✕ cancel
 *
 * The arm bar IS the preview — no new screens, no fabricated cost. When
 * autoCountdown is on a 2px ember underline shrinks left→right over the 3s and
 * the numeral cross-fades per tick. Reduce-motion suppresses all of it: bar
 * appears instantly, countdown is static 1Hz text.
 *
 * NativeWind/Pressable gotcha (CLAUDE.md §9): every Pressable carries inline
 * `style` for layout; className is reserved for non-layout. The outer plain
 * View owns all bar layout so tap targets stay static-styled.
 */
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  FadeIn,
} from "react-native-reanimated";
import { CrosshairIcon, XIcon } from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";

const SPRING = { stiffness: 280, damping: 30, mass: 0.9 } as const;
const COUNTDOWN_MS = 3000;
const EMBER = "#D85A3C";

export interface ArmBarProps {
  repoName: string | null;
  posture: string;
  ticket: string | null;
  secondsLeft: number;
  autoCountdown: boolean;
  reduceMotion: boolean;
  bottomOffset: number;
  onCancel: () => void;
  onFireNow: () => void;
  onPickRepo: () => void;
}

export function ArmBar({
  repoName,
  posture,
  ticket,
  secondsLeft,
  autoCountdown,
  reduceMotion,
  bottomOffset,
  onCancel,
  onFireNow,
  onPickRepo,
}: ArmBarProps): React.JSX.Element {
  const { tokens } = useTheme();
  const inkColor = tokens["text-primary"];
  const subtleColor = tokens["text-secondary"];
  const borderColor = tokens["border-hairline"];

  const target = ticket ? `${repoName ?? "auto"} (${ticket})` : repoName ?? "auto";

  return (
    <Animated.View
      entering={
        reduceMotion
          ? FadeIn.duration(0)
          : SlideInDown.springify()
              .stiffness(SPRING.stiffness)
              .damping(SPRING.damping)
              .mass(SPRING.mass)
      }
      exiting={SlideOutDown.duration(180)}
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        bottom: bottomOffset,
        alignItems: "center",
        zIndex: 40,
        pointerEvents: "box-none",
      }}
      pointerEvents="box-none"
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          maxWidth: "100%",
          overflow: "hidden",
          backgroundColor: tokens["surface-elevated"],
          borderColor: borderColor,
          borderWidth: 1,
          borderRadius: 999,
          paddingLeft: 14,
          paddingRight: 8,
          paddingVertical: 6,
          shadowColor: "#000",
          shadowOpacity: 0.1,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        }}
      >
        <Pressable
          onLongPress={onPickRepo}
          accessibilityRole="button"
          accessibilityLabel={`Target ${target}, ${posture}. Long-press to change repo.`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            flexShrink: 1,
            marginRight: 10,
          }}
        >
          <CrosshairIcon size={14} color={EMBER} weight="bold" />
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{
              fontFamily: "Inter-Medium",
              fontSize: 13,
              color: inkColor,
              marginLeft: 6,
              flexShrink: 1,
            }}
          >
            {target}
          </Text>
          <Text
            style={{
              fontFamily: "Inter-Medium",
              fontSize: 12,
              color: EMBER,
              opacity: 0.7,
              marginLeft: 6,
            }}
          >
            · {posture}
          </Text>
        </Pressable>

        {autoCountdown ? (
          <Countdown
            secondsLeft={secondsLeft}
            reduceMotion={reduceMotion}
            inkColor={inkColor}
          />
        ) : (
          <Pressable
            onPress={onFireNow}
            accessibilityRole="button"
            accessibilityLabel="Wend it"
            style={{
              flexShrink: 0,
              marginRight: 8,
              paddingHorizontal: 12,
              paddingVertical: 5,
              borderRadius: 999,
              backgroundColor: EMBER,
            }}
          >
            <Text
              style={{
                fontFamily: "Inter-SemiBold",
                fontSize: 13,
                color: "#FFFFFF",
              }}
            >
              Wend it
            </Text>
          </Pressable>
        )}

        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="cancel"
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            height: 30,
            paddingHorizontal: 8,
            borderRadius: 16,
            flexShrink: 0,
          }}
        >
          <XIcon size={14} color={subtleColor} weight="bold" />
          <Text
            style={{
              fontFamily: "Inter-Medium",
              fontSize: 13,
              color: subtleColor,
              marginLeft: 4,
            }}
          >
            cancel
          </Text>
        </Pressable>
      </View>

      {autoCountdown && !reduceMotion ? <ProgressUnderline /> : null}
    </Animated.View>
  );
}

function Countdown({
  secondsLeft,
  reduceMotion,
  inkColor,
}: {
  secondsLeft: number;
  reduceMotion: boolean;
  inkColor: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        flexShrink: 0,
        marginRight: 10,
      }}
    >
      <Text
        style={{
          fontFamily: "Inter-Medium",
          fontSize: 13,
          color: inkColor,
        }}
      >
        Wending in{" "}
      </Text>
      {reduceMotion ? (
        <Text
          style={{
            fontFamily: "Inter-SemiBold",
            fontSize: 13,
            color: EMBER,
          }}
        >
          {secondsLeft}
        </Text>
      ) : (
        <Animated.Text
          key={secondsLeft}
          entering={FadeIn.duration(180)}
          style={{
            fontFamily: "Inter-SemiBold",
            fontSize: 13,
            color: EMBER,
          }}
        >
          {secondsLeft}
        </Animated.Text>
      )}
    </View>
  );
}

function ProgressUnderline() {
  const scaleX = useSharedValue(1);

  useEffect(() => {
    scaleX.value = 1;
    scaleX.value = withTiming(0, { duration: COUNTDOWN_MS });
  }, [scaleX]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scaleX: scaleX.value }],
  }));

  return (
    <View
      style={{
        position: "absolute",
        left: 24,
        right: 24,
        bottom: 4,
        height: 2,
        borderRadius: 1,
        overflow: "hidden",
      }}
      pointerEvents="none"
    >
      <Animated.View
        style={[
          {
            width: "100%",
            height: "100%",
            backgroundColor: EMBER,
            opacity: 0.5,
            transformOrigin: "left",
          },
          style,
        ]}
      />
    </View>
  );
}
