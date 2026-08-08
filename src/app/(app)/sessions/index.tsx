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
 * NativeWind gotcha: every Pressable here with a function `style` keeps
 * layout inline; className carries non-layout only.
 */
import { useRouter } from "expo-router";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CaretLeftIcon, CircleNotchIcon } from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { HealthDot } from "@/components/HealthDot";
import { useTheme } from "@/theme/ThemeProvider";
import { useSessions } from "@/lib/sessions/useSessions";
import { formatSessionTime, type SessionSummary } from "@/lib/sessions/api";

export default function SessionsScreen() {
  const { tokens } = useTheme();
  const router = useRouter();
  const { sessions, status, error, refreshing, refresh } = useSessions();

  const canvas = tokens["surface-canvas"];
  const ink = tokens["text-primary"];
  const subtle = tokens["text-secondary"];
  const border = tokens["border-hairline"];

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
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          >
            <CaretLeftIcon size={22} color={subtle} weight="regular" />
          </Pressable>
        </View>
        <Segmented active="sessions" onNotes={goNotes} />
        <View style={{ width: 40, alignItems: "flex-end", paddingRight: 6 }}>
          <HealthDot size={8} />
        </View>
      </View>

      {status === "loading" ? (
        <CenteredState>
          <CircleNotchIcon size={22} color={subtle} weight="bold" />
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
          <Pressable onPress={refresh} style={{ marginTop: 14 }}>
            <Text variant="meta" style={{ color: tokens["accent-default"] }}>
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
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingVertical: 4 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={subtle}
              colors={[tokens["accent-default"]]}
            />
          }
          renderItem={({ item, index }) => (
            <SessionRow
              session={item}
              active={index === 0}
              ink={ink}
              subtle={subtle}
              border={border}
              accent={tokens["accent-default"]}
              onPress={() => openSession(item)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function SessionRow({
  session,
  active,
  ink,
  subtle,
  border,
  accent,
  onPress,
}: {
  session: SessionSummary;
  active: boolean;
  ink: string;
  subtle: string;
  border: string;
  accent: string;
  onPress: () => void;
}) {
  const meta = `${formatSessionTime(session.lastModified)} · ${session.messageCount} ${
    session.messageCount === 1 ? "message" : "messages"
  }`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open session ${session.title}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 18,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: border,
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: active ? accent : "transparent",
        }}
      />
      <View style={{ flex: 1 }}>
        <Text
          variant="mono-inline"
          numberOfLines={1}
          style={{ color: subtle }}
        >
          {session.project}
          {session.gitBranch ? `  ${session.gitBranch}` : ""}
        </Text>
        <Text
          variant="body-em"
          numberOfLines={1}
          style={{ color: ink, marginTop: 2 }}
        >
          {session.title || "Untitled session"}
        </Text>
        <Text variant="caption" style={{ color: subtle, marginTop: 3 }}>
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
