/**
 * Wend — 40 x 40 icon button with a 44 touch target. Icon passed as child.
 */
import { PressableSurface } from "./PressableSurface";

export interface IconButtonProps {
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
  children: React.ReactNode;
}

const BOX = {
  width: 40,
  height: 40,
  borderRadius: 8,
  alignItems: "center",
  justifyContent: "center",
} as const;

const PRESSED = { opacity: 0.6 } as const;

export function IconButton({ onPress, accessibilityLabel, disabled, children }: IconButtonProps) {
  return (
    <PressableSurface
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={BOX}
      pressedStyle={PRESSED}
    >
      {children}
    </PressableSurface>
  );
}
