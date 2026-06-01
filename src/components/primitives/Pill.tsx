/**
 * Wend — Pill primitive.
 *
 * The small rounded chip used for the confidence chip, file-ref chips, filter
 * chips, and status pills (Design Doc § 4.3 / § 4.8 / § 4.11). 28pt tall,
 * surface-chip background, optional leading glyph. Mono variant uses JetBrains
 * Mono for file refs / code-ish content.
 *
 * Tone:
 *   default — surface-chip bg, primary text
 *   accent  — ember outline (used for the active filter chip, Design Doc § 5.3
 *             S11 "active filter chip in ember.500 outline")
 */
import { View, type ViewProps } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/cn";
import { Text } from "./Text";

const pill = cva(
  "h-7 flex-row items-center self-start rounded-block px-2.5",
  {
    variants: {
      tone: {
        default: "bg-surface-chip",
        accent: "border border-accent bg-transparent",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

export interface PillProps extends ViewProps, VariantProps<typeof pill> {
  label: string;
  mono?: boolean;
  leading?: React.ReactNode;
}

export function Pill({
  label,
  mono,
  tone,
  leading,
  className,
  ...props
}: PillProps) {
  return (
    <View className={cn(pill({ tone }), className)} {...props}>
      {leading ? <View className="mr-1.5">{leading}</View> : null}
      <Text
        variant={mono ? "mono-inline" : "caption"}
        className={tone === "accent" ? "text-accent" : "text-secondary"}
      >
        {label}
      </Text>
    </View>
  );
}
