/**
 * Wend — the "Claude" segment of the Artifacts library: every artifact in the
 * user's claude.ai account, mirrored by the Mac. Tap opens it in the in-app
 * browser. Only mounted while the segment is selected, so it polls only then.
 */
import { useDeferredValue, useMemo } from "react";
import { Linking, RefreshControl, ScrollView, SectionList, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  ArrowSquareOutIcon,
  LaptopIcon,
  MagnifyingGlassIcon,
  PackageIcon,
  WifiSlashIcon,
} from "phosphor-react-native";

import { PressableSurface, Spinner, Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import { formatSessionTime } from "@/lib/sessions/api";
import { useClaudeArtifacts } from "@/lib/artifacts/useClaudeArtifacts";
import type { ClaudeArtifact } from "@/lib/artifacts/claudeApi";
import {
  Body,
  bucketByDate,
  CenteredState,
  EmptyGlyph,
  FilterChip,
  Headline,
  SearchField,
  SectionHeader,
  StateLink,
} from "@/components/artifacts/LibraryParts";

export type OwnerFilter = "all" | "yours" | "shared";

const OWNER_LABEL: Record<OwnerFilter, string> = {
  all: "All",
  yours: "Yours",
  shared: "Shared with you",
};

function syncedLabel(ts: number): string {
  const t = formatSessionTime(ts);
  return t === "Just now" || t === "Yesterday" ? t.toLowerCase() : t;
}

function updatedLabel(ts: number): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startOfToday) return "today";
  if (ts >= startOfToday - 86_400_000) return "yesterday";
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

function openArtifact(url: string) {
  WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url).catch(() => {}));
}

export function ClaudeArtifactsLibrary({
  query,
  onQueryChange,
  owner,
  onOwnerChange,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  owner: OwnerFilter;
  onOwnerChange: (o: OwnerFilter) => void;
}) {
  const { tokens } = useTheme();
  const { artifacts, fetchedAt, status, error, unreachable, pulling, refreshing, refresh } =
    useClaudeArtifacts();
  const deferredQuery = useDeferredValue(query);

  const subtle = tokens["text-secondary"];
  const tertiary = tokens["text-tertiary"];
  const accent = tokens["accent-default"];

  const sorted = useMemo(
    () => [...artifacts].sort((a, b) => b.updatedAt - a.updatedAt),
    [artifacts],
  );
  const sharedCount = useMemo(() => artifacts.filter((a) => !a.owned).length, [artifacts]);
  const counts: Record<OwnerFilter, number> = {
    all: artifacts.length,
    yours: artifacts.length - sharedCount,
    shared: sharedCount,
  };
  // With nothing shared (or nothing owned) every chip would show the same list.
  const showChips = counts.yours > 0 && counts.shared > 0;
  const activeOwner: OwnerFilter = showChips ? owner : "all";

  const trimmedQuery = deferredQuery.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      sorted.filter((a) => {
        if (activeOwner === "yours" && !a.owned) return false;
        if (activeOwner === "shared" && a.owned) return false;
        return !trimmedQuery || a.title.toLowerCase().includes(trimmedQuery);
      }),
    [sorted, activeOwner, trimmedQuery],
  );
  const sections = useMemo(() => bucketByDate(filtered, (a) => a.updatedAt), [filtered]);

  function clearFilters() {
    onQueryChange("");
    onOwnerChange("all");
  }

  const refreshControl = (
    <RefreshControl refreshing={pulling} onRefresh={refresh} tintColor={subtle} colors={[accent]} />
  );

  const hasItems = artifacts.length > 0;
  const narrowed = activeOwner !== "all" || trimmedQuery.length > 0;
  const summary = narrowed
    ? `${filtered.length} of ${artifacts.length}`
    : `${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}` +
      (fetchedAt ? ` · synced ${syncedLabel(fetchedAt)}` : "");
  const staleNote = error
    ? unreachable
      ? "Showing the saved list. Your Mac did not respond."
      : `Showing the saved list. ${error}`
    : null;

  return (
    <>
      {hasItems ? (
        <View>
          <SearchField
            value={query}
            onChangeText={onQueryChange}
            placeholder="Search Claude artifacts"
          />

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
              {(["all", "yours", "shared"] as const).map((key) => (
                <FilterChip
                  key={key}
                  label={OWNER_LABEL[key]}
                  count={counts[key]}
                  selected={activeOwner === key}
                  onPress={() => onOwnerChange(key)}
                />
              ))}
            </ScrollView>
          ) : null}

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
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
            {refreshing ? <Spinner size={12} color={tertiary} /> : null}
          </View>

          {staleNote ? (
            <Text
              variant="caption"
              numberOfLines={1}
              style={{ color: tertiary, paddingHorizontal: 20, paddingBottom: 4 }}
            >
              {staleNote}
            </Text>
          ) : null}
        </View>
      ) : null}

      {!hasItems && (status === "loading" || refreshing) ? (
        <CenteredState>
          <Spinner size={22} color={subtle} />
          <Text variant="meta" style={{ color: tertiary, textAlign: "center", marginTop: 12 }}>
            Fetching your claude.ai artifacts
          </Text>
        </CenteredState>
      ) : status === "not-ready" && !hasItems ? (
        <CenteredState>
          <EmptyGlyph>
            <LaptopIcon size={30} color={tertiary} weight="light" />
          </EmptyGlyph>
          <Headline>Pair your Mac to see your Claude artifacts</Headline>
          <Body>Every artifact in your claude.ai account shows up here.</Body>
        </CenteredState>
      ) : error && !hasItems ? (
        <CenteredState>
          <EmptyGlyph>
            <WifiSlashIcon size={28} color={tertiary} weight="light" />
          </EmptyGlyph>
          <Headline>
            {unreachable ? "Could not reach your Mac" : "Could not load Claude artifacts"}
          </Headline>
          <Body>{error}</Body>
          <StateLink label="Try again" onPress={refresh} />
        </CenteredState>
      ) : !hasItems ? (
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} refreshControl={refreshControl}>
          <CenteredState>
            <EmptyGlyph>
              <PackageIcon size={28} color={tertiary} weight="light" />
            </EmptyGlyph>
            <Headline>No Claude artifacts yet</Headline>
            <Body>Artifacts you make or are shared on claude.ai show up here.</Body>
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
          keyExtractor={(a) => a.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={refreshControl}
          renderSectionHeader={({ section }) => (
            <SectionHeader
              title={section.title}
              count={section.data.length}
              first={section === sections[0]}
            />
          )}
          renderItem={({ item }) => <ClaudeArtifactRow artifact={item} />}
        />
      )}
    </>
  );
}

function ClaudeArtifactRow({ artifact }: { artifact: ClaudeArtifact }) {
  const { tokens } = useTheme();
  const meta = `${artifact.owned ? "Yours" : "Shared with you"} · updated ${updatedLabel(artifact.updatedAt)}`;
  return (
    <PressableSurface
      onPress={() => openArtifact(artifact.url)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${artifact.title} in the browser, ${meta}`}
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
          backgroundColor: tokens["surface-chip"],
          borderWidth: 1,
          borderColor: tokens["border-hairline"],
          flexShrink: 0,
        }}
      >
        <ArrowSquareOutIcon size={18} color={tokens["text-secondary"]} weight="regular" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          variant="body-em"
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{ color: tokens["text-primary"] }}
        >
          {artifact.title}
        </Text>
        <Text
          variant="meta"
          numberOfLines={1}
          style={{ color: tokens["text-tertiary"], marginTop: 2 }}
        >
          {meta}
        </Text>
      </View>
    </PressableSurface>
  );
}
