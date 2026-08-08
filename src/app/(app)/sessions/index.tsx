/**
 * SCREEN: Sessions — every Claude Code session on the paired Mac, newest
 * first. Not just Wend notes: terminal sessions too, read from
 * ~/.claude/projects via the daemon's GET /sessions.
 *
 * Tapping a row opens the conversation view, where the user can resume and
 * continue (steer) that session. This is resume-and-continue, not live
 * mid-run injection — headless claude can't take a message into a running
 * turn — so the copy never implies otherwise.
 *
 * The list renders instantly from the SWR cache (useSessions) and refreshes
 * in the background. A slim search bar filters the cached list locally by
 * project + title as you type.
 *
 * NativeWind gotcha: every Pressable here with a function `style` keeps
 * layout inline; className carries non-layout only.
 */
import { useDeferredValue, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  CaretLeftIcon,
  MagnifyingGlassIcon,
  XCircleIcon,
} from "phosphor-react-native";

import { Text, Spinner } from "@/components/primitives";
import { HealthDot } from "@/components/HealthDot";
import { useTheme } from "@/theme/ThemeProvider";
import { typography } from "@/theme/tokens";
import { useSessions } from "@/lib/sessions/useSessions";
import { formatSessionTime, type SessionSummary } from "@/lib/sessions/api";

export default function SessionsScreen() {
  const { tokens } = useTheme();
  const router = useRouter();
  const { sessions, status, error, refreshing, refresh } = useSessions();

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const canvas = tokens["surface-canvas"];
  const ink = tokens["text-primary"];
  const subtle = tokens["text-secondary"];
  const tertiary = tokens["text-tertiary"];
  const border = tokens["border-hairline"];
  const chip = tokens["surface-chip"];
  const accent = tokens["accent-default"];

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) =>
      `${s.project} ${s.title}`.toLowerCase().includes(q),
    );
  }, [sessions, deferredQuery]);

  const searching = query.trim().length > 0;
  const showSearch = status === "ready" && sessions.length > 0;

  function goNotes() {
    router.replace("/(app)");
  }

  function openSession(s: SessionSummary) {
    router.push({
      pathname: "/(app)/sessions/[id]",
      params: { id: s.id, cwd: s.cwd, project: s.project, title: s.title },
    });
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: canvas }}
      edges={["top", "bottom"]}
    >
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
            onPress={goNotes}
            accessibilityRole="button"
            accessibilityLabel="Back to notes"
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
        <Segmented active="sessions" onNotes={goNotes} />
        <View style={{ width: 40, alignItems: "flex-end", paddingRight: 6 }}>
          <HealthDot size={8} />
        </View>
      </View>

      {showSearch ? (
        <SearchBar
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery("")}
          ink={ink}
          subtle={subtle}
          tertiary={tertiary}
          border={border}
          chip={chip}
          caret={tokens["accent-caret"]}
          placeholder={tokens["text-placeholder"]}
        />
      ) : null}

      {status === "loading" ? (
        <CenteredState>
          <Spinner size={22} color={subtle} />
          <Text variant="meta" style={{ color: subtle, marginTop: 10 }}>
            Loading sessions…
          </Text>
        </CenteredState>
      ) : status === "not-ready" ? (
        <CenteredState>
          <Text
            variant="meta"
            style={{ color: subtle, textAlign: "center", maxWidth: 260 }}
          >
            Pair your Mac to see its Claude Code sessions here.
          </Text>
        </CenteredState>
      ) : status === "error" ? (
        <CenteredState>
          <Text
            variant="meta"
            style={{ color: subtle, textAlign: "center", maxWidth: 280 }}
          >
            {error ?? "Could not reach your Mac."}
          </Text>
          <Pressable
            onPress={refresh}
            style={({ pressed }) => ({
              marginTop: 14,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text variant="meta" style={{ color: accent }}>
              Try again
            </Text>
          </Pressable>
        </CenteredState>
      ) : sessions.length === 0 ? (
        <CenteredState>
          <Text
            variant="meta"
            style={{ color: subtle, textAlign: "center", maxWidth: 260 }}
          >
            No Claude Code sessions on this Mac yet.
          </Text>
        </CenteredState>
      ) : filtered.length === 0 ? (
        <CenteredState>
          <Text
            variant="meta"
            style={{ color: subtle, textAlign: "center", maxWidth: 260 }}
          >
            No sessions match “{query.trim()}”.
          </Text>
        </CenteredState>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingVertical: 6 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={subtle}
              colors={[accent]}
            />
          }
          renderItem={({ item, index }) => (
            <SessionRow
              session={item}
              active={!searching && index === 0}
              ink={ink}
              subtle={subtle}
              tertiary={tertiary}
              border={border}
              chip={chip}
              accent={accent}
              onPress={() => openSession(item)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function SearchBar({
  value,
  onChangeText,
  onClear,
  ink,
  subtle,
  tertiary,
  border,
  chip,
  caret,
  placeholder,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onClear: () => void;
  ink: string;
  subtle: string;
  tertiary: string;
  border: string;
  chip: string;
  caret: string;
  placeholder: string;
}) {
  const has = value.length > 0;
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          height: 38,
          paddingHorizontal: 12,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: border,
          backgroundColor: chip,
        }}
      >
        <MagnifyingGlassIcon size={16} color={tertiary} weight="bold" />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="Search project or title"
          placeholderTextColor={placeholder}
          selectionColor={caret}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={{
            flex: 1,
            paddingVertical: 0,
            fontFamily: "Inter-Regular",
            fontSize: typography.body.fontSize,
            color: ink,
          }}
        />
        {has ? (
          <Pressable
            onPress={onClear}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <XCircleIcon size={17} color={subtle} weight="fill" />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function SessionRow({
  session,
  active,
  ink,
  subtle,
  tertiary,
  border,
  chip,
  accent,
  onPress,
}: {
  session: SessionSummary;
  active: boolean;
  ink: string;
  subtle: string;
  tertiary: string;
  border: string;
  chip: string;
  accent: string;
  onPress: () => void;
}) {
  const count = session.messageCount;
  const hasCount = typeof count === "number" && count > 0;
  const meta = hasCount
    ? `${formatSessionTime(session.lastModified)} · ${count} ${count === 1 ? "message" : "messages"}`
    : formatSessionTime(session.lastModified);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open session ${session.title}`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginHorizontal: 10,
        paddingHorizontal: 12,
        paddingVertical: 13,
        borderRadius: 12,
        backgroundColor: pressed ? chip : "transparent",
      })}
    >
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: active ? accent : border,
        }}
      />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Text
            variant="mono-inline"
            numberOfLines={1}
            style={{ color: subtle, flexShrink: 1 }}
          >
            {session.project}
          </Text>
          {session.gitBranch ? (
            <View
              style={{
                paddingHorizontal: 6,
                paddingVertical: 1,
                borderRadius: 5,
                backgroundColor: chip,
              }}
            >
              <Text
                variant="caption"
                numberOfLines={1}
                style={{ color: tertiary, fontFamily: "JetBrainsMono" }}
              >
                {session.gitBranch}
              </Text>
            </View>
          ) : null}
        </View>
        <Text
          variant="body-em"
          numberOfLines={1}
          style={{ color: ink, marginTop: 3 }}
        >
          {session.title || "Untitled session"}
        </Text>
        <Text variant="caption" style={{ color: tertiary, marginTop: 3 }}>
          {meta}
        </Text>
      </View>
    </Pressable>
  );
}

function Segmented({
  active,
  onNotes,
}: {
  active: "notes" | "sessions";
  onNotes: () => void;
}) {
  const { tokens } = useTheme();
  const chip = tokens["surface-chip"];
  const ink = tokens["text-primary"];
  const subtle = tokens["text-secondary"];
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: chip,
        borderRadius: 9,
        padding: 2,
      }}
    >
      <SegmentButton
        label="Notes"
        selected={active === "notes"}
        onPress={onNotes}
        ink={ink}
        subtle={subtle}
        selectedBg={tokens["surface-canvas"]}
      />
      <SegmentButton
        label="Sessions"
        selected={active === "sessions"}
        onPress={() => {}}
        ink={ink}
        subtle={subtle}
        selectedBg={tokens["surface-canvas"]}
      />
    </View>
  );
}

function SegmentButton({
  label,
  selected,
  onPress,
  ink,
  subtle,
  selectedBg,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  ink: string;
  subtle: string;
  selectedBg: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={{
        paddingHorizontal: 16,
        paddingVertical: 5,
        borderRadius: 7,
        backgroundColor: selected ? selectedBg : "transparent",
      }}
    >
      <Text
        variant="meta"
        style={{ color: selected ? ink : subtle }}
      >
        {label}
      </Text>
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
        paddingHorizontal: 24,
      }}
    >
      {children}
    </View>
  );
}
