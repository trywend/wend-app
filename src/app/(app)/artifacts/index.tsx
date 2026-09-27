/**
 * SCREEN: Artifacts — every artifact every note has produced on the paired
 * Mac (files, pages, images, diffs, long answers), newest first, bucketed by
 * date. Search covers name, note, project, and prompt; chips filter by kind.
 * Tap opens the artifact; long-press offers delete.
 *
 * Renders from the persisted cache instantly and refreshes in the background
 * (useArtifactsLibrary).
 *
 * NativeWind gotcha: every Pressable here with a function `style` keeps
 * layout inline; className carries non-layout only.
 */
import { useDeferredValue, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
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
  XCircleIcon,
} from "phosphor-react-native";

import { Text, Spinner } from "@/components/primitives";
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

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const list = artifacts.filter((a) => {
      if (kind !== "all" && a.kind !== kind) return false;
      if (!q) return true;
      return `${a.name} ${a.noteTitle} ${a.project} ${a.prompt}`
        .toLowerCase()
        .includes(q);
    });
    if (sort === "oldest") return [...list].reverse();
    if (sort === "largest") return [...list].sort((a, b) => b.size - a.size);
    return list;
  }, [artifacts, deferredQuery, kind, sort]);

  const sections = useMemo<Section[]>(() => {
    if (sort === "largest") return [{ title: "Largest first", data: filtered }];
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
  const summary = hasItems
    ? `${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}` +
      (storedBytes > 0 ? ` · ${formatBytes(storedBytes)} on your Mac` : "")
    : null;

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
        <View style={{ width: 40, height: 36, borderRadius: 8, overflow: "hidden" }}>
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => ({
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <CaretLeftIcon size={22} color={subtle} weight="regular" />
          </Pressable>
        </View>
        <Text variant="body-em" style={{ color: ink }}>
          Artifacts
        </Text>
        <View style={{ width: 40, alignItems: "flex-end", paddingRight: 6 }}>
          <HealthDot size={8} />
        </View>
      </View>

      {hasItems ? (
        <View style={{ paddingTop: 10 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginHorizontal: 16,
              paddingHorizontal: 12,
              height: 38,
              borderRadius: 10,
              backgroundColor: chip,
              borderWidth: 1,
              borderColor: border,
              gap: 8,
            }}
          >
            <MagnifyingGlassIcon size={16} color={tertiary} weight="regular" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search files, notes, projects"
              placeholderTextColor={tokens["text-placeholder"]}
              selectionColor={tokens["accent-caret"]}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              style={{
                flex: 1,
                color: ink,
                fontFamily: "Inter-Regular",
                fontSize: typography.body.fontSize,
                paddingVertical: 0,
              }}
            />
            {query.length > 0 ? (
              <Pressable
                onPress={() => setQuery("")}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <XCircleIcon size={16} color={tertiary} weight="fill" />
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 6 }}
            keyboardShouldPersistTaps="handled"
          >
            {FILTERS.map((f) => {
              const n = f.key === "all" ? artifacts.length : counts[f.key] ?? 0;
              if (f.key !== "all" && n === 0) return null;
              const selected = kind === f.key;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => setKind(f.key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${f.label}, ${n}`}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 5,
                    height: 30,
                    paddingHorizontal: 12,
                    borderRadius: 15,
                    borderWidth: 1,
                    borderColor: selected ? accent : border,
                    backgroundColor: selected ? chip : "transparent",
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text variant="meta" style={{ color: selected ? ink : subtle }}>
                    {f.label}
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: tertiary, fontVariant: ["tabular-nums"] }}
                  >
                    {n}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 20,
              paddingBottom: 4,
            }}
          >
            <Text variant="caption" style={{ color: tertiary }}>
              {summary}
            </Text>
            <Pressable
              onPress={() => setSort(NEXT_SORT[sort])}
              accessibilityRole="button"
              accessibilityLabel={`Sort: ${SORT_LABEL[sort]}`}
              hitSlop={8}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <ArrowsDownUpIcon size={13} color={subtle} weight="regular" />
              <Text variant="caption" style={{ color: subtle }}>
                {SORT_LABEL[sort]}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {status === "loading" && !hasItems ? (
        <CenteredState>
          <Spinner size={22} color={subtle} />
          <Text variant="meta" style={{ color: subtle, marginTop: 10 }}>
            Loading artifacts…
          </Text>
        </CenteredState>
      ) : status === "not-ready" && !hasItems ? (
        <CenteredState>
          <EmptyGlyph chip={chip} border={border}>
            <LaptopIcon size={30} color={tertiary} weight="light" />
          </EmptyGlyph>
          <Text variant="body-em" style={{ color: subtle, textAlign: "center", maxWidth: 280 }}>
            Pair your Mac to see its artifacts
          </Text>
          <Text
            variant="caption"
            style={{ color: tertiary, textAlign: "center", maxWidth: 270, marginTop: 8, lineHeight: 18 }}
          >
            Every file, page, diff, and answer your notes produce lands here.
          </Text>
        </CenteredState>
      ) : status === "error" && !hasItems ? (
        <CenteredState>
          <Text variant="meta" style={{ color: subtle, textAlign: "center", maxWidth: 280 }}>
            {error ?? "Could not reach your Mac."}
          </Text>
          <Pressable
            onPress={refresh}
            style={({ pressed }) => ({ marginTop: 14, opacity: pressed ? 0.6 : 1 })}
          >
            <Text variant="meta" style={{ color: accent }}>
              Try again
            </Text>
          </Pressable>
        </CenteredState>
      ) : !hasItems ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={refreshControl}
        >
          <CenteredState>
            <EmptyGlyph chip={chip} border={border}>
              <PackageIcon size={28} color={tertiary} weight="light" />
            </EmptyGlyph>
            <Text variant="body-em" style={{ color: subtle, textAlign: "center", maxWidth: 280 }}>
              No artifacts yet
            </Text>
            <Text
              variant="caption"
              style={{ color: tertiary, textAlign: "center", maxWidth: 280, marginTop: 8, lineHeight: 18 }}
            >
              Wend a note that writes a file, a page, or a diff. It lands here, kept on your Mac until you delete it.
            </Text>
          </CenteredState>
        </ScrollView>
      ) : filtered.length === 0 ? (
        <CenteredState>
          <EmptyGlyph chip={chip} border={border}>
            <MagnifyingGlassIcon size={26} color={tertiary} weight="light" />
          </EmptyGlyph>
          <Text variant="body-em" style={{ color: subtle, textAlign: "center", maxWidth: 280 }}>
            No artifacts match
          </Text>
          <Pressable
            onPress={() => {
              setQuery("");
              setKind("all");
            }}
            style={({ pressed }) => ({ marginTop: 10, opacity: pressed ? 0.6 : 1 })}
          >
            <Text variant="meta" style={{ color: accent }}>
              Clear filters
            </Text>
          </Pressable>
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
          renderSectionHeader={({ section }) => (
            <View
              accessibilityRole="header"
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                paddingHorizontal: 20,
                paddingTop: 18,
                paddingBottom: 6,
              }}
            >
              <Text variant="caption" style={{ color: subtle, letterSpacing: 0.4 }}>
                {section.title.toUpperCase()}
              </Text>
              <Text variant="caption" style={{ color: tertiary, fontVariant: ["tabular-nums"] }}>
                {section.data.length}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <ArtifactRow
              artifact={item}
              ink={ink}
              subtle={subtle}
              tertiary={tertiary}
              chip={chip}
              border={border}
              accent={accent}
              onPress={() => open(item)}
              onLongPress={() => confirmDelete(item)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function ArtifactRow({
  artifact,
  ink,
  subtle,
  tertiary,
  chip,
  border,
  accent,
  onPress,
  onLongPress,
}: {
  artifact: LibraryArtifact;
  ink: string;
  subtle: string;
  tertiary: string;
  chip: string;
  border: string;
  accent: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const name = displayName(artifact);
  const meta = [
    artifact.kind === "answer" ? null : artifact.noteTitle,
    artifact.project || null,
    formatBytes(artifact.size) || null,
    formatSessionTime(artifact.createdAt),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`Open ${name}, ${meta}`}
      accessibilityHint="Long press to delete"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 20,
        paddingVertical: 11,
        backgroundColor: pressed ? chip : "transparent",
      })}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 9,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: chip,
          borderWidth: 1,
          borderColor: border,
        }}
      >
        <ArtifactKindIcon kind={artifact.kind} size={16} color={artifact.available ? accent : tertiary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text
            variant="body-em"
            numberOfLines={1}
            ellipsizeMode="middle"
            style={{ color: artifact.available ? ink : tertiary, flexShrink: 1 }}
          >
            {name}
          </Text>
          {!artifact.available ? (
            <Text variant="caption" style={{ color: tertiary }}>
              Removed
            </Text>
          ) : null}
        </View>
        <Text variant="caption" numberOfLines={1} style={{ color: subtle, marginTop: 2 }}>
          {meta}
        </Text>
      </View>
    </Pressable>
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

function EmptyGlyph({
  chip,
  border,
  children,
}: {
  chip: string;
  border: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        width: 64,
        height: 64,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: chip,
        borderWidth: 1,
        borderColor: border,
        marginBottom: 16,
      }}
    >
      {children}
    </View>
  );
}
