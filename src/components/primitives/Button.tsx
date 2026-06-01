/**
 * Wend — Button primitive (cva variants).
 *
 * Three variants (Design Doc § 4 / principle #4 "one accent, one verb"):
 *   primary   — ember fill, white label. The send/commit affordance. The ONE
 *               place ember appears as a fill on a button.
 *   secondary — hairline-bordered, transparent fill, primary-text label. The
 *               calm default for everything that isn't the one verb.
 *   tertiary  — text-only, secondary-color label. Low-emphasis / inline links.
 *
 * Pressed state darkens via accent-pressed (primary) or a chip tint (secondary).
 * Disabled drops opacity + ignores presses. 44pt min touch target honored via
 * py + min-height utility on each size.
 */
import { Pressable, type PressableProps, View } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/cn";
import { Text } from "./Text";

const container = cva(
  "flex-row items-center justify-center rounded-block",
  {
    variants: {
      variant: {
        primary: "bg-accent active:bg-accent-pressed",
        secondary: "border border-hairline bg-transparent active:bg-surface-chip",
        tertiary: "bg-transparent active:opacity-60",
      },
      size: {
        // min-h enforces the 44pt/48dp touch target (Design Doc § 3.5 / a11y).
        md: "min-h-[48px] px-5 py-3",
        sm: "min-h-[44px] px-4 py-2",
      },
      disabled: { true: "opacity-40", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", disabled: false },
  },
);

const label = cva("", {
  variants: {
    variant: {
      primary: "text-accent-on",
      secondary: "text-primary",
      tertiary: "text-secondary",
    },
  },
  defaultVariants: { variant: "primary" },
});

export interface ButtonProps
  extends Omit<PressableProps, "disabled" | "children">,
    VariantProps<typeof container> {
  label: string;
  /** Optional leading element (e.g. a Phosphor icon). */
  leading?: React.ReactNode;
  className?: string;
}

export function Button({
  label: text,
  leading,
  variant,
  size,
  disabled,
  className,
  ...props
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={!!disabled}
      className={cn(container({ variant, size, disabled }), className)}
      {...props}
    >
      {leading ? <View className="mr-2">{leading}</View> : null}
      <Text variant="body-em" className={label({ variant })}>
        {text}
      </Text>
    </Pressable>
  );
}
