/**
 * Wend — CommandPalette.
 *
 * Full-screen search overlay with three categories — Commands (slash
 * actions), Files (recent file paths from agent runs), and Notes (the user's
 * notes). Internal bottom filter tabs let the user narrow to one category.
 *
 * Visual integration: rendered above the editor as an absolutely positioned
 * sibling of the inbox/settings sheets. Mounted only while `open === true`
 * so the SlideInDown/FadeIn entry animations fire on every open cycle.
 *
 * NativeWind 4 gotcha — DO NOT put layout / sizing / backgroundColor inside
 * a Pressable function-style callback; cssInterop silently drops them.
 * Every interactive row here uses the wrapper-View pattern:
 *
 *   <Pressable style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
 *     <View style={{ flexDirection: ..., backgroundColor: ... }}>...</View>
 *   </Pressable>
 *
 * See `~/.claude/projects/.../memory/wend_nativewind_gotcha.md` and the
 * `InboxSheet` FAB / `SettingsSheet` Row for reference implementations.
 *
 * Phase 2 wiring:
 *   - Commands list is hardcoded. Selecting a command logs to console; real
 *     dispatch wiring lands when the daemon payload supports command prefixes.
 *   - Files are derived from the current note's PersistedRuns. Tap → no-op.
 *   - Notes are sourced from `useNotesList`. Tap closes the palette and
 *     calls `onSelectNote(id)` (the screen wires that to its inbox handler).
 */

import { useMemo, useRef, useState, useEffect } from "react";
import {
  Pressable,
  TextInput,
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  BackHandler,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  CodeIcon,
  FileTextIcon,
  FolderOpenIcon,
  LightningIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  RocketLaunchIcon,
  TerminalIcon,
  XIcon,
} from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import { useNotesList, type NoteListItem } from "@/lib/notes/useNotesList";
import {
  useRecentFilePaths,
  type RecentFilePath,
} from "@/lib/notes/useRecentFilePaths";
import type { PersistedRun } from "@/lib/notes-storage";

/* ─── Hardcoded commands (Phase 2) ─────────────────────────────────────── */

type CommandIconKind = "terminal" | "filetext" | "rocket";

interface PaletteCommand {
  /** Slash-prefixed name as the user types it. */
  name: string;
  description: string;
  icon: CommandIconKind;
}

const COMMANDS: PaletteCommand[] = [
  { name: "/fix", description: "Find and fix a bug in the codebase", icon: "terminal" },
  { name: "/summarize", description: "Summarize a thread, doc, or run", icon: "filetext" },
  { name: "/deploy", description: "Kick off a deploy to staging", icon: "rocket" },
  { name: "/explain", description: "Explain a file or symbol in plain English", icon: "filetext" },
  { name: "/test", description: "Generate or run tests", icon: "terminal" },
];

const SUGGESTION_CHIPS = ["redirect bug", "auth flow"];

type Filter = "all" | "commands" | "files" | "notes";

/* ─── Props ────────────────────────────────────────────────────────────── */

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSelectNote: (noteId: string) => void;
  /** PersistedRuns from the current note — used to derive recent file paths.
   *  Optional; when omitted (or empty) the Files section just shows nothing. */
  runs?: PersistedRun[];
}

export function CommandPalette(props: CommandPaletteProps): React.JSX.Element | null {
  if (!props.open) return null;
  return <CommandPaletteMounted {...props} />;
}

/* ─── Mounted child ────────────────────────────────────────────────────── */

function CommandPaletteMounted({
  onClose,
  onSelectNote,
  runs = [],
}: CommandPaletteProps) {
  const { tokens } = useTheme();
  const { notes } = useNotesList();
  const recentPaths = useRecentFilePaths(runs);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const inputRef = useRef<TextInput>(null);

  /* Auto-focus on mount. RN's autoFocus on overlays is unreliable on Android
     so we explicitly focus after the entry animation has settled. */
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 280);
    return () => clearTimeout(t);
  }, []);

  /* Hardware back closes the palette before the screen handles it. */
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  /* ─── Filtering ──────────────────────────────────────────────────────── */
  const q = query.trim().toLowerCase();
  const isSlashQuery = q.startsWith("/");
  const slashWord = isSlashQuery ? q.split(/\s+/)[0] ?? q : "";

  const filteredCommands = useMemo(() => {
    if (!q) return COMMANDS;
    if (isSlashQuery) {
      // Boost slash-name matches; fall back to substring across name+desc.
      const exact = COMMANDS.filter((c) =>
        c.name.toLowerCase().startsWith(slashWord),
      );
      if (exact.length) return exact;
    }
    return COMMANDS.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    );
  }, [q, isSlashQuery, slashWord]);

  const filteredPaths = useMemo(() => {
    if (!q) return recentPaths;
    return recentPaths.filter((p) => p.path.toLowerCase().includes(q));
  }, [q, recentPaths]);

  const filteredNotes = useMemo(() => {
    if (!q) return notes.slice(0, 10);
    return notes.filter((n) => {
      const hay = `${n.title} ${n.displayTitle}`.toLowerCase();
      return hay.includes(q);
    });
  }, [q, notes]);

  /* Active row — for the Execute hint on the best-match command. */
  const activeCommand = filteredCommands[0] ?? null;

  /* ─── Token aliases (Paper & Ember) ──────────────────────────────────── */
  const canvasBg = tokens["surface-canvas"];
  const elevatedBg = tokens["surface-elevated"];
  const inkColor = tokens["text-primary"];
  const subtleColor = tokens["text-secondary"];
  const tertiaryColor = tokens["text-tertiary"];
  const borderColor = tokens["border-hairline"];
  const accent = tokens["accent-default"];
  const accentOn = tokens["accent-on"];
  const chipBg = tokens["surface-chip"];
  // "primary-fixed/20" — soft 12% accent tint for active states.
  const accentSoftBg = `${accent}1F`;
  const accentSoftBorder = `${accent}33`;

  const showCommands = filter === "all" || filter === "commands";
  const showFiles = filter === "all" || filter === "files";
  const showNotes = filter === "all" || filter === "notes";

  const handleSelectCommand = (cmd: PaletteCommand) => {
    // Phase 2 stub. Real wiring lands when dispatch supports command prefixes.
    // eslint-disable-next-line no-console
    console.log("[wend] command selected", cmd.name);
  };

  const handleSelectFile = (p: RecentFilePath) => {
    // eslint-disable-next-line no-console
    console.log("[wend] file selected", p.path);
  };

  const handleSelectNote = (noteId: string) => {
    onClose();
    onSelectNote(noteId);
  };

  const handleSubmitEditing = () => {
    if (activeCommand && showCommands) {
      handleSelectCommand(activeCommand);
      return;
    }
    if (filteredNotes.length > 0 && showNotes) {
      handleSelectNote(filteredNotes[0]!.id);
    }
  };

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 55,
      }}
    >
      {/* Backdrop — fades in/out; tap-outside closes. */}
      <Animated.View
        entering={FadeIn.duration(220)}
        exiting={FadeOut.duration(180)}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.32)",
        }}
      >
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close search"
          style={{ flex: 1 }}
        />
      </Animated.View>

      {/* Panel — slides up from the bottom, full-height overlay. */}
      <Animated.View
        entering={SlideInDown.duration(260)}
        exiting={SlideOutDown.duration(220)}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: canvasBg,
        }}
      >
        <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ flex: 1 }}
          >
            {/* ── Search input row ───────────────────────────────────── */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: borderColor,
                gap: 12,
              }}
            >
              <MagnifyingGlassIcon size={20} color={subtleColor} weight="regular" />
              <TextInput
                ref={inputRef}
                value={query}
                onChangeText={setQuery}
                placeholder="Search commands, files, notes..."
                placeholderTextColor={tokens["text-placeholder"]}
                selectionColor={tokens["accent-caret"]}
                autoCorrect={false}
                autoCapitalize="none"
                spellCheck={false}
                returnKeyType="go"
                onSubmitEditing={handleSubmitEditing}
                style={{
                  flex: 1,
                  fontFamily: "Inter-Regular",
                  fontSize: 17,
                  lineHeight: 22,
                  color: inkColor,
                  padding: 0,
                  margin: 0,
                }}
              />
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close search"
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: chipBg,
                  }}
                >
                  <XIcon size={16} color={subtleColor} weight="bold" />
                </View>
              </Pressable>
            </View>

            {/* ── Suggestion chips ───────────────────────────────────── */}
            <View
              style={{
                paddingHorizontal: 16,
                paddingTop: 12,
                paddingBottom: 8,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <Text variant="meta" style={{ color: tertiaryColor }}>
                Suggestions:
              </Text>
              {SUGGESTION_CHIPS.map((s) => (
                <SuggestionChip
                  key={s}
                  label={s}
                  onPress={() => setQuery(s)}
                  bg={chipBg}
                  border={borderColor}
                  color={subtleColor}
                />
              ))}
            </View>

            {/* ── Results ────────────────────────────────────────────── */}
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {showCommands && filteredCommands.length > 0 ? (
                <View>
                  <SectionHeader
                    label="Commands"
                    icon={<LightningIcon size={14} color={accent} weight="fill" />}
                    color={accent}
                    bg={accentSoftBg}
                  />
                  {filteredCommands.map((cmd, i) => (
                    <CommandRow
                      key={cmd.name}
                      cmd={cmd}
                      active={i === 0 && !!q}
                      onPress={() => handleSelectCommand(cmd)}
                      bg={elevatedBg}
                      activeBg={accentSoftBg}
                      activeBorder={accentSoftBorder}
                      ink={inkColor}
                      subtle={subtleColor}
                      tertiary={tertiaryColor}
                      accent={accent}
                      accentOn={accentOn}
                      chipBg={chipBg}
                    />
                  ))}
                </View>
              ) : null}

              {showFiles && filteredPaths.length > 0 ? (
                <View>
                  <SectionHeader
                    label="Files"
                    icon={
                      <FolderOpenIcon
                        size={14}
                        color={subtleColor}
                        weight="regular"
                      />
                    }
                    color={subtleColor}
                    bg="transparent"
                  />
                  {filteredPaths.map((p) => (
                    <FileRow
                      key={p.path}
                      path={p}
                      onPress={() => handleSelectFile(p)}
                      ink={inkColor}
                      subtle={subtleColor}
                      tertiary={tertiaryColor}
                      chipBg={chipBg}
                    />
                  ))}
                </View>
              ) : null}

              {showNotes && filteredNotes.length > 0 ? (
                <View>
                  <SectionHeader
                    label="Notes"
                    icon={
                      <PencilSimpleIcon
                        size={14}
                        color={subtleColor}
                        weight="regular"
                      />
                    }
                    color={subtleColor}
                    bg="transparent"
                  />
                  {filteredNotes.map((n) => (
                    <NoteRow
                      key={n.id}
                      note={n}
                      onPress={() => handleSelectNote(n.id)}
                      ink={inkColor}
                      subtle={subtleColor}
                      tertiary={tertiaryColor}
                      chipBg={chipBg}
                    />
                  ))}
                </View>
              ) : null}

              {/* Empty state — nothing matched in any visible section. */}
              {(!showCommands || filteredCommands.length === 0) &&
              (!showFiles || filteredPaths.length === 0) &&
              (!showNotes || filteredNotes.length === 0) ? (
                <View
                  style={{
                    paddingVertical: 64,
                    paddingHorizontal: 24,
                    alignItems: "center",
                  }}
                >
                  <Text
                    variant="meta"
                    style={{ color: subtleColor, textAlign: "center" }}
                  >
                    No matches. Try a different query.
                  </Text>
                </View>
              ) : null}
            </ScrollView>

            {/* ── Bottom filter tabs ─────────────────────────────────── */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-around",
                paddingHorizontal: 16,
                paddingTop: 8,
                paddingBottom: 8,
                borderTopWidth: 1,
                borderTopColor: borderColor,
                gap: 8,
              }}
            >
              {(["all", "commands", "files", "notes"] as Filter[]).map((f) => (
                <FilterTab
                  key={f}
                  label={tabLabel(f)}
                  active={filter === f}
                  onPress={() => setFilter(f)}
                  activeBg={accentSoftBg}
                  activeBorder={accent}
                  activeColor={accent}
                  inactiveBorder={borderColor}
                  inactiveColor={subtleColor}
                />
              ))}
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Animated.View>
    </View>
  );
}

/* ─── Subcomponents ────────────────────────────────────────────────────── */

function tabLabel(f: Filter): string {
  if (f === "all") return "All";
  if (f === "commands") return "Commands";
  if (f === "files") return "Files";
  return "Notes";
}

function SectionHeader(props: {
  label: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 6,
        backgroundColor: props.bg,
      }}
    >
      {props.icon}
      <Text
        variant="caption"
        style={{
          color: props.color,
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}

function SuggestionChip(props: {
  label: string;
  onPress: () => void;
  bg: string;
  border: string;
  color: string;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={`Use suggestion ${props.label}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <View
        style={{
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: props.border,
          backgroundColor: props.bg,
        }}
      >
        <Text variant="meta" style={{ color: props.color }}>
          {props.label}
        </Text>
      </View>
    </Pressable>
  );
}

function CommandIcon({
  kind,
  size,
  color,
}: {
  kind: CommandIconKind;
  size: number;
  color: string;
}) {
  if (kind === "filetext")
    return <FileTextIcon size={size} color={color} weight="regular" />;
  if (kind === "rocket")
    return <RocketLaunchIcon size={size} color={color} weight="regular" />;
  return <TerminalIcon size={size} color={color} weight="regular" />;
}

function CommandRow(props: {
  cmd: PaletteCommand;
  active: boolean;
  onPress: () => void;
  bg: string;
  activeBg: string;
  activeBorder: string;
  ink: string;
  subtle: string;
  tertiary: string;
  accent: string;
  accentOn: string;
  chipBg: string;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={`Run ${props.cmd.name}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 12,
          marginHorizontal: 12,
          marginVertical: 2,
          borderRadius: 12,
          backgroundColor: props.active ? props.activeBg : "transparent",
          borderWidth: 1,
          borderColor: props.active ? props.activeBorder : "transparent",
          gap: 12,
        }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: props.chipBg,
          }}
        >
          <CommandIcon kind={props.cmd.icon} size={16} color={props.subtle} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            variant="mono-inline"
            style={{ color: props.ink }}
            numberOfLines={1}
          >
            {props.cmd.name}
          </Text>
          <Text
            variant="caption"
            style={{ color: props.subtle, marginTop: 2 }}
            numberOfLines={1}
          >
            {props.cmd.description}
          </Text>
        </View>
        {props.active ? (
          <Text variant="caption" style={{ color: props.accent }}>
            Execute ↵
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function FileRow(props: {
  path: RecentFilePath;
  onPress: () => void;
  ink: string;
  subtle: string;
  tertiary: string;
  chipBg: string;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${props.path.path}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 10,
          marginHorizontal: 12,
          gap: 12,
        }}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: props.chipBg,
          }}
        >
          <CodeIcon size={14} color={props.subtle} weight="regular" />
        </View>
        <Text
          variant="mono-inline"
          style={{ color: props.ink, flex: 1 }}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {props.path.path}
        </Text>
        <Text variant="caption" style={{ color: props.tertiary }}>
          {formatRelative(props.path.mentionedAt)}
        </Text>
      </View>
    </Pressable>
  );
}

function NoteRow(props: {
  note: NoteListItem;
  onPress: () => void;
  ink: string;
  subtle: string;
  tertiary: string;
  chipBg: string;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open note ${props.note.displayTitle}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 10,
          marginHorizontal: 12,
          gap: 12,
        }}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: props.chipBg,
          }}
        >
          <PencilSimpleIcon size={14} color={props.subtle} weight="regular" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            variant="body-em"
            style={{ color: props.ink }}
            numberOfLines={1}
          >
            {props.note.displayTitle || "Untitled"}
          </Text>
          <Text
            variant="caption"
            style={{ color: props.subtle, marginTop: 2 }}
            numberOfLines={1}
          >
            {props.note.bodyLineCount > 0
              ? `${props.note.bodyLineCount} ${props.note.bodyLineCount === 1 ? "line" : "lines"} · ${formatRelative(props.note.updatedAt)}`
              : formatRelative(props.note.updatedAt)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function FilterTab(props: {
  label: string;
  active: boolean;
  onPress: () => void;
  activeBg: string;
  activeBorder: string;
  activeColor: string;
  inactiveBorder: string;
  inactiveColor: string;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: props.active }}
      style={({ pressed }) => ({
        flex: 1,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          paddingVertical: 8,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: props.active ? props.activeBorder : props.inactiveBorder,
          backgroundColor: props.active ? props.activeBg : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text
          variant="meta"
          style={{
            color: props.active ? props.activeColor : props.inactiveColor,
          }}
        >
          {props.label}
        </Text>
      </View>
    </Pressable>
  );
}

/* ─── Formatters ───────────────────────────────────────────────────────── */

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}
