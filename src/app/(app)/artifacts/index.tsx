/**
 * SCREEN: Artifacts — every artifact every note has produced on the paired
 * Mac (files, pages, images, diffs, long answers), newest first, bucketed by
 * date. Search covers name, note, project, and prompt; chips filter by kind.
 * Tap opens the artifact; long-press offers delete.
 *
 * Renders from the persisted cache instantly and refreshes in the background
 * (useArtifactsLibrary).
 *
 * NativeWind 4 drops every property a function-form Pressable `style` returns,
 * so every tappable here goes through PressableSurface.
 */
import { useDeferredValue, useMemo, useState } from "react";
import {
  Alert,
  RefreshControl,
  ScrollView,
  SectionList,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  ArrowsDownUpIcon,
  CaretLeftIcon,
  LaptopIcon,
  MagnifyingGlassIcon,
  PackageIcon,
  WifiSlashIcon,
  XCircleIcon,
} from "phosphor-react-native";

import { IconButton, PressableSurface, Spinner, Text } from "@/components/primitives";
import { HealthDot } from "@/components/HealthDot";
import { useTheme } from "@/theme/ThemeProvider";
import { typography } from "@/theme/tokens";
import { useArtifactsLibrary } from "@/lib/artifacts/useArtifactsLibrary";
import {
  displayName,
  libraryKey,
  type LibraryArtifact,
} from "@/lib/artifacts/api";
import { formatSessionTime } from "@/lib/sessions/api";
import { formatBytes } from "@/components/editor/deliverables/useArtifact";
import { ArtifactKindIcon } from "@/components/artifacts/ArtifactKindIcon";
import type { ArtifactKind } from "@/lib/notes-storage";

type KindFilter = "all" | ArtifactKind;
type SortOrder = "newest" | "oldest" | "largest";

const FILTERS: { key: KindFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "file", label: "Files" },
  { key: "html", label: "Pages" },
  { key: "image", label: "Images" },
  { key: "diff", label: "Diffs" },
  { key: "answer", label: "Answers" },
];

const SORT_LABEL: Record<SortOrder, string> = {
  newest: "Newest",
  oldest: "Oldest",
  largest: "Largest",
};
const NEXT_SORT: Record<SortOrder, SortOrder> = {
  newest: "oldest",
  oldest: "largest",
  largest: "newest",
};

const DIMMED = { opacity: 0.6 } as const;

interface Section {
  title: string;
  data: LibraryArtifact[];
}

function bucketLabel(ts: number, now: Date): string {
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

export default function ArtifactsScreen() {
  const { tokens } = useTheme();
  const router = useRouter();
  const { artifacts, storedBytes, status, error, refreshing, refresh, remove } =
    useArtifactsLibrary();

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [kind, setKind] = useState<KindFilter>("all");
  const [sort, setSort] = useState<SortOrder>("newest");

  const canvas = tokens["surface-canvas"];
  const ink = tokens["text-primary"];
  const subtle = tokens["text-secondary"];
  const tertiary = tokens["text-tertiary"];
  const border = tokens["border-hairline"];
  const chip = tokens["surface-chip"];
  const accent = tokens["accent-default"];

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of artifacts) c[a.kind] = (c[a.kind] ?? 0) + 1;
    return c;
  }, [artifacts]);

  const kindsPresent = FILTERS.filter((f) => f.key !== "all" && (counts[f.key] ?? 0) > 0);
  const showChips = kindsPresent.length >= 2;
  // Derived rather than reset in an effect: a hidden chip row or a kind that
  // emptied after a delete both fall back to "all" on the same render.
  const activeKind: KindFilter =
    showChips && (kind === "all" || (counts[kind] ?? 0) > 0) ? kind : "all";

  const trimmedQuery = deferredQuery.trim().toLowerCase();
  const filtered = useMemo(() => {
    const list = artifacts.filter((a) => {
      if (activeKind !== "all" && a.kind !== activeKind) return false;
      if (!trimmedQuery) return true;
      return `${a.name} ${a.noteTitle} ${a.project} ${a.prompt}`
        .toLowerCase()
        .includes(trimmedQuery);
    });
    if (sort === "oldest") return [...list].reverse();
    if (sort === "largest") return [...list].sort((a, b) => b.size - a.size);
    return list;
  }, [artifacts, trimmedQuery, activeKind, sort]);

  const sections = useMemo<Section[]>(() => {
    if (sort === "largest") return [{ title: "", data: filtered }];
    const now = new Date();
    const order: string[] = [];
    const groups: Record<string, LibraryArtifact[]> = {};
    for (const a of filtered) {
      const label = bucketLabel(a.createdAt, now);
      if (!groups[label]) {
        groups[label] = [];
        order.push(label);
      }
      groups[label].push(a);
    }
    return order.map((title) => ({ title, data: groups[title] }));
  }, [filtered, sort]);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)");
  }

  function open(a: LibraryArtifact) {
    router.push({
      pathname: "/(app)/artifacts/view",
      params: { runId: a.runId, id: a.id },
    });
  }

  function clearFilters() {
    setQuery("");
    setKind("all");
  }

  function confirmDelete(a: LibraryArtifact) {
    Alert.alert(
      `Delete “${displayName(a)}”?`,
      "It is removed from your Mac. The note itself is not affected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            remove(a).catch(() =>
              Alert.alert("Could not delete", "Your Mac did not respond. Try again."),
            );
          },
        },
      ],
    );
  }

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={refresh}
      tintColor={subtle}
      colors={[accent]}
    />
  );

  const hasItems = artifacts.length > 0;
  const narrowed = activeKind !== "all" || trimmedQuery.length > 0;
  const summary = narrowed
    ? `${filtered.length} of ${artifacts.length}`
    : `${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}` +
      (storedBytes > 0 ? ` · ${formatBytes(storedBytes)} on your Mac` : "");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: canvas }} edges={["top", "bottom"]}>
      <View
        style={{
          height: 48,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 12,
          borderBottomWidth: 1,
          borderBottomColor: border,
        }}
      >
        <IconButton onPress={goBack} accessibilityLabel="Back">
          <CaretLeftIcon size={22} color={subtle} weight="regular" />
        </IconButton>
        <Text variant="body-em" style={{ color: ink }}>
          Artifacts
        </Text>
        <View style={{ width: 40, alignItems: "flex-end", paddingRight: 6 }}>
          <HealthDot size={8} />
        </View>
      </View>

      {hasItems ? (
        <View>
          <SearchField value={query} onChangeText={setQuery} />

          {showChips ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={{ flexGrow: 0 }}
              contentContainerStyle={{
                paddingHorizontal: 20,
                paddingVertical: 10,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              {FILTERS.map((f) => {
                const n = f.key === "all" ? artifacts.length : counts[f.key] ?? 0;
                if (f.key !== "all" && n === 0) return null;
                return (
                  <KindChip
                    key={f.key}
                    label={f.label}
                    count={n}
                    selected={activeKind === f.key}
                    onPress={() => setKind(f.key)}
                  />
                );
              })}
            </ScrollView>
          ) : null}

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 20,
              height: 32,
              marginTop: showChips ? 0 : 6,
            }}
          >
            <Text
              variant="caption"
              numberOfLines={1}
              style={{ color: tertiary, flexShrink: 1 }}
            >
              {summary}
            </Text>
            <PressableSurface
              onPress={() => setSort(NEXT_SORT[sort])}
              accessibilityRole="button"
              accessibilityLabel={`Sort: ${SORT_LABEL[sort]}`}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 12 }}
              pressedStyle={DIMMED}
            >
              <ArrowsDownUpIcon size={14} color={subtle} weight="regular" />
              <Text variant="caption" style={{ color: subtle }}>
                {SORT_LABEL[sort]}
              </Text>
            </PressableSurface>
          </View>

          {status === "error" ? (
            <Text
              variant="caption"
              style={{ color: tertiary, paddingHorizontal: 20, paddingBottom: 4 }}
            >
              Showing the saved list. Your Mac did not respond.
            </Text>
          ) : null}
        </View>
      ) : null}

      {status === "loading" && !hasItems ? (
        <CenteredState>
          <Spinner size={22} color={subtle} />
          <Text variant="meta" style={{ color: tertiary, textAlign: "center", marginTop: 12 }}>
            Loading artifacts
          </Text>
        </CenteredState>
      ) : status === "not-ready" && !hasItems ? (
        <CenteredState>
          <EmptyGlyph>
            <LaptopIcon size={30} color={tertiary} weight="light" />
          </EmptyGlyph>
          <Headline>Pair your Mac to see its artifacts</Headline>
          <Body>Every file, page, diff, and answer your notes produce lands here.</Body>
        </CenteredState>
      ) : status === "error" && !hasItems ? (
        <CenteredState>
          <EmptyGlyph>
            <WifiSlashIcon size={28} color={tertiary} weight="light" />
          </EmptyGlyph>
          <Headline>Could not reach your Mac</Headline>
          {error ? <Body>{error}</Body> : null}
          <StateLink label="Try again" onPress={refresh} />
        </CenteredState>
      ) : !hasItems ? (
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} refreshControl={refreshControl}>
          <CenteredState>
            <EmptyGlyph>
              <PackageIcon size={28} color={tertiary} weight="light" />
            </EmptyGlyph>
            <Headline>No artifacts yet</Headline>
            <Body>
              Wend a note that writes a file, a page, or a diff. It lands here and stays on your
              Mac until you delete it.
            </Body>
          </CenteredState>
        </ScrollView>
      ) : filtered.length === 0 ? (
        <CenteredState>
          <EmptyGlyph>
            <MagnifyingGlassIcon size={26} color={tertiary} weight="light" />
          </EmptyGlyph>
          <Headline>Nothing matches</Headline>
          <StateLink label="Clear filters" onPress={clearFilters} />
        </CenteredState>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={libraryKey}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={refreshControl}
          renderSectionHeader={({ section }) =>
            sort === "largest" ? null : (
              <View
                accessibilityRole="header"
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: 20,
                  paddingTop: section === sections[0] ? 8 : 24,
                  paddingBottom: 6,
                }}
              >
                <Text
                  variant="caption"
                  style={{ color: subtle, textTransform: "uppercase", letterSpacing: 0.6 }}
                >
                  {section.title}
                </Text>
                <Text
                  variant="caption"
                  style={{ color: tertiary, fontVariant: ["tabular-nums"] }}
                >
                  {section.data.length}
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <ArtifactRow
              artifact={item}
              onPress={() => open(item)}
              onLongPress={() => confirmDelete(item)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function SearchField({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (t: string) => void;
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
          placeholder="Search name, note, project"
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

function KindChip({
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

function ArtifactRow({
  artifact,
  onPress,
  onLongPress,
}: {
  artifact: LibraryArtifact;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { tokens } = useTheme();
  const tertiary = tokens["text-tertiary"];
  const border = tokens["border-hairline"];
  const removed = !artifact.available;
  const isAnswer = artifact.kind === "answer";
  const name = displayName(artifact);
  const meta = [
    isAnswer ? artifact.project : artifact.noteTitle,
    formatBytes(artifact.size),
    formatSessionTime(artifact.createdAt),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <PressableSurface
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`Open ${name}, ${meta}`}
      accessibilityHint="Long press to delete"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 20,
        paddingVertical: 12,
        minHeight: 64,
      }}
      pressedStyle={{ backgroundColor: tokens["surface-chip"] }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: removed ? "transparent" : tokens["surface-chip"],
          borderWidth: 1,
          borderColor: border,
          flexShrink: 0,
        }}
      >
        <ArtifactKindIcon
          kind={artifact.kind}
          size={18}
          color={removed ? tertiary : tokens["text-secondary"]}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text
            variant="body-em"
            numberOfLines={1}
            ellipsizeMode={isAnswer ? "tail" : "middle"}
            style={{ color: removed ? tertiary : tokens["text-primary"], flexShrink: 1 }}
          >
            {name}
          </Text>
          {removed ? (
            <View
              style={{
                marginLeft: 8,
                flexShrink: 0,
                paddingHorizontal: 6,
                paddingVertical: 1,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: border,
              }}
            >
              <Text variant="caption" style={{ color: tertiary }}>
                Removed
              </Text>
            </View>
          ) : null}
        </View>
        <Text variant="meta" numberOfLines={1} style={{ color: tertiary, marginTop: 2 }}>
          {meta}
        </Text>
      </View>
    </PressableSurface>
  );
}

function CenteredState({ children }: { children: React.ReactNode }) {
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

function EmptyGlyph({ children }: { children: React.ReactNode }) {
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

function Headline({ children }: { children: React.ReactNode }) {
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

function Body({ children }: { children: React.ReactNode }) {
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

function StateLink({ label, onPress }: { label: string; onPress: () => void }) {
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
