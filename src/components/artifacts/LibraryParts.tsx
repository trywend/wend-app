/**
 * Wend — building blocks shared by the Artifacts library segments. Every
 * tappable goes through PressableSurface (NativeWind 4 drops function-form
 * Pressable styles).
 */
import { useState } from "react";
import { TextInput, View } from "react-native";
import { MagnifyingGlassIcon, XCircleIcon } from "phosphor-react-native";

import { PressableSurface, Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import { typography } from "@/theme/tokens";

export const DIMMED = { opacity: 0.6 } as const;

export function bucketLabel(ts: number, now: Date): string {
  const d = new Date(ts);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startOfToday) return "Today";
  if (ts >= startOfToday - 86_400_000) return "Yesterday";
  if (ts >= startOfToday - 6 * 86_400_000) return "This week";
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
    return "This month";
  }
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function bucketByDate<T>(items: T[], at: (item: T) => number) {
  const now = new Date();
  const order: string[] = [];
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const label = bucketLabel(at(item), now);
    if (!groups[label]) {
      groups[label] = [];
      order.push(label);
    }
    groups[label].push(item);
  }
  return order.map((title) => ({ title, data: groups[title] }));
}

export function Segmented<K extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
}) {
  const { tokens } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        backgroundColor: tokens["surface-chip"],
        borderRadius: 9,
        padding: 2,
      }}
    >
      {options.map((o) => {
        const selected = o.key === value;
        return (
          <PressableSurface
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            hitSlop={{ top: 10, bottom: 10 }}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 5,
              borderRadius: 7,
              minWidth: 72,
              alignItems: "center",
              backgroundColor: selected ? tokens["surface-canvas"] : "transparent",
            }}
          >
            <Text
              variant="meta"
              style={{ color: selected ? tokens["text-primary"] : tokens["text-secondary"] }}
            >
              {o.label}
            </Text>
          </PressableSurface>
        );
      })}
    </View>
  );
}

export function SearchField({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
}) {
  const { tokens } = useTheme();
  const [focused, setFocused] = useState(false);
  const accent = tokens["accent-default"];
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 }}>
      <View
        style={{
          height: 40,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          borderBottomWidth: 1,
          borderBottomColor: focused ? accent : tokens["border-hairline"],
        }}
      >
        <MagnifyingGlassIcon
          size={18}
          color={focused ? accent : tokens["text-tertiary"]}
          weight="regular"
        />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={tokens["text-placeholder"]}
          selectionColor={tokens["accent-caret"]}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={{
            flex: 1,
            paddingVertical: 0,
            fontFamily: "Inter-Regular",
            fontSize: typography.body.fontSize,
            color: tokens["text-primary"],
          }}
        />
        {value.length > 0 ? (
          <PressableSurface
            onPress={() => onChangeText("")}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={13}
            pressedStyle={{ opacity: 0.5 }}
          >
            <XCircleIcon size={18} color={tokens["text-secondary"]} weight="fill" />
          </PressableSurface>
        ) : null}
      </View>
    </View>
  );
}

export function FilterChip({
  label,
  count,
  selected,
  onPress,
}: {
  label: string;
  count: number;
  selected: boolean;
  onPress: () => void;
}) {
  const { tokens } = useTheme();
  return (
    <PressableSurface
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}, ${count}`}
      hitSlop={{ top: 6, bottom: 6 }}
      style={{
        height: 32,
        borderRadius: 16,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: selected ? tokens["accent-default"] : tokens["border-hairline"],
        backgroundColor: selected ? tokens["surface-chip"] : "transparent",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
      }}
      pressedStyle={{ backgroundColor: tokens["surface-chip"] }}
    >
      <Text
        variant="meta"
        style={{ color: selected ? tokens["text-primary"] : tokens["text-secondary"] }}
      >
        {label}
      </Text>
      <Text
        variant="caption"
        style={{
          color: selected ? tokens["text-secondary"] : tokens["text-tertiary"],
          fontVariant: ["tabular-nums"],
        }}
      >
        {count}
      </Text>
    </PressableSurface>
  );
}

export function SectionHeader({
  title,
  count,
  first,
}: {
  title: string;
  count: number;
  first: boolean;
}) {
  const { tokens } = useTheme();
  return (
    <View
      accessibilityRole="header"
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingTop: first ? 8 : 24,
        paddingBottom: 6,
      }}
    >
      <Text
        variant="caption"
        style={{
          color: tokens["text-secondary"],
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}
      >
        {title}
      </Text>
      <Text
        variant="caption"
        style={{ color: tokens["text-tertiary"], fontVariant: ["tabular-nums"] }}
      >
        {count}
      </Text>
    </View>
  );
}

export function CenteredState({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 32,
        paddingBottom: 48,
      }}
    >
      {children}
    </View>
  );
}

export function EmptyGlyph({ children }: { children: React.ReactNode }) {
  const { tokens } = useTheme();
  return (
    <View
      style={{
        width: 64,
        height: 64,
        borderRadius: 32,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tokens["surface-chip"],
        borderWidth: 1,
        borderColor: tokens["border-hairline"],
        marginBottom: 18,
      }}
    >
      {children}
    </View>
  );
}

export function Headline({ children }: { children: React.ReactNode }) {
  const { tokens } = useTheme();
  return (
    <Text
      variant="body-em"
      style={{ color: tokens["text-secondary"], textAlign: "center", maxWidth: 280 }}
    >
      {children}
    </Text>
  );
}

export function Body({ children }: { children: React.ReactNode }) {
  const { tokens } = useTheme();
  return (
    <Text
      variant="meta"
      style={{ color: tokens["text-tertiary"], textAlign: "center", maxWidth: 280, marginTop: 8 }}
    >
      {children}
    </Text>
  );
}

export function StateLink({ label, onPress }: { label: string; onPress: () => void }) {
  const { tokens } = useTheme();
  return (
    <PressableSurface
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={14}
      style={{ marginTop: 16 }}
      pressedStyle={DIMMED}
    >
      <Text variant="meta" style={{ color: tokens["accent-default"] }}>
        {label}
      </Text>
    </PressableSurface>
  );
}
