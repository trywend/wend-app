/**
 * Wend — InboxSheet.
 *
 * Pull-down sheet that lists all of the current user's notes. The sheet is
 * controlled (open/onClose from the parent). Internally:
 *
 *   - Enter/exit are driven by reanimated's SlideInDown / SlideOutDown on the
 *     sheet panel and FadeIn / FadeOut on the dim backdrop. When `open` is
 *     false we return `null` AFTER the exit animation completes — done by
 *     keying off `open` and letting the layout animations run their course.
 *     React-native-reanimated's exiting animation only fires when the
 *     component actually unmounts, so we mount only while `open === true`.
 *
 *   - Drag-to-dismiss: a Pan gesture on the drag-handle row tracks
 *     translateY; passing 80px down OR a positive velocity above 600 px/s
 *     calls onClose(). While dragging, the panel follows the finger and the
 *     backdrop opacity scales down with the drag distance. On release-without-
 *     dismiss it springs back to 0.
 *
 *   - Tap-outside: the backdrop is a full-screen Pressable above the dim layer
 *     with onPress={onClose}.
 *
 * NativeWind pitfall (CRITICAL): NativeWind 4 silently drops layout utilities
 * from `className` when `style` is a function callback. Every Pressable in
 * here uses inline-style for layout/sizing/positioning. className is reserved
 * for static color-ish things (or omitted entirely).
 *
 * "Running" state: the underlying storage only persists completed runs, so
 * useNotesList() currently never reports status === "running". The icon +
 * accent branch is still wired below so the screen-level integration can
 * inject an override later without me touching this file again.
 */

import { useMemo, useState } from "react";
import { Pressable, View, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Gesture,
  GestureDetector,
} from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  Extrapolation,
} from "react-native-reanimated";
import {
  CheckCircleIcon,
  CircleNotchIcon,
  GearIcon,
  NotePencilIcon,
  PlusIcon,
} from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import { useNotesList, type NoteListItem } from "@/lib/notes/useNotesList";

const SPRING = { stiffness: 280, damping: 30, mass: 0.9 } as const;

// Drag thresholds — keep generous so an accidental swipe-up while scrolling
// the list doesn't close. The list itself owns vertical scrolling; the pan
// gesture is scoped to the drag-handle area so it never competes.
const DRAG_DISMISS_PX = 80;
const DRAG_DISMISS_VELOCITY = 600;

type Filter = "all" | "running" | "done" | "notes";

export interface InboxSheetProps {
  open: boolean;
  onClose: () => void;
  onSelectNote: (noteId: string) => void;
  onNewNote: () => void;
  onOpenSettings?: () => void;
}

export function InboxSheet(props: InboxSheetProps): React.JSX.Element | null {
  const { open, onClose, onSelectNote, onNewNote, onOpenSettings } = props;

  if (!open) return null;
  return <InboxSheetMounted {...props} />;
}

/**
 * Split into a mounted child so the enter/exit animations fire on every
 * open/close cycle (a mounted-and-toggled approach would only fire entering
 * once for the lifetime of the parent).
 */
function InboxSheetMounted({
  onClose,
  onSelectNote,
  onNewNote,
  onOpenSettings,
}: InboxSheetProps) {
  const { tokens } = useTheme();
  const { notes, isLoading } = useNotesList();
  const [filter, setFilter] = useState<Filter>("all");

  // ------------------------------------------------------------------
  // Drag-to-dismiss state — shared values driven by Pan on the handle.
  // ------------------------------------------------------------------
  const dragY = useSharedValue(0);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      dragY.value,
      [0, 300],
      [1, 0.2],
      Extrapolation.CLAMP,
    ),
  }));

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      // Only follow positive (downward) drag — upward drag is a no-op so the
      // sheet doesn't lift past its resting position.
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      const past =
        e.translationY > DRAG_DISMISS_PX || e.velocityY > DRAG_DISMISS_VELOCITY;
      if (past) {
        dragY.value = withTiming(0, { duration: 0 });
        runOnJS(onClose)();
      } else {
        dragY.value = withSpring(0, SPRING);
      }
    });

  // ------------------------------------------------------------------
  // Filtering
  // ------------------------------------------------------------------
  const visibleNotes = useMemo(() => {
    if (filter === "all") return notes;
    return notes.filter((n) => n.status === filter);
  }, [notes, filter]);

  // ------------------------------------------------------------------
  // Color resolutions (tokens map; see file header in src/theme/tokens.ts)
  //   surface-container-lowest → surface-canvas
  //   surface-container-low    → surface-elevated  (card body)
  //   outline-variant          → border-hairline
  //   on-surface               → text-primary
  //   on-surface-variant       → text-secondary
  //   outline                  → text-tertiary
  //   primary                  → accent-default
  // ------------------------------------------------------------------
  const canvasBg = tokens["surface-canvas"];
  const cardBg = tokens["surface-elevated"];
  const inkColor = tokens["text-primary"];
  const subtleColor = tokens["text-secondary"];
  const tertiaryColor = tokens["text-tertiary"];
  const borderColor = tokens["border-hairline"];
  const accent = tokens["accent-default"];
  const accentOn = tokens["accent-on"];
  const chipBg = tokens["surface-chip"];
  const statusDoneColor = tokens["status-done"];
  const statusFailedColor = tokens["status-failed"];

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
      }}
      pointerEvents="box-none"
    >
      {/* Dim backdrop. Fades in/out; tap to close. */}
      <Animated.View
        entering={FadeIn.duration(220)}
        exiting={FadeOut.duration(180)}
        style={[
          {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.22)",
          },
          backdropStyle,
        ]}
      >
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close inbox"
          style={{ flex: 1 }}
        />
      </Animated.View>

      {/* Sheet panel — 88% height, rounded top corners, slides up. */}
      <Animated.View
        entering={SlideInDown.springify().damping(18).mass(0.9)}
        exiting={SlideOutDown.duration(220)}
        style={[
          {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: "88%",
            backgroundColor: canvasBg,
            borderTopLeftRadius: 32,
            borderTopRightRadius: 32,
            borderWidth: 1,
            borderColor: borderColor,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: -8 },
            shadowOpacity: 0.08,
            shadowRadius: 32,
            elevation: 12,
            overflow: "hidden",
          },
          panelStyle,
        ]}
      >
        {/* Drag handle row — only this area is the pan-gesture surface. The
            list scrolls independently below. */}
        <GestureDetector gesture={pan}>
          <View>
            <View
              style={{
                width: "100%",
                paddingTop: 12,
                paddingBottom: 8,
                alignItems: "center",
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 999,
                  backgroundColor: tertiaryColor,
                }}
              />
            </View>

            {/* Sheet header — "Inbox" + settings cog. */}
            <View
              style={{
                paddingHorizontal: 24,
                paddingVertical: 8,
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text
                variant="title"
                style={{ color: inkColor }}
              >
                Inbox
              </Text>
              <Pressable
                onPress={onOpenSettings ?? (() => {})}
                accessibilityRole="button"
                accessibilityLabel="Open settings"
                hitSlop={8}
                style={({ pressed }) => ({
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <GearIcon size={20} color={subtleColor} weight="regular" />
              </Pressable>
            </View>
          </View>
        </GestureDetector>

        {/* Filter chips. Horizontal scroll; bottom hairline divider. */}
        <View
          style={{
            paddingHorizontal: 24,
            paddingTop: 8,
            paddingBottom: 16,
            borderBottomWidth: 1,
            borderBottomColor: borderColor,
          }}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            <FilterChip
              label="All"
              active={filter === "all"}
              onPress={() => setFilter("all")}
              activeBg={chipBg}
              activeBorder={accent}
              activeColor={accent}
              inactiveBorder={borderColor}
              inactiveColor={subtleColor}
            />
            <FilterChip
              label="Running"
              active={filter === "running"}
              onPress={() => setFilter("running")}
              activeBg={chipBg}
              activeBorder={accent}
              activeColor={accent}
              inactiveBorder={borderColor}
              inactiveColor={subtleColor}
            />
            <FilterChip
              label="Done"
              active={filter === "done"}
              onPress={() => setFilter("done")}
              activeBg={chipBg}
              activeBorder={accent}
              activeColor={accent}
              inactiveBorder={borderColor}
              inactiveColor={subtleColor}
            />
            <FilterChip
              label="Notes"
              active={filter === "notes"}
              onPress={() => setFilter("notes")}
              activeBg={chipBg}
              activeBorder={accent}
              activeColor={accent}
              inactiveBorder={borderColor}
              inactiveColor={subtleColor}
            />
          </ScrollView>
        </View>

        {/* List body. */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingTop: 16,
            paddingBottom: 120, // clear room for the FAB
            gap: 16,
          }}
          showsVerticalScrollIndicator={false}
        >
          {isLoading ? (
            <View style={{ paddingVertical: 48, alignItems: "center" }}>
              <ActivityIndicator color={subtleColor} />
            </View>
          ) : visibleNotes.length === 0 ? (
            <EmptyState filter={filter} subtleColor={subtleColor} />
          ) : (
            visibleNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                onPress={() => onSelectNote(note.id)}
                tokens={{
                  cardBg,
                  inkColor,
                  subtleColor,
                  tertiaryColor,
                  borderColor,
                  accent,
                  statusDoneColor,
                  statusFailedColor,
                }}
              />
            ))
          )}
        </ScrollView>
      </Animated.View>

      {/* FAB — pinned to the lower-right, floats over the sheet. */}
      <SafeAreaView
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
        }}
      >
        <View
          pointerEvents="box-none"
          style={{
            alignItems: "flex-end",
            paddingRight: 24,
            paddingBottom: 24,
          }}
        >
          <Pressable
            onPress={onNewNote}
            accessibilityRole="button"
            accessibilityLabel="New note"
            style={({ pressed }) => ({
              width: 56,
              height: 56,
              borderRadius: 16,
              backgroundColor: accent,
              alignItems: "center",
              justifyContent: "center",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.18,
              shadowRadius: 12,
              elevation: 8,
              transform: [{ scale: pressed ? 0.94 : 1 }],
            })}
          >
            <PlusIcon size={26} color={accentOn} weight="bold" />
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

/* ---------------------------------------------------------------------------
   Filter chip
   --------------------------------------------------------------------------- */

interface FilterChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
  activeBg: string;
  activeBorder: string;
  activeColor: string;
  inactiveBorder: string;
  inactiveColor: string;
}

function FilterChip(props: FilterChipProps) {
  const {
    label,
    active,
    onPress,
    activeBg,
    activeBorder,
    activeColor,
    inactiveBorder,
    inactiveColor,
  } = props;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => ({
        paddingHorizontal: 16,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? activeBorder : inactiveBorder,
        backgroundColor: active ? activeBg : "transparent",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        variant="meta"
        style={{
          color: active ? activeColor : inactiveColor,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* ---------------------------------------------------------------------------
   Note card
   --------------------------------------------------------------------------- */

interface NoteCardTokens {
  cardBg: string;
  inkColor: string;
  subtleColor: string;
  tertiaryColor: string;
  borderColor: string;
  accent: string;
  statusDoneColor: string;
  statusFailedColor: string;
}

function NoteCard({
  note,
  onPress,
  tokens,
}: {
  note: NoteListItem;
  onPress: () => void;
  tokens: NoteCardTokens;
}) {
  const failed = note.lastRun?.error != null;
  const leftBorderColor =
    note.status === "running"
      ? tokens.accent
      : failed
        ? tokens.statusFailedColor
        : note.status === "done"
          ? tokens.borderColor
          : tokens.borderColor;

  const titleText =
    note.title.trim().length > 0 ? note.title : "Untitled note";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        backgroundColor: tokens.cardBg,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: tokens.borderColor,
        borderLeftWidth: 4,
        borderLeftColor: leftBorderColor,
        padding: 20,
        flexDirection: "column",
        gap: 8,
        opacity: pressed ? 0.85 : 1,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        {/* Status icon. */}
        <View style={{ width: 20, paddingTop: 2 }}>
          {note.status === "running" ? (
            <CircleNotchIcon size={20} color={tokens.accent} weight="bold" />
          ) : note.status === "done" ? (
            <CheckCircleIcon
              size={20}
              color={failed ? tokens.statusFailedColor : tokens.subtleColor}
              weight="fill"
            />
          ) : (
            <NotePencilIcon
              size={20}
              color={tokens.tertiaryColor}
              weight="regular"
            />
          )}
        </View>

        <View style={{ flex: 1 }}>
          <Text
            variant="body-em"
            numberOfLines={1}
            style={{ color: tokens.inkColor }}
          >
            {titleText}
          </Text>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              marginTop: 6,
              flexWrap: "wrap",
            }}
          >
            {note.status === "notes" ? (
              <>
                <Text variant="meta" style={{ color: tokens.subtleColor }}>
                  {formatRelativeTime(note.updatedAt)}
                </Text>
                {note.bodyLineCount > 0 ? (
                  <>
                    <Dot color={tokens.tertiaryColor} />
                    <Text
                      variant="meta"
                      style={{ color: tokens.subtleColor }}
                    >
                      {note.bodyLineCount} {note.bodyLineCount === 1 ? "line" : "lines"}
                    </Text>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <Text variant="meta" style={{ color: tokens.subtleColor }}>
                  Claude
                </Text>
                <Dot color={tokens.tertiaryColor} />
                <Text variant="meta" style={{ color: tokens.subtleColor }}>
                  Mac
                </Text>
                {note.lastRun ? (
                  <>
                    <Dot color={tokens.tertiaryColor} />
                    <Text
                      variant="mono-inline"
                      style={{
                        color:
                          note.status === "running"
                            ? tokens.accent
                            : failed
                              ? tokens.statusFailedColor
                              : tokens.subtleColor,
                      }}
                    >
                      {formatDuration(note.lastRun.durationMs)}
                    </Text>
                  </>
                ) : null}
              </>
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <View
      style={{
        width: 3,
        height: 3,
        borderRadius: 999,
        backgroundColor: color,
        opacity: 0.6,
      }}
    />
  );
}

/* ---------------------------------------------------------------------------
   Empty state
   --------------------------------------------------------------------------- */

function EmptyState({
  filter,
  subtleColor,
}: {
  filter: Filter;
  subtleColor: string;
}) {
  const label =
    filter === "all"
      ? "No notes yet — tap the + button to start one."
      : filter === "running"
        ? "Nothing running."
        : filter === "done"
          ? "No completed runs yet."
          : "No plain notes.";
  return (
    <View style={{ paddingVertical: 56, alignItems: "center" }}>
      <Text
        variant="meta"
        style={{ color: subtleColor, textAlign: "center" }}
      >
        {label}
      </Text>
    </View>
  );
}

/* ---------------------------------------------------------------------------
   Formatters
   --------------------------------------------------------------------------- */

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec === 0 ? `${min}m` : `${min}m ${sec}s`;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "Just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "Yesterday";
  if (day < 7) return `${day}d ago`;
  const date = new Date(ts);
  return date.toLocaleDateString();
}
