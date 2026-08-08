/**
 * SCREEN: Sessions — every Claude Code session on the paired Mac, grouped by
 * project, newest first. Not just Wend notes: terminal sessions too, read from
 * ~/.claude/projects via the daemon's GET /sessions.
 *
 * Tapping a row opens the conversation view, where the user can resume and
 * continue (steer) that session. This is resume-and-continue, not live
 * mid-run injection — headless claude can't take a message into a running
 * turn — so the copy never implies otherwise.
 *
 * The list renders instantly from the SWR cache (useSessions) and refreshes
 * in the background. A slim search bar filters the cached list locally by
 * project + title as you type; searching suspends grouping and flattens to a
 * flat recency list with the project restored on each row's meta line.
 *
 * NativeWind gotcha: every Pressable here with a function `style` keeps
 * layout inline; className carries non-layout only.
 */
import { useDeferredValue, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  SectionList,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  CaretLeftIcon,
  GitBranchIcon,
  LaptopIcon,
  MagnifyingGlassIcon,
  TerminalWindowIcon,
  XCircleIcon,
} from "phosphor-react-native";

import { Text, Spinner } from "@/components/primitives";
import { HealthDot } from "@/components/HealthDot";
import { useTheme } from "@/theme/ThemeProvider";
import { typography } from "@/theme/tokens";
import { useSessions } from "@/lib/sessions/useSessions";
import { formatSessionTime, type SessionSummary } from "@/lib/sessions/api";
import {
  classifyBranch,
  groupByProject,
  resolveIdentity,
} from "@/lib/sessions/grouping";

const MONO = "JetBrainsMono";

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

  const sections = useMemo(() => groupByProject(sessions), [sessions]);

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

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={refresh}
      tintColor={subtle}
      colors={[accent]}
    />
  );

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
          accent={accent}
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
          <EmptyGlyph chip={chip} border={border} tertiary={tertiary}>
            <LaptopIcon size={30} color={tertiary} weight="light" />
          </EmptyGlyph>
          <Text
            variant="body-em"
            style={{ color: subtle, textAlign: "center", maxWidth: 280 }}
          >
            Pair your Mac to see its sessions
          </Text>
          <Text
            variant="caption"
            style={{
              color: tertiary,
              textAlign: "center",
              maxWidth: 260,
              marginTop: 8,
              lineHeight: 18,
            }}
          >
            Every Claude Code session on your Mac shows up here, ready to
            reopen.
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
          <EmptyGlyph chip={chip} border={border} tertiary={tertiary}>
            <TerminalWindowIcon size={28} color={tertiary} weight="light" />
          </EmptyGlyph>
          <Text
            variant="body-em"
            style={{ color: subtle, textAlign: "center", maxWidth: 280 }}
          >
            No sessions yet
          </Text>
          <Text
            variant="caption"
            style={{
              color: tertiary,
              textAlign: "center",
              maxWidth: 280,
              marginTop: 8,
              lineHeight: 18,
            }}
          >
            Run{" "}
            <Text
              variant="caption"
              style={{ fontFamily: MONO, color: tertiary }}
            >
              claude
            </Text>{" "}
            in a terminal, or Wend a note.
          </Text>
        </CenteredState>
      ) : searching && filtered.length === 0 ? (
        <CenteredState>
          <EmptyGlyph chip={chip} border={border} tertiary={tertiary}>
            <MagnifyingGlassIcon size={26} color={tertiary} weight="light" />
          </EmptyGlyph>
          <Text
            variant="body-em"
            style={{ color: subtle, textAlign: "center", maxWidth: 280 }}
          >
            No sessions match
          </Text>
          <Text
            variant="caption"
            style={{ color: tertiary, textAlign: "center", marginTop: 6 }}
          >
            Try a different project or title.
          </Text>
        </CenteredState>
      ) : searching ? (
        <FlatList
          data={filtered}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={refreshControl}
          renderItem={({ item }) => (
            <SessionRow
              session={item}
              searching
              ink={ink}
              subtle={subtle}
              tertiary={tertiary}
              chip={chip}
              border={border}
              accent={accent}
              onPress={() => openSession(item)}
            />
          )}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(s) => s.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={refreshControl}
          renderSectionHeader={({ section }) => (
            <SectionHeader
              project={section.project}
              first={section.index === 0}
              subtle={subtle}
            />
          )}
          renderItem={({ item }) => (
            <SessionRow
              session={item}
              searching={false}
              ink={ink}
              subtle={subtle}
              tertiary={tertiary}
              chip={chip}
              border={border}
              accent={accent}
              onPress={() => openSession(item)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function SectionHeader({
  project,
  first,
  subtle,
}: {
  project: string;
  first: boolean;
  subtle: string;
}) {
  return (
    <View
      accessibilityRole="header"
      accessibilityLabel={project}
      style={{
        paddingLeft: 20,
        paddingRight: 20,
        paddingTop: first ? 4 : 28,
        paddingBottom: 10,
      }}
    >
      <Text
        variant="mono-inline"
        numberOfLines={1}
        style={{ color: subtle, letterSpacing: -0.2 }}
      >
        {project}
      </Text>
    </View>
  );
}

function SessionRow({
  session,
  searching,
  ink,
  subtle,
  tertiary,
  chip,
  border,
  accent,
  onPress,
}: {
  session: SessionSummary;
  searching: boolean;
  ink: string;
  subtle: string;
  tertiary: string;
  chip: string;
  border: string;
  accent: string;
  onPress: () => void;
}) {
  const identity = resolveIdentity(session);
  const relativeTime = formatSessionTime(session.lastModified);
  const showBranch =
    !identity.isWend && classifyBranch(session.gitBranch) === "FEATURE";

  const a11yLabel = identity.isWend
    ? `Open Wend run ${identity.a11yTitle}, ${session.project}, ${relativeTime}`
    : `Open session ${identity.a11yTitle}, ${session.project}, ${relativeTime}`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "flex-start",
        paddingHorizontal: 20,
        paddingVertical: 12,
        backgroundColor: pressed ? chip : "transparent",
      })}
    >
      <View style={{ width: 16, alignItems: "flex-start" }}>
        {identity.isWend ? (
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              marginTop: 9,
              backgroundColor: accent,
            }}
          />
        ) : (
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 12,
              lineHeight: 16,
              marginTop: 5,
              color: tertiary,
            }}
          >
            {">_"}
          </Text>
        )}
      </View>

      <View
        style={{
          flex: 1,
          marginLeft: 12,
          flexDirection: "row",
          alignItems: "flex-start",
        }}
      >
        <View style={{ flex: 1 }}>
          {identity.isWend ? (
            <Text
              variant="body-em"
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{ color: subtle }}
            >
              <Text variant="body-em" style={{ color: subtle }}>
                Wend run
              </Text>
              {identity.wendTitle ? (
                <Text variant="body-em" style={{ color: tertiary }}>
                  {" · "}
                </Text>
              ) : null}
              {identity.wendTitle ? (
                <Text variant="body-em" style={{ color: ink }}>
                  {identity.wendTitle}
                </Text>
              ) : null}
            </Text>
          ) : (
            <Text
              variant="body-em"
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{ color: identity.untitled ? subtle : ink }}
            >
              {identity.untitled ? "Untitled session" : session.title}
            </Text>
          )}

          <Text
            numberOfLines={1}
            style={{
              fontFamily: "Inter-Medium",
              fontSize: 13,
              lineHeight: 16,
              color: tertiary,
              marginTop: 4,
            }}
          >
            {searching ? (
              <Text style={{ fontFamily: MONO, fontSize: 13, color: tertiary }}>
                {session.project}
              </Text>
            ) : null}
            {searching ? "  ·  " : null}
            {relativeTime}
          </Text>
        </View>

        {showBranch ? (
          <View
            style={{
              flexShrink: 0,
              maxWidth: 130,
              marginLeft: 10,
              marginTop: 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingLeft: 7,
              paddingRight: 8,
              paddingVertical: 3,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: border,
              backgroundColor: chip,
            }}
          >
            <GitBranchIcon size={12} color={subtle} weight="bold" />
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{
                fontFamily: MONO,
                fontSize: 11,
                lineHeight: 15,
                color: subtle,
                flexShrink: 1,
              }}
            >
              {session.gitBranch}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
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
  accent,
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
  accent: string;
  caret: string;
  placeholder: string;
}) {
  const [focused, setFocused] = useState(false);
  const has = value.length > 0;
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          height: 40,
          borderBottomWidth: 1,
          borderBottomColor: focused ? accent : border,
        }}
      >
        <MagnifyingGlassIcon
          size={18}
          color={focused ? accent : tertiary}
          weight="regular"
        />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
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
            <XCircleIcon size={18} color={subtle} weight="fill" />
          </Pressable>
        ) : null}
      </View>
    </View>
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
      <Text variant="meta" style={{ color: selected ? ink : subtle }}>
        {label}
      </Text>
    </Pressable>
  );
}

function EmptyGlyph({
  chip,
  border,
  children,
}: {
  chip: string;
  border: string;
  tertiary: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        width: 64,
        height: 64,
        borderRadius: 32,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: chip,
        borderWidth: 1,
        borderColor: border,
        marginBottom: 18,
      }}
    >
      {children}
    </View>
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
