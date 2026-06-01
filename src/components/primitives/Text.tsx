/**
 * Wend — typed Text primitive.
 *
 * Maps the Design Doc § 3.2 typography tokens to the right font-size + font
 * family className so callers write `<Text variant="title">` instead of
 * memorizing class combos. Color defaults to text-primary; override with the
 * `className` prop using a semantic color class (never a hex).
 *
 * Weight is encoded by swapping the font family (Inter / Inter-Medium /
 * Inter-SemiBold) rather than fontWeight, because variable-weight RN font
 * rendering is unreliable across Android — discrete family files are correct.
 */
import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/cn";

const text = cva("text-primary", {
  variants: {
    variant: {
      display: "text-display font-sans-semibold",
      title: "text-title font-sans-semibold",
      heading: "text-heading font-sans-semibold",
      body: "text-body font-sans",
      "body-em": "text-body font-sans-medium",
      meta: "text-meta font-sans-medium",
      caption: "text-caption font-sans-medium",
      "mono-body": "text-mono-body font-mono",
      "mono-inline": "text-mono-inline font-mono-medium",
    },
  },
  defaultVariants: { variant: "body" },
});

export interface TextProps
  extends RNTextProps,
    VariantProps<typeof text> {}

export function Text({ variant, className, ...props }: TextProps) {
  return <RNText className={cn(text({ variant }), className)} {...props} />;
}
