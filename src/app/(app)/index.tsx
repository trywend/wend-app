/**
 * SCREEN: S1 (blank) → S2 (composing) — the multi-block editor.
 *
 * Editor model:
 *
 *   [ Title — single TextInput, always editable ]
 *   [ Body  — multiline TextInput, always editable ]
 *   [ AgentRun 1 — readonly visual (S3) ]
 *   [ FollowUp 1 — multiline TextInput, always editable ]
 *   [ AgentRun 2 — readonly visual (S3) ]
 *   [ FollowUp 2 — multiline TextInput ]
 *   …
 *
 * Send logic:
 *   - First send (runs.length === 0): prompt = body.trim(), no sessionId.
 *   - Subsequent: prompt = runs[last].followUp.trim(), sessionId resumes.
 *
 * On stream completion we APPEND a PersistedRun to runs[] (response text
 * lives there — body is never auto-committed). A new empty FollowUp
 * TextInput shows up below the run.
 *
 * Persistence: `useNoteEditor` resolves the current draft on mount,
 * exposes `runs`, `appendRun`, `updateRunFollowUp`, and debounces saves
 * (title / body / runs / follow-ups) to AsyncStorage on every keystroke.
 *
 * NativeWind gotcha (non-negotiable): layout/sizing/positioning utilities
 * are silently dropped on Pressable when `style` is a function callback.
 * Every Pressable in this file uses inline `style` for layout — className
 * only for static, non-layout properties.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated as RNAnimated,
  Easing,
  Image as RNImage,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ArrowUpIcon,
  CheckIcon,
  DotsThreeVerticalIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  PaperclipIcon,
  StopIcon,
  TextHOneIcon,
  TrayIcon,
  XIcon,
} from "phosphor-react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { typography } from "@/theme/tokens";
import { useNoteEditor } from "@/lib/notes/useNoteEditor";
import { useNotesList } from "@/lib/notes/useNotesList";
import { useDispatch, type DispatchEvent } from "@/lib/dispatch/useDispatch";
import {
  archiveNote,
  createNote,
  deleteNote,
  getNote,
  saveNote,
  type PersistedRun,
} from "@/lib/notes-storage";
import {
  classifyAttachment,
  removeAttachmentFile,
  type Attachment,
} from "@/lib/attachments";
import { useAuthStore } from "@/store/authSlice";
import { useDaemonStore } from "@/store/daemonSlice";
import { useOnboardingStore } from "@/store/onboardingSlice";
import { useSignOut } from "@/auth/client";
import { Text } from "@/components/primitives";
import { CommandPalette } from "@/components/CommandPalette";
import { InboxSheet } from "@/components/InboxSheet";
import { SettingsSheet } from "@/components/SettingsSheet";
import { IntegrationsSheet } from "@/components/IntegrationsSheet";
import { ConnectGitHubSheet } from "@/components/ConnectGitHubSheet";
import { ConnectMacSheet } from "@/components/ConnectMacSheet";
import { NoteActionsSheet } from "@/components/NoteActionsSheet";
import { AttachmentPicker } from "@/components/AttachmentPicker";
import { FileViewerModal } from "@/components/FileViewerModal";
import { HealthDot } from "@/components/HealthDot";
import {
  AgentRunBlock,
  type AgentRunBlockState,
} from "@/components/editor/AgentRunBlock";
import {
  FirstNoteCoachmark,
  FIRST_NOTE_COACHMARK_KEY,
} from "@/components/editor/FirstNoteCoachmark";
import * as Crypto from "expo-crypto";

const TOP_BAR_HEIGHT = 48;
const TOOLBAR_HEIGHT = 52;

interface InflightRun {
  prompt: string;
  response: string;
  toolUses: string[];
  toolCalls: Array<{ name: string; input?: unknown }>;
  sessionId: string | null;
  durationMs: number;
  costUsd: number;
  status: "running" | "done" | "error";
  error: string | null;
  /** Smart routing — the project the daemon resolved this run into. Populated
   *  by the first `route` event from the SSE stream. */
  routeName: string | null;
  routeCwd: string | null;
  routeSource: "auto" | "pinned" | "fallback" | null;
}

const INITIAL_INFLIGHT: InflightRun | null = null;

export default function HomeScreen() {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  // currentNoteId switches which note the editor shows. `undefined` means
  // "load the most recent draft" (loadOrCreateDraftNote). Tapping a card in
  // the inbox sets this; the FAB creates a new note and sets it here.
  const [currentNoteId, setCurrentNoteId] = useState<string | undefined>(
    undefined,
  );
  const {
    title,
    body,
    runs,
    cwd: noteCwd,
    setTitle,
    setBody,
    setCwd,
    appendRun,
    updateRunFollowUp,
    noteId: resolvedNoteId,
  } = useNoteEditor(currentNoteId);
  const { refresh: refreshNotes } = useNotesList();
  const userId = useAuthStore((s) => s.user?.id);
  const [bodyFocused, setBodyFocused] = useState(true);
  const [chipDismissed, setChipDismissed] = useState(false);
  const [inflight, setInflight] = useState<InflightRun | null>(INITIAL_INFLIGHT);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [connectGitHubOpen, setConnectGitHubOpen] = useState(false);
  const [connectMacOpen, setConnectMacOpen] = useState(false);
  const [noteActions, setNoteActions] = useState<{
    id: string;
    title: string;
  } | null>(null);
  // Attachment composer state. We don't go through useNoteEditor for this —
  // that hook is owned by a parallel agent and its setter shape would have
  // to grow. Attachments are loaded directly via getNote when the current
  // note resolves; mutations call saveNote({attachments}) and update local
  // state. Volume is tiny (a few entries per note) so the extra round-trip
  // through AsyncStorage is fine.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  const [fileViewer, setFileViewer] = useState<{
    open: boolean;
    path: string;
    mimeType?: string;
    name?: string;
    sizeBytes?: number;
  }>({ open: false, path: "" });
  const signOut = useSignOut();
  const [coachmarkVisible, setCoachmarkVisible] = useState(false);
  const { dispatch, running, cancel, isConfigured: daemonConfigured } =
    useDispatch();

  const bodyRef = useRef<TextInput>(null);
  const followUpRefs = useRef<Record<number, TextInput | null>>({});
  const scrollRef = useRef<ScrollView>(null);

  const lastRunIdx = runs.length - 1;
  const hasRuns = runs.length > 0;
  const isFirstSend = !hasRuns;
  const lastFollowUp = hasRuns ? runs[lastRunIdx]!.followUp : "";

  const isBodyEmpty = body.length === 0;
  const isTitleEmpty = title.length === 0;
  const noUserInputYet =
    isBodyEmpty && isTitleEmpty && !hasRuns && !inflight;
  const hasContent = !noUserInputYet;

  // Scroll-reveal for the top bar on the blank canvas. The bar normally only
  // shows once the note has content, so a fresh note opens with a quiet
  // header-less surface. Pulling the scroll view down past PULL_REVEAL_PX
  // (iOS overscroll bounce, or Android drag against an empty content area)
  // brings the bar in temporarily — gives the user a way to reach Inbox /
  // Search / ⋮ without first having to type something.
  const [scrollOffsetY, setScrollOffsetY] = useState(0);
  const PULL_REVEAL_PX = 28;
  const showTopBarFromScroll = scrollOffsetY <= -PULL_REVEAL_PX;
  const showTopBar = hasContent || showTopBarFromScroll;

  // What the next send would use as a prompt.
  const nextPromptSource = isFirstSend ? body : lastFollowUp;
  const canSend = nextPromptSource.trim().length > 0;
  const isStreaming = running || inflight?.status === "running";

  const showCaretOverlay = isBodyEmpty && bodyFocused && !hasRuns;

  // Dispatch chip (S13 stub) — only meaningful before the first run when the
  // user is still in the body field.
  const dispatchSignal = extractDispatchSignal(title, body);
  const showChip =
    !chipDismissed &&
    isFirstSend &&
    body.trim().length >= 12 &&
    !isStreaming;

  useEffect(() => {
    if (!hasContent && chipDismissed) setChipDismissed(false);
  }, [hasContent, chipDismissed]);

  /* ─── Attachments: sync local state with persisted note ─────────────── */
  useEffect(() => {
    if (!resolvedNoteId) {
      setAttachments([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await getNote(resolvedNoteId);
        if (cancelled) return;
        setAttachments(result?.note.attachments ?? []);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[wend] load attachments failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resolvedNoteId]);

  async function persistAttachments(next: Attachment[]) {
    setAttachments(next);
    if (!resolvedNoteId) return;
    try {
      await saveNote({ id: resolvedNoteId, attachments: next });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[wend] save attachments failed:", err);
    }
  }

  async function handleAttachmentAdded(att: Attachment) {
    const next = [...attachments, att];
    await persistAttachments(next);
  }

  async function handleAttachmentRemove(att: Attachment) {
    const next = attachments.filter((a) => a.id !== att.id);
    await persistAttachments(next);
    // Best-effort cleanup — we don't surface an error if the unlink fails
    // because the metadata is already gone and the orphaned file is harmless.
    void removeAttachmentFile(att.localUri);
  }

  function handleAttachmentOpen(att: Attachment) {
    setFileViewer({
      open: true,
      path: att.localUri,
      mimeType: att.mimeType,
      name: att.name,
      sizeBytes: att.sizeBytes,
    });
  }

  /* ─── First-note coachmark gating ─────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await AsyncStorage.getItem(FIRST_NOTE_COACHMARK_KEY);
        if (cancelled) return;
        if (!v) setCoachmarkVisible(true);
      } catch {
        // ignore — coachmark just won't show
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const shouldShowCoachmark =
    coachmarkVisible && noUserInputYet && !hasRuns && !inflight;

  function dismissCoachmark() {
    setCoachmarkVisible(false);
    void AsyncStorage.setItem(FIRST_NOTE_COACHMARK_KEY, "1").catch(() => {});
  }

  /* ─── Auto-scroll while streaming ──────────────────────────────────── */
  useEffect(() => {
    if (!inflight) return;
    const t = setTimeout(
      () => scrollRef.current?.scrollToEnd({ animated: true }),
      50,
    );
    return () => clearTimeout(t);
  }, [
    inflight?.status,
    inflight?.response,
    inflight?.toolUses.length,
  ]);

  // Also scroll when a new completed run appears at the bottom so the
  // freshly-mounted follow-up input becomes visible.
  useEffect(() => {
    const t = setTimeout(
      () => scrollRef.current?.scrollToEnd({ animated: true }),
      80,
    );
    return () => clearTimeout(t);
  }, [runs.length]);

  // When the keyboard rises, the editor area shrinks (Android adjustResize)
  // but the ScrollView doesn't auto-scroll the focused input into view. Fire
  // a scrollToEnd on keyboardDidShow so the cursor / send button doesn't end
  // up behind the keyboard. Two passes — one immediate, one after a frame
  // for any layout reflow when a multiline input grows.
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      scrollRef.current?.scrollToEnd({ animated: false });
      setTimeout(
        () => scrollRef.current?.scrollToEnd({ animated: true }),
        100,
      );
    });
    return () => sub.remove();
  }, []);

  /* ─── Blinking caret overlay (empty body, S1) ──────────────────────── */
  const blink = useRef(new RNAnimated.Value(1)).current;
  useEffect(() => {
    if (!showCaretOverlay) return;
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(blink, {
          toValue: 0,
          duration: 0,
          delay: 500,
          easing: Easing.step0,
          useNativeDriver: true,
        }),
        RNAnimated.timing(blink, {
          toValue: 1,
          duration: 0,
          delay: 500,
          easing: Easing.step0,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [showCaretOverlay, blink]);

  /* ─── Send handler ─────────────────────────────────────────────────── */
  // `promptOverride` lets Retry (and any future caller) bypass the normal
  // body/followUp routing entirely — they pass the exact prompt to send
  // and we don't read state. Without this, Retry-on-follow-up was a no-op
  // (setBody → nextPromptSource was still lastFollowUp → canSend was false
  // → handleSend bailed at the top).
  async function handleSend(promptOverride?: string) {
    const candidate = (promptOverride ?? nextPromptSource).trim();
    const canSendNow = candidate.length > 0;
    // eslint-disable-next-line no-console
    console.log("[wend] send tapped", {
      canSend: canSendNow,
      isStreaming,
      daemonConfigured,
      runs: runs.length,
      override: Boolean(promptOverride),
    });
    if (!canSendNow || isStreaming) return;
    Keyboard.dismiss();
    if (coachmarkVisible) dismissCoachmark();

    if (!daemonConfigured) {
      setInflight({
        prompt: candidate,
        response: "",
        toolUses: [],
        toolCalls: [],
        sessionId: null,
        durationMs: 0,
        costUsd: 0,
        routeName: null,
        routeCwd: null,
        routeSource: null,
        status: "error",
        error:
          "No Mac paired. Open Settings → Connectivity → Mac and pair from the Wend.app QR.",
      });
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
      return;
    }

    const prompt = candidate;
    // For overrides (retry), don't continue the prior session — it errored,
    // so the sessionId may not be valid. Start fresh.
    const sessionId = promptOverride
      ? null
      : isFirstSend
        ? null
        : runs[lastRunIdx]!.sessionId;

    setInflight({
      prompt,
      response: "",
      toolUses: [],
      toolCalls: [],
      sessionId,
      durationMs: 0,
      costUsd: 0,
      status: "running",
      error: null,
      routeName: null,
      routeCwd: null,
      routeSource: null,
    });

    let accumulated = "";
    const tools: string[] = [];
    const toolCalls: Array<{ name: string; input?: unknown }> = [];
    let resolvedSessionId: string | null = sessionId;
    let resolvedDuration = 0;
    let resolvedCost = 0;
    let resolvedError: string | null = null;
    let didError = false;

    await dispatch({
      prompt,
      // Pass noteCwd so the daemon respects per-note pins; null/undefined lets
      // the daemon resolve via its indexer.
      cwd: noteCwd ?? undefined,
      sessionId: sessionId ?? undefined,
      // noteId publishes "this note is running" to the dispatchSlice so the
      // inbox renders a running pip on the matching card.
      noteId: resolvedNoteId || undefined,
      onEvent: (e: DispatchEvent) => {
        if (e.type === "text") {
          accumulated += e.text;
          setInflight((s) =>
            s ? { ...s, response: accumulated } : s,
          );
        } else if (e.type === "tool_use") {
          tools.push(e.name);
          toolCalls.push({ name: e.name, input: e.input });
          setInflight((s) =>
            s
              ? {
                  ...s,
                  toolUses: [...tools],
                  toolCalls: [...toolCalls],
                }
              : s,
          );
        } else if (e.type === "route") {
          // Daemon resolved a target. Surface it in the inflight block and,
          // if this note had no pin, persist the resolution so follow-ups
          // stay in the same project without re-running the resolver.
          setInflight((s) =>
            s
              ? {
                  ...s,
                  routeName: e.name,
                  routeCwd: e.cwd,
                  routeSource: e.source,
                }
              : s,
          );
          if (!noteCwd && e.source === "auto") setCwd(e.cwd);
        } else if (e.type === "result") {
          resolvedSessionId = e.sessionId || resolvedSessionId;
          resolvedDuration = e.durationMs;
          resolvedCost = e.costUsd;
          if (e.isError) {
            didError = true;
            resolvedError = "Claude reported an error result";
          }
          setInflight((s) =>
            s
              ? {
                  ...s,
                  sessionId: resolvedSessionId,
                  durationMs: resolvedDuration,
                  costUsd: resolvedCost,
                  status: e.isError ? "error" : "done",
                  error: e.isError ? resolvedError : null,
                }
              : s,
          );
        } else if (e.type === "error") {
          didError = true;
          resolvedError = e.message;
          setInflight((s) =>
            s ? { ...s, status: "error", error: e.message } : s,
          );
        } else if (e.type === "done") {
          // Promote inflight to a persisted run regardless of success/error —
          // the user wants the history preserved (errors included). We read
          // the closure-captured locals to avoid stale state.
          const finalStatus: PersistedRun["status"] = didError
            ? "error"
            : "done";
          const persisted: PersistedRun = {
            id: Crypto.randomUUID(),
            prompt,
            response: accumulated,
            sessionId: resolvedSessionId,
            status: finalStatus,
            durationMs: resolvedDuration,
            costUsd: resolvedCost,
            toolUses: [...tools],
            toolCalls: [...toolCalls],
            error: resolvedError,
            followUp: "",
            createdAt: Date.now(),
          };
          appendRun(persisted);
          setInflight(null);
          // Refresh the inbox so the freshly-completed run reflects in any
          // open or next-opened inbox sheet.
          void refreshNotes();
          // Focus the freshly-mounted follow-up input so the user can keep
          // typing without an extra tap.
          setTimeout(() => {
            const idx = runs.length; // about-to-be-appended index
            followUpRefs.current[idx]?.focus();
          }, 80);
        }
      },
    });
  }

  function handleStop() {
    // eslint-disable-next-line no-console
    console.log("[wend] stop tapped");
    cancel();
  }

  function handleConfirmChip() {
    setChipDismissed(true);
    void handleSend();
  }

  function handleDismissChip() {
    setChipDismissed(true);
  }

  /* ─── Inbox sheet handlers ──────────────────────────────────────────── */
  function handleSelectNote(noteId: string) {
    setCurrentNoteId(noteId);
    setInboxOpen(false);
    // Clear any inflight state from the previous note — sessionId belongs to
    // that note's last run, not this one. The new note loads fresh via
    // useNoteEditor(noteId).
    setInflight(null);
    setChipDismissed(false);
  }

  async function handleNewNote() {
    if (!userId) return;
    try {
      const { note } = await createNote(userId);
      setCurrentNoteId(note.id);
      setInboxOpen(false);
      setInflight(null);
      setChipDismissed(false);
      void refreshNotes();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[wend] failed to create note", err);
    }
  }

  /* ─── Note actions (long-press → archive / delete) ─────────────────── */
  function handleLongPressNote(noteId: string, displayTitle: string) {
    setNoteActions({ id: noteId, title: displayTitle });
  }

  async function handleArchiveNote(noteId: string) {
    try {
      await archiveNote(noteId);
      void refreshNotes();
      // If we just archived the current note, drop to a fresh draft.
      if (noteId === resolvedNoteId) {
        setCurrentNoteId(undefined);
        setInflight(null);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[wend] archive failed", err);
    }
  }

  async function handleDeleteNote(noteId: string) {
    try {
      await deleteNote(noteId);
      void refreshNotes();
      if (noteId === resolvedNoteId) {
        setCurrentNoteId(undefined);
        setInflight(null);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[wend] delete failed", err);
    }
  }

  /* ─── Retry a failed run ───────────────────────────────────────────── */
  function handleRetry(_idx: number, failedRun: PersistedRun) {
    // Re-send the failed run's prompt as a fresh dispatch. Don't reuse the
    // sessionId — Claude likely didn't establish one when the run errored.
    // The new dispatch becomes a brand-new entry in runs[]; the old errored
    // entry stays as history so the user can see what happened.
    //
    // We pass the prompt directly via the override path on handleSend
    // instead of doing setBody+setTimeout — that pattern broke for
    // FOLLOW-UP retries because nextPromptSource is computed from
    // body OR lastFollowUp (never both), so setBody didn't actually
    // change what handleSend would send.
    if (isStreaming) return;
    setInflight(null);
    void handleSend(failedRun.prompt);
  }

  /* ─── Sign out ─────────────────────────────────────────────────────── */
  async function handleSignOut() {
    try {
      // Wipe the per-user local state BEFORE we drop the Clerk session.
      // Order matters: AuthGate watches Clerk and will re-route to
      // /(auth)/sign-in as soon as signOut() resolves; if we clear the
      // daemon+onboarding stores after that race, a brief frame of
      // unauthed-but-still-paired state can flash. Clearing first means
      // the next user (or the same user signing back in) gets a clean
      // pairing flow from scratch.
      useDaemonStore.getState().clear();
      useOnboardingStore.getState().reset();
      await signOut();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[wend] sign-out failed", err);
    } finally {
      setSettingsOpen(false);
    }
  }

  /* ─── Style helpers ────────────────────────────────────────────────── */
  const inkColor = tokens["text-primary"];
  const subtleColor = tokens["text-secondary"];
  const placeholderColor = tokens["text-placeholder"];
  const accent = tokens["accent-default"];
  const accentOn = tokens["accent-on"];
  const borderColor = tokens["border-hairline"];
  const surfaceChip = tokens["surface-chip"];
  const canvas = tokens["surface-canvas"];

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: canvas }}
      edges={["top", "bottom"]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
        style={{ flex: 1 }}
      >
        {/* ─── Top app bar ────────────────────────────────────────────
            Visible whenever the note has content (S2) OR the user has
            pulled the scroll surface down past the reveal threshold on a
            blank canvas (S1). Reanimated handles the fade in/out. */}
        {showTopBar ? (
          <Animated.View
            entering={FadeIn.duration(220)}
            exiting={FadeOut.duration(160)}
            style={{
              height: TOP_BAR_HEIGHT,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 16,
              borderBottomWidth: 1,
              borderBottomColor: borderColor,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <IconButton
                icon={<TrayIcon size={22} color={subtleColor} weight="regular" />}
                accessibilityLabel="Inbox"
                onPress={() => setInboxOpen(true)}
              />
              <IconButton
                icon={
                  <MagnifyingGlassIcon
                    size={22}
                    color={subtleColor}
                    weight="regular"
                  />
                }
                accessibilityLabel="Search"
                onPress={() => setCommandPaletteOpen(true)}
              />
            </View>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Text
                style={{
                  fontFamily: "Inter-SemiBold",
                  fontSize: 17,
                  color: inkColor,
                  letterSpacing: -0.17,
                }}
              >
                Wend
              </Text>
              {/* Daemon-reachability pip, sits next to the wordmark so it's
                  visible at a glance without taking nav-bar real estate. */}
              <HealthDot size={8} />
            </View>
            <IconButton
              icon={
                <DotsThreeVerticalIcon
                  size={22}
                  color={subtleColor}
                  weight="bold"
                />
              }
              accessibilityLabel="More"
              onPress={() => setSettingsOpen(true)}
            />
          </Animated.View>
        ) : null}

        {/* ─── Config warning banner ─────────────────────────────────── */}
        {!daemonConfigured ? (
          <View
            style={{
              backgroundColor: tokens["status-warn"],
              paddingHorizontal: 16,
              paddingVertical: 8,
            }}
          >
            <Text
              style={{
                color: "#FFFFFF",
                fontFamily: "Inter-Medium",
                fontSize: 12,
                textAlign: "center",
              }}
            >
              Daemon not configured. Set EXPO_PUBLIC_DAEMON_URL + _TOKEN in
              .env.local and RESTART Metro.
            </Text>
          </View>
        ) : null}

        {/* ─── Editor body ────────────────────────────────────────────── */}
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: hasContent ? 16 : 40,
            paddingBottom: 12,
            alignSelf: "center",
            width: "100%",
            maxWidth: 680,
            flexGrow: 1,
          }}
          keyboardShouldPersistTaps="handled"
          // Drive showTopBarFromScroll. 16ms throttle matches a 60Hz refresh
          // so we don't fire on every native pixel of pan but still react in
          // the same frame the bar should appear.
          onScroll={(e) =>
            setScrollOffsetY(e.nativeEvent.contentOffset.y)
          }
          scrollEventThrottle={16}
          // Bounces=true is the iOS default but needed explicitly so the
          // empty S1 canvas has a pull-to-reveal affordance even when
          // content fits the viewport. Android equivalent is the
          // overscroll glow + pan; we still get negative offsets there.
          bounces
          alwaysBounceVertical
          overScrollMode="always"
        >
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={hasContent ? "Title" : "New note"}
            placeholderTextColor={placeholderColor}
            selectionColor={tokens["accent-caret"]}
            autoCorrect={false}
            spellCheck={false}
            autoCapitalize="sentences"
            returnKeyType="next"
            onSubmitEditing={() => bodyRef.current?.focus()}
            submitBehavior="submit"
            style={{
              fontFamily: "Inter-SemiBold",
              fontSize: typography.title.fontSize,
              lineHeight: typography.title.lineHeight,
              letterSpacing: -0.22,
              color: inkColor,
              paddingVertical: 0,
              marginBottom: 12,
            }}
          />

          {attachments.length > 0 ? (
            <AttachmentStrip
              attachments={attachments}
              borderColor={borderColor}
              chipBg={surfaceChip}
              ink={inkColor}
              subtle={subtleColor}
              onOpen={handleAttachmentOpen}
              onRemove={handleAttachmentRemove}
            />
          ) : null}

          <Pressable
            style={{ minHeight: 80 }}
            onPress={() => bodyRef.current?.focus()}
          >
            <View style={{ position: "relative" }}>
              {showCaretOverlay ? (
                <RNAnimated.View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    top: 2,
                    left: 0,
                    width: 2,
                    height: typography.body.lineHeight - 4,
                    backgroundColor: tokens["accent-caret"],
                    opacity: blink,
                  }}
                />
              ) : null}

              <TextInput
                ref={bodyRef}
                value={body}
                onChangeText={setBody}
                autoFocus
                multiline
                caretHidden={showCaretOverlay}
                textAlignVertical="top"
                placeholder={hasContent ? "Write a thought..." : ""}
                placeholderTextColor={placeholderColor}
                selectionColor={tokens["accent-caret"]}
                onFocus={() => setBodyFocused(true)}
                onBlur={() => setBodyFocused(false)}
                scrollEnabled={false}
                style={{
                  minHeight: 80,
                  fontFamily: "Inter-Regular",
                  fontSize: typography.body.fontSize,
                  lineHeight: typography.body.lineHeight,
                  letterSpacing: -0.187,
                  color: inkColor,
                  padding: 0,
                  margin: 0,
                  textAlignVertical: "top",
                }}
              />
            </View>
          </Pressable>

          {/* Render completed runs + their follow-up inputs in chronological
              order. Each run is readonly; each follow-up is editable and
              becomes the next prompt when the user taps send. */}
          {runs.map((run, idx) => (
            <View key={run.id}>
              <AgentRunBlock
                state={persistedRunToBlockState(run)}
                projectName={projectBasename(noteCwd)}
                onRetry={
                  run.status === "error" && !isStreaming
                    ? () => handleRetry(idx, run)
                    : undefined
                }
                onOpenFile={(path) =>
                  setFileViewer({ open: true, path })
                }
              />
              <FollowUpInput
                value={run.followUp}
                onChangeText={(t) => updateRunFollowUp(idx, t)}
                placeholder="Ask a follow-up..."
                placeholderColor={placeholderColor}
                inkColor={inkColor}
                caretColor={tokens["accent-caret"]}
                accentColor={accent}
                accentOnColor={accentOn}
                surfaceChipColor={surfaceChip}
                tertiaryColor={tokens["text-tertiary"]}
                inputRef={(r) => {
                  followUpRefs.current[idx] = r;
                }}
                isLast={idx === lastRunIdx}
                showSend={idx === lastRunIdx && !inflight}
                canSend={
                  idx === lastRunIdx && run.followUp.trim().length > 0
                }
                isStreaming={isStreaming}
                onSend={handleSend}
                onStop={handleStop}
                onFocus={() => {
                  // Wait for the keyboard to start rising, then scroll the
                  // focused input into view. Android with adjustResize will
                  // shrink the layout but doesn't auto-scroll a scrollview;
                  // scrollToEnd is sufficient since follow-ups live at the
                  // tail of the scroll content.
                  setTimeout(
                    () =>
                      scrollRef.current?.scrollToEnd({ animated: true }),
                    150,
                  );
                }}
              />
            </View>
          ))}

          {/* The in-flight run (no PersistedRun yet) — same visual, with
              streaming text and a stop button in the header. */}
          {inflight ? (
            <AgentRunBlock
              state={inflightToBlockState(inflight)}
              onStop={handleStop}
              projectName={inflight.routeName || projectBasename(noteCwd)}
              onOpenFile={(path) => setFileViewer({ open: true, path })}
            />
          ) : null}
        </ScrollView>

        {/* ─── Confidence chip (S13) ──────────────────────────────────── */}
        {showChip ? (
          <Animated.View
            entering={SlideInDown.springify().damping(15).mass(0.6)}
            exiting={SlideOutDown.duration(180)}
            style={{
              position: "absolute",
              left: 16,
              right: 16,
              bottom: TOOLBAR_HEIGHT + 12,
              alignItems: "center",
              zIndex: 40,
              pointerEvents: "box-none",
            }}
            pointerEvents="box-none"
          >
            <Pressable
              onPress={handleConfirmChip}
              accessibilityRole="button"
              accessibilityLabel="Send to Claude on Mac"
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                maxWidth: "100%",
                backgroundColor: tokens["surface-elevated"],
                borderColor: borderColor,
                borderWidth: 1,
                borderRadius: 999,
                paddingLeft: 16,
                paddingRight: 8,
                paddingVertical: 6,
                shadowColor: "#000",
                shadowOpacity: 0.1,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
                elevation: 4,
                opacity: pressed ? 0.8 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <Text
                style={{
                  fontFamily: "Inter-Medium",
                  fontSize: 13,
                  color: inkColor,
                  marginRight: 10,
                  flexShrink: 1,
                  flexGrow: 0,
                }}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                Send to Claude{dispatchSignal ? ` (${dispatchSignal})` : ""} on Mac
              </Text>
              <Pressable
                onPress={handleDismissChip}
                accessibilityRole="button"
                accessibilityLabel="Dismiss suggestion"
                hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                style={({ pressed }) => ({
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.5 : 1,
                  marginRight: 4,
                  flexShrink: 0,
                })}
              >
                <XIcon size={16} color={subtleColor} weight="bold" />
              </Pressable>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: accent,
                  flexShrink: 0,
                }}
              >
                <CheckIcon size={16} color={accentOn} weight="bold" />
              </View>
            </Pressable>
          </Animated.View>
        ) : null}

        {/* ─── Keyboard toolbar (S2 only) ─────────────────────────────── */}
        {hasContent ? (
          <Animated.View
            entering={SlideInDown.duration(220)}
            exiting={SlideOutDown.duration(160)}
            style={{
              height: TOOLBAR_HEIGHT,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 16,
              borderTopWidth: 1,
              borderTopColor: borderColor,
              backgroundColor: canvas,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <ToolbarButton
                onPress={() => {
                  if (isFirstSend) {
                    insertAtBodyEnd("# ", setBody, body);
                  } else {
                    insertAtFollowUpEnd(
                      "# ",
                      lastRunIdx,
                      lastFollowUp,
                      updateRunFollowUp,
                    );
                  }
                }}
                accessibilityLabel="Heading"
                icon={<TextHOneIcon size={22} color={subtleColor} weight="regular" />}
              />
              <ToolbarButton
                onPress={() => {
                  if (isFirstSend) {
                    insertAtBodyEnd("`code`", setBody, body);
                  } else {
                    insertAtFollowUpEnd(
                      "`code`",
                      lastRunIdx,
                      lastFollowUp,
                      updateRunFollowUp,
                    );
                  }
                }}
                accessibilityLabel="Inline code"
                content={
                  <Text
                    style={{
                      fontFamily: "JetBrainsMono-Medium",
                      fontSize: 16,
                      color: subtleColor,
                    }}
                  >
                    M
                  </Text>
                }
              />
              <ToolbarButton
                onPress={() => {
                  if (isFirstSend) {
                    insertAtBodyEnd("\n- ", setBody, body);
                  } else {
                    insertAtFollowUpEnd(
                      "\n- ",
                      lastRunIdx,
                      lastFollowUp,
                      updateRunFollowUp,
                    );
                  }
                }}
                accessibilityLabel="Bulleted list"
                icon={<ListBulletsIcon size={22} color={subtleColor} weight="regular" />}
              />
              <View
                style={{
                  width: 1,
                  height: 20,
                  backgroundColor: borderColor,
                  marginHorizontal: 4,
                }}
              />
              <ToolbarButton
                onPress={() => {
                  if (!resolvedNoteId) return;
                  Keyboard.dismiss();
                  setAttachmentPickerOpen(true);
                }}
                accessibilityLabel="Attach file"
                icon={
                  <PaperclipIcon
                    size={22}
                    color={attachments.length > 0 ? accent : subtleColor}
                    weight={attachments.length > 0 ? "fill" : "regular"}
                  />
                }
              />
            </View>

            <Pressable
              onPress={isStreaming ? handleStop : () => void handleSend()}
              disabled={!isStreaming && !canSend}
              accessibilityRole="button"
              accessibilityState={{ disabled: !isStreaming && !canSend }}
              accessibilityLabel={isStreaming ? "Stop dispatch" : "Send note"}
              style={({ pressed }) => ({
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: isStreaming || canSend ? accent : surfaceChip,
                opacity: isStreaming || canSend ? 1 : 0.6,
                transform: [{ scale: pressed ? 0.94 : 1 }],
              })}
            >
              {isStreaming ? (
                <StopIcon size={16} color={accentOn} weight="fill" />
              ) : (
                <ArrowUpIcon
                  size={18}
                  color={canSend ? accentOn : tokens["text-tertiary"]}
                  weight="bold"
                />
              )}
            </Pressable>
          </Animated.View>
        ) : null}

        {/* ─── Floating send + coachmark (S1 only — blank canvas) ─────── */}
        {!hasContent ? (
          <Pressable
            // The whole right-bottom region is the dismissal hit area for
            // the coachmark (per design: "Tap anywhere on screen to dismiss
            // permanently"). The send button intercepts its own taps via
            // event ordering — nested Pressable's onPress fires first.
            onPress={() => {
              if (coachmarkVisible) dismissCoachmark();
            }}
            style={{
              position: "absolute",
              right: 0,
              left: 0,
              bottom: 0,
              top: 0,
              // pointerEvents-box-none: only the children handle taps.
              // We need the actual hits-anywhere-to-dismiss; let the
              // background Pressable claim them.
            }}
            pointerEvents={coachmarkVisible ? "auto" : "box-none"}
          >
            <View
              pointerEvents="box-none"
              style={{
                position: "absolute",
                right: 20,
                bottom: Math.max(insets.bottom, 16) + 8,
                alignItems: "flex-end",
              }}
            >
              {shouldShowCoachmark ? <FirstNoteCoachmark /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSend }}
                accessibilityLabel="Send note"
                onPress={() => {
                  if (coachmarkVisible) dismissCoachmark();
                  void handleSend();
                }}
                disabled={!canSend}
                style={({ pressed }) => ({
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: canSend ? accent : surfaceChip,
                  opacity: canSend ? 1 : 0.6,
                  borderWidth: canSend ? 0 : 1,
                  borderColor: borderColor,
                  shadowColor: "#000",
                  shadowOpacity: canSend ? 0.18 : 0.05,
                  shadowRadius: canSend ? 10 : 2,
                  shadowOffset: { width: 0, height: canSend ? 4 : 1 },
                  elevation: canSend ? 4 : 1,
                  transform: [{ scale: pressed && canSend ? 0.95 : 1 }],
                })}
              >
                <ArrowUpIcon
                  size={24}
                  color={canSend ? accentOn : tokens["text-tertiary"]}
                  weight="bold"
                />
              </Pressable>
            </View>
          </Pressable>
        ) : null}

      </KeyboardAvoidingView>

      {/* Inbox sheet — rendered OUTSIDE the KeyboardAvoidingView so the sheet
          uses its own safe-area math and the keyboard doesn't shove it
          around. Component returns null when open=false (post-exit anim). */}
      <InboxSheet
        open={inboxOpen}
        onClose={() => setInboxOpen(false)}
        onSelectNote={handleSelectNote}
        onNewNote={handleNewNote}
        onLongPressNote={handleLongPressNote}
        onOpenSettings={() => {
          // Close the inbox first so the settings sheet has the full screen
          // without two layered sheets fighting for the same height.
          setInboxOpen(false);
          setSettingsOpen(true);
        }}
      />

      {/* Settings stack — three sheets that layer via zIndex (60 / 70 / 80).
          Top-level Settings is what ⋮ in the top bar opens. */}
      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSignOut={handleSignOut}
        onOpenIntegrations={() => setIntegrationsOpen(true)}
        onConnectMac={() => {
          // Open the QR scanner. Don't close settings — the scanner stacks
          // on top via its higher zIndex, and on success it auto-closes
          // itself, leaving the user back on Settings with the "Paired with
          // <host>" subtitle updated live.
          setConnectMacOpen(true);
        }}
        onShowComingSoon={(label) => {
          // Lightweight feedback for non-functional rows (Profile, Subscription).
          // Replace with real destinations as they ship.
          Alert.alert(label, `${label} is coming soon.`);
        }}
      />
      <IntegrationsSheet
        open={integrationsOpen}
        onClose={() => setIntegrationsOpen(false)}
        onConnectGitHub={() => setConnectGitHubOpen(true)}
      />
      <ConnectGitHubSheet
        open={connectGitHubOpen}
        onClose={() => setConnectGitHubOpen(false)}
        onAuthorize={() => {
          // eslint-disable-next-line no-console
          console.log("[wend] GitHub authorize tapped");
          setConnectGitHubOpen(false);
        }}
      />
      <ConnectMacSheet
        open={connectMacOpen}
        onClose={() => setConnectMacOpen(false)}
      />

      {/* Command palette — full-screen search overlay. */}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onSelectNote={handleSelectNote}
        runs={runs}
      />

      {/* Attachment picker — bottom sheet with Photo / Document options. */}
      <AttachmentPicker
        open={attachmentPickerOpen}
        onClose={() => setAttachmentPickerOpen(false)}
        noteId={resolvedNoteId}
        onAttached={(att) => {
          void handleAttachmentAdded(att);
        }}
      />

      {/* File viewer — opens for attachment chips AND for tappable file
          paths in agent responses. Mounted last so its zIndex (90) stacks
          above every other sheet. */}
      <FileViewerModal
        open={fileViewer.open}
        onClose={() => setFileViewer((s) => ({ ...s, open: false }))}
        path={fileViewer.path}
        mimeType={fileViewer.mimeType}
        name={fileViewer.name}
        sizeBytes={fileViewer.sizeBytes}
      />

      {/* Note actions — long-press a card to open. Auto-height. */}
      <NoteActionsSheet
        open={noteActions !== null}
        noteId={noteActions?.id ?? null}
        noteTitle={noteActions?.title ?? null}
        onClose={() => setNoteActions(null)}
        onArchive={(id) => {
          void handleArchiveNote(id);
          setNoteActions(null);
        }}
        onDelete={(id) => {
          void handleDeleteNote(id);
          setNoteActions(null);
        }}
      />
    </SafeAreaView>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────────── */

function IconButton(props: {
  icon: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        opacity: pressed ? 0.55 : 1,
        transform: [{ scale: pressed ? 0.95 : 1 }],
      })}
    >
      {props.icon}
    </Pressable>
  );
}

function ToolbarButton(props: {
  onPress: () => void;
  accessibilityLabel: string;
  icon?: React.ReactNode;
  content?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        marginRight: 4,
        opacity: pressed ? 0.55 : 1,
      })}
    >
      {props.content ?? props.icon}
    </Pressable>
  );
}

function FollowUpInput(props: {
  value: string;
  onChangeText: (s: string) => void;
  placeholder: string;
  placeholderColor: string;
  inkColor: string;
  caretColor: string;
  accentColor: string;
  accentOnColor: string;
  surfaceChipColor: string;
  tertiaryColor: string;
  inputRef: (r: TextInput | null) => void;
  isLast: boolean;
  /** Only render the inline send button under the LAST follow-up — that's
   *  the only one the user can actually dispatch. Older follow-ups are just
   *  history (a record of what was sent that turn). */
  showSend: boolean;
  canSend: boolean;
  isStreaming: boolean;
  onSend: () => void;
  onStop: () => void;
  onFocus: () => void;
}) {
  return (
    <View
      style={{
        marginTop: 16,
        marginBottom: props.isLast ? 0 : 4,
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 10,
      }}
    >
      <TextInput
        ref={props.inputRef}
        value={props.value}
        onChangeText={props.onChangeText}
        onFocus={props.onFocus}
        multiline
        placeholder={props.placeholder}
        placeholderTextColor={props.placeholderColor}
        selectionColor={props.caretColor}
        scrollEnabled={false}
        textAlignVertical="top"
        style={{
          flex: 1,
          minHeight: 40,
          fontFamily: "Inter-Regular",
          fontSize: typography.body.fontSize,
          lineHeight: typography.body.lineHeight,
          letterSpacing: -0.187,
          color: props.inkColor,
          padding: 0,
          margin: 0,
          textAlignVertical: "top",
        }}
      />
      {props.showSend ? (
        <Pressable
          onPress={props.isStreaming ? props.onStop : props.onSend}
          disabled={!props.isStreaming && !props.canSend}
          accessibilityRole="button"
          accessibilityLabel={
            props.isStreaming ? "Stop dispatch" : "Send follow-up"
          }
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor:
              props.isStreaming || props.canSend
                ? props.accentColor
                : props.surfaceChipColor,
            alignItems: "center",
            justifyContent: "center",
            opacity: props.isStreaming || props.canSend ? 1 : 0.55,
            transform: [{ scale: pressed ? 0.94 : 1 }],
            shadowColor: "#000",
            shadowOpacity: props.canSend ? 0.18 : 0,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: props.canSend ? 3 : 0,
            flexShrink: 0,
          })}
        >
          {props.isStreaming ? (
            <StopIcon size={16} color={props.accentOnColor} weight="fill" />
          ) : (
            <ArrowUpIcon
              size={18}
              color={
                props.canSend ? props.accentOnColor : props.tertiaryColor
              }
              weight="bold"
            />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Horizontal scroll of 56×56 attachment chips. Image chips render the file
 * inline; non-image chips show a small file glyph + extension. Tap opens
 * the viewer; long-press removes (after a confirm).
 */
function AttachmentStrip(props: {
  attachments: Attachment[];
  borderColor: string;
  chipBg: string;
  ink: string;
  subtle: string;
  onOpen: (att: Attachment) => void;
  onRemove: (att: Attachment) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingBottom: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      {props.attachments.map((att) => (
        <AttachmentChip
          key={att.id}
          attachment={att}
          borderColor={props.borderColor}
          chipBg={props.chipBg}
          ink={props.ink}
          subtle={props.subtle}
          onOpen={() => props.onOpen(att)}
          onRemove={() => props.onRemove(att)}
        />
      ))}
    </ScrollView>
  );
}

function AttachmentChip(props: {
  attachment: Attachment;
  borderColor: string;
  chipBg: string;
  ink: string;
  subtle: string;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { attachment } = props;
  const kind = useMemo(
    () => classifyAttachment(attachment.mimeType, attachment.name),
    [attachment.mimeType, attachment.name],
  );
  const extLabel = useMemo(() => {
    const dot = attachment.name.lastIndexOf(".");
    if (dot === -1) return "FILE";
    return attachment.name.slice(dot + 1).slice(0, 4).toUpperCase();
  }, [attachment.name]);

  function confirmRemove() {
    Alert.alert(
      "Remove attachment?",
      attachment.name,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: props.onRemove,
        },
      ],
      { cancelable: true },
    );
  }

  return (
    <Pressable
      onPress={props.onOpen}
      onLongPress={confirmRemove}
      accessibilityRole="button"
      accessibilityLabel={`Attachment ${attachment.name}`}
      style={({ pressed }) => ({
        width: 56,
        height: 56,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: props.borderColor,
        backgroundColor: props.chipBg,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {kind === "image" ? (
        <RNImage
          source={{ uri: attachment.localUri }}
          style={{ width: "100%", height: "100%" }}
          resizeMode="cover"
        />
      ) : (
        <>
          <PaperclipIcon size={18} color={props.subtle} weight="regular" />
          <Text
            style={{
              fontFamily: "JetBrainsMono-Medium",
              fontSize: 9,
              color: props.subtle,
              marginTop: 2,
              letterSpacing: 0.4,
            }}
            numberOfLines={1}
          >
            {extLabel}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function persistedRunToBlockState(run: PersistedRun): AgentRunBlockState {
  return {
    status: run.status,
    prompt: run.prompt,
    response: run.response,
    toolUses: run.toolUses,
    toolCalls: run.toolCalls,
    durationMs: run.durationMs,
    costUsd: run.costUsd,
    error: run.error,
  };
}

function inflightToBlockState(run: InflightRun): AgentRunBlockState {
  return {
    status: run.status,
    prompt: run.prompt,
    response: run.response,
    toolUses: run.toolUses,
    toolCalls: run.toolCalls,
    durationMs: run.durationMs,
    costUsd: run.costUsd,
    error: run.error,
  };
}

function insertAtBodyEnd(
  fragment: string,
  setBody: (s: string) => void,
  current: string,
) {
  const next =
    current.length > 0 && !current.endsWith("\n") && !fragment.startsWith("\n")
      ? `${current}\n${fragment}`
      : `${current}${fragment}`;
  setBody(next);
}

function insertAtFollowUpEnd(
  fragment: string,
  idx: number,
  current: string,
  update: (idx: number, text: string) => void,
) {
  if (idx < 0) return;
  const next =
    current.length > 0 && !current.endsWith("\n") && !fragment.startsWith("\n")
      ? `${current}\n${fragment}`
      : `${current}${fragment}`;
  update(idx, next);
}

/** Phase 2 stub for dispatch detection — grabs the first ticket-like token
 *  (`ABC-123`) from the title or body. */
function extractDispatchSignal(title: string, body: string): string | null {
  const haystack = `${title}\n${body}`;
  const match = haystack.match(/\b[A-Z]{2,}-\d+\b/);
  return match ? match[0] : null;
}

/** Strip a path to its basename so the AgentRunBlock chip stays compact
 *  ("/Users/agnij/Desktop/Wend/app" → "app"). Returns null for empty input. */
function projectBasename(cwd: string | null): string | null {
  if (!cwd) return null;
  const trimmed = cwd.replace(/\/+$/, "");
  const parts = trimmed.split("/");
  return parts[parts.length - 1] || null;
}
