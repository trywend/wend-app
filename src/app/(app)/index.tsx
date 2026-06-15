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
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ArrowUpIcon,
  CheckIcon,
  CodeIcon,
  DotsThreeVerticalIcon,
  LinkSimpleIcon,
  ListBulletsIcon,
  ListNumbersIcon,
  MagnifyingGlassIcon,
  PaperclipIcon,
  QuotesIcon,
  StopIcon,
  TextBIcon,
  TextHOneIcon,
  TextHThreeIcon,
  TextHTwoIcon,
  TextItalicIcon,
  TrayIcon,
  XIcon,
} from "phosphor-react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { typography } from "@/theme/tokens";
import { useNoteEditor } from "@/lib/notes/useNoteEditor";
import { useNotesList } from "@/lib/notes/useNotesList";
import { useDispatch, type DispatchEvent } from "@/lib/dispatch/useDispatch";
import { useResolvedDaemonURL } from "@/lib/dispatch/useResolvedDaemonURL";
import { splitLeadingCommand } from "@/lib/dispatch/commands";
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
import { useCloudStore } from "@/store/cloudSlice";
import { setNotificationResponseHandler, consumePendingDeepLink } from "@/lib/notifications";
import { catchUpRunsForNote } from "@/lib/dispatch/catchUp";
import {
  findEditNewStringForPath,
  findWriteContentForPath,
} from "@/lib/agentMarkdown";
import { useWendCloudApi } from "@/lib/wend-cloud-api";
import { useSubscriptionSync } from "@/lib/useSubscriptionSync";
import { PaywallSheet, type PaywallReason } from "@/components/PaywallSheet";
import { useSignOut } from "@/auth/client";
import { Text } from "@/components/primitives";
import { WendWordmark } from "@/components/primitives/Logo";
import { CommandPalette } from "@/components/CommandPalette";
import { InboxSheet } from "@/components/InboxSheet";
import { SettingsSheet } from "@/components/SettingsSheet";
import { IntegrationsSheet } from "@/components/IntegrationsSheet";
import { ConnectGitHubSheet } from "@/components/ConnectGitHubSheet";
import { ConnectMacSheet } from "@/components/ConnectMacSheet";
import { ConnectAnthropicSheet } from "@/components/ConnectAnthropicSheet";
import { CloudGitHubSheet } from "@/components/CloudGitHubSheet";
import { CloudRepoPickerSheet } from "@/components/CloudRepoPickerSheet";
import { NoteActionsSheet } from "@/components/NoteActionsSheet";
import { AttachmentPicker } from "@/components/AttachmentPicker";
import { FileViewerModal } from "@/components/FileViewerModal";
import { HealthDot } from "@/components/HealthDot";
import {
  AgentRunBlock,
  type AgentRunBlockState,
} from "@/components/editor/AgentRunBlock";
import {
  LiveMarkdownInput,
  type LiveMarkdownInputHandle,
  type LiveMarkdownTheme,
} from "@/components/editor/LiveMarkdownInput";
import { deriveTitleFromBody } from "@/lib/notes/deriveTitle";
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
  /** stderr lines accumulated during the run. Warnings, not failures. */
  warnings: string[];
  /** True while the Mac stream dropped and useDispatch is re-attaching via
   *  the daemon's resume endpoint — header shows "Reconnecting…". */
  reconnecting: boolean;
  /** Smart routing — the project the daemon resolved this run into. Populated
   *  by the first `route` event from the SSE stream. */
  routeName: string | null;
  routeCwd: string | null;
  routeSource: "auto" | "pinned" | "fallback" | "cloud" | null;
}

const INITIAL_INFLIGHT: InflightRun | null = null;

export default function HomeScreen() {
  const { tokens } = useTheme();
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
    removeRun,
    noteId: resolvedNoteId,
  } = useNoteEditor(currentNoteId);
  const { refresh: refreshNotes } = useNotesList();
  const userId = useAuthStore((s) => s.user?.id);
  const [chipDismissed, setChipDismissed] = useState(false);
  const [inflight, setInflight] = useState<InflightRun | null>(INITIAL_INFLIGHT);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [connectGitHubOpen, setConnectGitHubOpen] = useState(false);
  const [connectMacOpen, setConnectMacOpen] = useState(false);
  const [connectAnthropicOpen, setConnectAnthropicOpen] = useState(false);
  const [cloudGitHubOpen, setCloudGitHubOpen] = useState(false);
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  const dispatchMode = useCloudStore((s) => s.dispatchMode);
  useSubscriptionSync();

  /* ─── Deep-link: tap on a push notification opens the right note ──── */
  useEffect(() => {
    setNotificationResponseHandler((noteId) => {
      setCurrentNoteId(noteId);
      setInflight(null);
      setChipDismissed(false);
    });
    const pending = consumePendingDeepLink();
    if (pending) {
      setCurrentNoteId(pending);
      setInflight(null);
    }
  }, []);

  /* ─── Catch up cloud runs that completed while we were offline ───── */
  const cloudApi = useWendCloudApi();
  useEffect(() => {
    if (!resolvedNoteId || !cloudApi.isConfigured) return;
    void catchUpRunsForNote({ noteId: resolvedNoteId, api: cloudApi })
      .then((added) => {
        if (added > 0) {
          // notes-storage was updated directly; bump the cache so
          // useNoteEditor / useNotesList re-read.
          void refreshNotes();
        }
      });
  }, [resolvedNoteId, cloudApi.isConfigured, refreshNotes]);
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
    content?: string;
    editExcerpt?: string;
  }>({ open: false, path: "" });
  // Opening a file from a run: when the run's toolCalls carry a Write for
  // the exact path, embed that content (cloud containers are gone by view
  // time). An Edit-only path gets its new_string as a best-effort excerpt.
  function openRunFile(
    path: string,
    calls?: Array<{ name: string; input?: unknown }>,
  ) {
    const written = calls ? findWriteContentForPath(calls, path) : null;
    const excerpt =
      written == null && calls ? findEditNewStringForPath(calls, path) : null;
    setFileViewer({
      open: true,
      path,
      content: written ?? undefined,
      editExcerpt: excerpt ?? undefined,
    });
  }
  const signOut = useSignOut();
  const [coachmarkVisible, setCoachmarkVisible] = useState(false);
  const { dispatch, running, cancel, isConfigured: daemonConfigured } =
    useDispatch();
  const resolvedDaemon = useResolvedDaemonURL();

  const bodyRef = useRef<LiveMarkdownInputHandle>(null);
  const followUpRefs = useRef<Record<number, LiveMarkdownInputHandle | null>>(
    {},
  );
  const scrollRef = useRef<ScrollView>(null);
  // Bumped every time the user edits the title — any in-flight auto-title
  // generation captures the value at start and discards its result if the
  // user-typed value has changed since.
  const titleEditTokenRef = useRef(0);

  // Cursor selection per editable field. We track these so the markdown
  // toolbar can insert at the cursor (and wrap a selected range) instead of
  // always appending at the end. RN doesn't give us programmatic access to
  // the TextInput selection on read — we mirror it from onSelectionChange.
  const [bodySelection, setBodySelection] = useState({ start: 0, end: 0 });
  const [followUpSelection, setFollowUpSelection] = useState({
    start: 0,
    end: 0,
  });

  const lastRunIdx = runs.length - 1;
  const hasRuns = runs.length > 0;
  const isFirstSend = !hasRuns;
  const lastFollowUp = hasRuns ? runs[lastRunIdx]!.followUp : "";

  const isBodyEmpty = body.length === 0;
  const isTitleEmpty = title.length === 0;
  // Attachments count as content — an attachment-only note must still show
  // the top bar (and not look like a blank canvas).
  const noUserInputYet =
    isBodyEmpty &&
    isTitleEmpty &&
    !hasRuns &&
    !inflight &&
    attachments.length === 0;
  const hasContent = !noUserInputYet;

  // Reveal-the-top-bar affordance for the blank canvas. The bar is hidden
  // by default on S1 so a fresh note opens quiet; the user still needs a
  // way to reach Inbox / Search / Settings without typing.
  //
  // History: pull-down gestures (ScrollView.onScroll, then a wrapping
  // PanGesture, then a 24px GestureDetector strip with a Pan/Tap race) all
  // failed in user testing — the autoFocused body TextInput won touch
  // routing, and the 3s auto-hide killed the bar before the user could
  // tap it.
  //
  // Now: a 56px-tall `Pressable` overlay strip pinned to the top edge.
  // Tap reveals the bar; the bar then stays open for the rest of the
  // session. No gesture races, no timers — too much complexity for an
  // alpha-quality affordance. A subtle handle hints at the target.
  const [pulledOpen, setPulledOpen] = useState(false);
  const REVEAL_STRIP_HEIGHT = 56;

  const showTopBar = hasContent || pulledOpen;

  function revealTopBar() {
    setPulledOpen(true);
  }

  // What the next send would use as a prompt.
  const nextPromptSource = isFirstSend ? body : lastFollowUp;
  const canSend = nextPromptSource.trim().length > 0;
  const isStreaming = running || inflight?.status === "running";

  // Markdown hint — lights up when the line at the cursor starts with a
  // markdown token. Complements the live-rendered markdown in the input by
  // naming the block the cursor sits in (`MD · H2`).
  const activeMarkdownHint = useMemo(
    () =>
      detectMarkdownToken(
        isFirstSend ? body : lastFollowUp,
        isFirstSend ? bodySelection.start : followUpSelection.start,
      ),
    [
      isFirstSend,
      body,
      lastFollowUp,
      bodySelection.start,
      followUpSelection.start,
    ],
  );

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
    // Tag the attachment with where it was added so it renders inline at
    // that point in the note (-1 = the body section, n = after run n's
    // follow-up) instead of every attachment piling up under the title.
    const next = [...attachments, { ...att, afterRun: runs.length - 1 }];
    await persistAttachments(next);
  }

  // Inline grouping — legacy attachments without `afterRun` fall into the
  // body group so they keep rendering near the top where they used to.
  const bodyAttachments = attachments.filter((a) => (a.afterRun ?? -1) < 0);
  const attachmentsForRun = (idx: number) =>
    attachments.filter((a) => a.afterRun === idx);

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

  /* ─── Send handler ─────────────────────────────────────────────────── */
  // `promptOverride` lets Retry (and any future caller) bypass the normal
  // body/followUp routing entirely — they pass the exact prompt to send
  // and we don't read state. Without this, Retry-on-follow-up was a no-op
  // (setBody → nextPromptSource was still lastFollowUp → canSend was false
  // → handleSend bailed at the top).
  async function handleSend(promptOverride?: string) {
    // Raw markdown is the dispatch payload — we trim trailing whitespace
    // only. No formatting strip, no render-then-stringify. Claude reads
    // the markdown the user actually wrote (headings, bullets, code
    // fences, links) and treats it as part of the message verbatim. The
    // buildPrompt wrapper in useDispatch prepends framing but never
    // mutates the note body itself.
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
        warnings: [],
        reconnecting: false,
      });
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
      return;
    }

    // A note leading with a palette command dispatches that segment in
    // isolation — its system prompt frames the run (applied in buildPrompt)
    // and the rest of the note is excluded from this send.
    const leadingCommand = splitLeadingCommand(candidate);
    const prompt = leadingCommand ? leadingCommand.segment : candidate;

    // Auto-title: when the user sends an untitled first dispatch, fire a
    // small parallel Claude call to summarize the body into a 2–4 word
    // title. Non-blocking; if the user types a title before this resolves
    // we discard the result.
    // Fire on the first send AND on a retry (promptOverride) — a note
    // whose first dispatch failed should still get an auto-title once a
    // retry succeeds. The title-empty guard + edit-token keep it from
    // clobbering a title the user typed.
    if (
      (isFirstSend || Boolean(promptOverride)) &&
      title.trim().length === 0 &&
      body.trim().length > 0
    ) {
      const startToken = titleEditTokenRef.current;
      void generateAutoTitle({
        url: resolvedDaemon.url,
        token: resolvedDaemon.token,
        body,
      }).then((suggested) => {
        if (!suggested) return;
        if (titleEditTokenRef.current !== startToken) return;
        if (title.trim().length > 0) return;
        setTitle(suggested);
      });
    }

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
      warnings: [],
      reconnecting: false,
      routeName: null,
      routeCwd: null,
      routeSource: null,
    });

    let accumulated = "";
    const tools: string[] = [];
    const toolCalls: Array<{ name: string; input?: unknown }> = [];
    const warnings: string[] = [];
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
      noteTitle: title.trim() || deriveTitleFromBody(body) || "Untitled note",
      // Deliver the note's attachments to the daemon for this run so Claude
      // can read them. Re-sent each turn (the daemon overwrites by name) so
      // follow-ups keep access without the phone tracking staged paths.
      attachments: attachments.length
        ? attachments.map((a) => ({
            localUri: a.localUri,
            name: a.name,
            mimeType: a.mimeType,
          }))
        : undefined,
      onEvent: (e: DispatchEvent) => {
        if (e.type === "error" && /Wend Pro|Wend subscription/.test(e.message)) {
          setPaywall({
            title: dispatchMode === "mac" ? "Pair your Mac with Pro" : "Dispatch to the cloud",
            body: e.message,
          });
        }
        // Any event other than "reconnecting" means the stream is flowing
        // again — drop the banner. No-op (same object back) when not set.
        if (e.type !== "reconnecting") {
          setInflight((s) =>
            s && s.reconnecting ? { ...s, reconnecting: false } : s,
          );
        }
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
        } else if (e.type === "stderr") {
          // stderr is a warning, never a failure. Accumulate; if the run
          // later errors without a better message, the last line becomes
          // the error detail.
          warnings.push(e.message);
          setInflight((s) => (s ? { ...s, warnings: [...warnings] } : s));
        } else if (e.type === "reconnecting") {
          setInflight((s) => (s ? { ...s, reconnecting: true } : s));
        } else if (e.type === "result") {
          resolvedSessionId = e.sessionId || resolvedSessionId;
          resolvedDuration = e.durationMs;
          resolvedCost = e.costUsd;
          if (e.isError) {
            didError = true;
            resolvedError =
              warnings[warnings.length - 1] ?? "Claude reported an error result";
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
          resolvedError =
            e.message || warnings[warnings.length - 1] || "Dispatch failed";
          setInflight((s) =>
            s ? { ...s, status: "error", error: resolvedError } : s,
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
            warnings: warnings.length ? [...warnings] : undefined,
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

  /* ─── Markdown toolbar ──────────────────────────────────────────────
     The enriched input is WYSIWYG and exposes an imperative API. We route
     each toolbar action to the active field — body on first send, last
     follow-up after — resolving the live handle, its mirrored selection,
     and a write-back that keeps the raw-markdown `value` (dispatch's source
     of truth) in sync.

       - Bold / Italic → native toggleBold()/toggleItalic(). The input
         mirrors the new markdown out via onChangeMarkdown.
       - Inline code / Link → no imperative toggle. We read getMarkdown(),
         wrap the selection with our helpers, then setMarkdown()+setSelection.
       - H1/H2/H3, bullet, numbered, quote → no imperative toggle. Same
         getMarkdown → line-prefix transform → setMarkdown()+setSelection. */
  type MdTarget = {
    handle: LiveMarkdownInputHandle | null;
    text: string;
    selection: { start: number; end: number };
    write: (text: string) => void;
    setSelection: (sel: { start: number; end: number }) => void;
  };

  function activeMdTarget(): MdTarget | null {
    if (isFirstSend) {
      return {
        handle: bodyRef.current,
        text: body,
        selection: bodySelection,
        write: setBody,
        setSelection: setBodySelection,
      };
    }
    if (lastRunIdx < 0) return null;
    return {
      handle: followUpRefs.current[lastRunIdx] ?? null,
      text: lastFollowUp,
      selection: followUpSelection,
      write: (t) => updateRunFollowUp(lastRunIdx, t),
      setSelection: setFollowUpSelection,
    };
  }

  // Compute a transformed markdown buffer off the mirrored state, push it to
  // the native input (and parent value), and restore the cursor.
  function applyComputed(
    t: MdTarget,
    next: { text: string; cursor: number },
  ) {
    t.write(next.text);
    t.handle?.setMarkdown(next.text);
    t.handle?.focus();
    t.handle?.setSelection(next.cursor, next.cursor);
    t.setSelection({ start: next.cursor, end: next.cursor });
  }

  function applyMarkdown(action: MarkdownAction) {
    const t = activeMdTarget();
    if (!t) return;

    if (action.kind === "wrap" && (action.left === "**" || action.left === "*")) {
      t.handle?.focus();
      if (action.left === "**") t.handle?.toggleBold();
      else t.handle?.toggleItalic();
      return;
    }

    applyComputed(t, insertMarkdown(t.text, t.selection, action));
  }

  /* ─── Command injection ─────────────────────────────────────────────
     Selecting a palette command inserts `/fix ` at the cursor of the active
     dispatch field. The user types the argument after it; on Send the leading
     command segment fires in isolation with the command's system prompt. */
  function injectCommand(name: string) {
    const t = activeMdTarget();
    if (!t) return;
    applyComputed(t, insertText(t.text, t.selection, `${name} `));
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
  function handleRetry(idx: number, failedRun: PersistedRun) {
    // Retry means "continue THIS response", not "add another one". Drop the
    // failed run from history first so the re-dispatch streams into the same
    // slot instead of stacking a second block below it. Don't reuse the
    // sessionId — Claude likely never established one when the run errored.
    //
    // We pass the prompt directly via the override path on handleSend
    // instead of setBody+setTimeout — that broke for FOLLOW-UP retries
    // because nextPromptSource reads body OR lastFollowUp (never both).
    if (isStreaming) return;
    setInflight(null);
    removeRun(idx);
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

  // Live markdown styling for the editable inputs (body + follow-ups).
  const liveMdTheme: LiveMarkdownTheme = useMemo(
    () => ({
      ink: inkColor,
      subtle: subtleColor,
      accent,
      surfaceChip,
    }),
    [inkColor, subtleColor, accent, surfaceChip],
  );

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
              <WendWordmark
                height={18}
                inkColor={inkColor}
                counterColor={canvas}
              />
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

        {/* ─── Dev-only config hint ──────────────────────────────────────
            Shown only in development when the daemon env vars are missing.
            A normal unpaired user is NOT in an error state — they just
            haven't connected a Mac yet; the send action surfaces a
            friendly "No Mac paired" message in that case. */}
        {__DEV__ && !daemonConfigured ? (
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
        >
          <TextInput
            value={title}
            onChangeText={(t) => {
              titleEditTokenRef.current += 1;
              setTitle(t);
            }}
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

          <Pressable
            style={{ minHeight: 80 }}
            onPress={() => bodyRef.current?.focus()}
          >
            <LiveMarkdownInput
              ref={bodyRef}
              value={body}
              onChangeText={setBody}
              theme={liveMdTheme}
              autoFocus
              placeholder={hasContent ? "Write a thought..." : ""}
              placeholderTextColor={placeholderColor}
              selectionColor={tokens["accent-caret"]}
              onSelectionChange={(e) =>
                setBodySelection(e.nativeEvent.selection)
              }
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
              }}
            />
          </Pressable>

          {/* Attachments added while composing the body render inline here,
              under the text they belong to — not pinned above everything. */}
          {bodyAttachments.length > 0 ? (
            <AttachmentStrip
              attachments={bodyAttachments}
              borderColor={borderColor}
              chipBg={surfaceChip}
              ink={inkColor}
              subtle={subtleColor}
              onOpen={handleAttachmentOpen}
              onRemove={handleAttachmentRemove}
            />
          ) : null}

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
                onOpenFile={(path) => openRunFile(path, run.toolCalls)}
              />
              <FollowUpInput
                value={run.followUp}
                onChangeText={(t) => updateRunFollowUp(idx, t)}
                onSelectionChange={
                  idx === lastRunIdx
                    ? (sel) => setFollowUpSelection(sel)
                    : undefined
                }
                placeholder="Ask a follow-up..."
                placeholderColor={placeholderColor}
                inkColor={inkColor}
                caretColor={tokens["accent-caret"]}
                mdTheme={liveMdTheme}
                inputRef={(r) => {
                  followUpRefs.current[idx] = r;
                }}
                isLast={idx === lastRunIdx}
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
              {/* Attachments added while composing THIS follow-up render
                  right under it — inline with the conversation flow. */}
              {attachmentsForRun(idx).length > 0 ? (
                <AttachmentStrip
                  attachments={attachmentsForRun(idx)}
                  borderColor={borderColor}
                  chipBg={surfaceChip}
                  ink={inkColor}
                  subtle={subtleColor}
                  onOpen={handleAttachmentOpen}
                  onRemove={handleAttachmentRemove}
                />
              ) : null}
            </View>
          ))}

          {/* The in-flight run (no PersistedRun yet) — same visual, with
              streaming text and a stop button in the header. */}
          {inflight ? (
            <AgentRunBlock
              state={inflightToBlockState(inflight)}
              onStop={handleStop}
              projectName={inflight.routeName || projectBasename(noteCwd)}
              onOpenFile={(path) => openRunFile(path, inflight.toolCalls)}
              reconnecting={inflight.reconnecting}
            />
          ) : null}
        </ScrollView>

        {/* ─── Top-edge reveal strip (S1 only) ─────────────────────────
            Outer View owns the absolute layout — NativeWind/Pressable
            interaction bug: layout props inside a function-callback
            style are silently dropped on Android, so the hit area
            ended up somewhere wrong. Inner Pressable carries a STATIC
            style only — never a function. */}
        {!showTopBar ? (
          <View
            pointerEvents="box-none"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: REVEAL_STRIP_HEIGHT,
              zIndex: 50,
            }}
          >
            <Pressable
              onPress={revealTopBar}
              accessibilityRole="button"
              accessibilityLabel="Show top bar"
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: borderColor,
                  opacity: 0.55,
                }}
              />
            </Pressable>
          </View>
        ) : null}

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
            {/* Outer plain View owns ALL pill layout — Pressable
                function-callback styles drop layout/visual props on
                Android, so the tappable areas inside are Pressables
                with static styles only. */}
            <View
              style={{
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
              }}
            >
              <Pressable
                onPress={handleConfirmChip}
                accessibilityRole="button"
                accessibilityLabel="Send to Claude on Mac"
                style={{
                  flexShrink: 1,
                  flexGrow: 0,
                  marginRight: 10,
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{
                    fontFamily: "Inter-Medium",
                    fontSize: 13,
                    color: inkColor,
                  }}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  Send to Claude{dispatchSignal ? ` (${dispatchSignal})` : ""} on Mac
                </Text>
              </Pressable>
              <Pressable
                onPress={handleDismissChip}
                accessibilityRole="button"
                accessibilityLabel="Dismiss suggestion"
                hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                android_ripple={ANDROID_ICON_RIPPLE}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: 4,
                  flexShrink: 0,
                }}
              >
                <XIcon size={16} color={subtleColor} weight="bold" />
              </Pressable>
              <Pressable
                onPress={handleConfirmChip}
                accessibilityRole="button"
                accessibilityLabel="Send to Claude on Mac"
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
              </Pressable>
            </View>
          </Animated.View>
        ) : null}

        {/* ─── Keyboard toolbar ─────────────────────────────────────────
            Two-part layout:
              [ formatting (horizontal scroll) | attach | send ]
            Formatting inserts markdown at the cursor (line-leading
            prefixes for headings/lists/quotes; wrappers for bold/italic/
            code/link). The target field is the body for the first send,
            otherwise the last follow-up — same routing as handleSend.
            Send stays as the prominent right-edge ember pill.

            Always rendered — including on the blank canvas — so attach
            (and send) are reachable before the user has typed anything.
            This toolbar send is the ONLY send affordance; the old S1
            floating FAB and the inline follow-up send are gone. */}
        {(
          <Animated.View
            entering={SlideInDown.duration(220)}
            exiting={SlideOutDown.duration(160)}
            style={{
              minHeight: TOOLBAR_HEIGHT,
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: 8,
              paddingRight: 12,
              paddingVertical: 6,
              borderTopWidth: 1,
              borderTopColor: borderColor,
              backgroundColor: canvas,
              gap: 8,
            }}
          >
            {/* Formatting group — scrolls horizontally because there are
                more buttons than fit on a phone width. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                alignItems: "center",
                gap: 2,
                paddingRight: 4,
              }}
              style={{ flex: 1 }}
            >
              <MarkdownButton
                accessibilityLabel="Heading 1"
                onPress={() => applyMarkdown(MARKDOWN_ACTIONS.h1)}
                icon={
                  <TextHOneIcon size={20} color={subtleColor} weight="regular" />
                }
              />
              <MarkdownButton
                accessibilityLabel="Heading 2"
                onPress={() => applyMarkdown(MARKDOWN_ACTIONS.h2)}
                icon={
                  <TextHTwoIcon size={20} color={subtleColor} weight="regular" />
                }
              />
              <MarkdownButton
                accessibilityLabel="Heading 3"
                onPress={() => applyMarkdown(MARKDOWN_ACTIONS.h3)}
                icon={
                  <TextHThreeIcon
                    size={20}
                    color={subtleColor}
                    weight="regular"
                  />
                }
              />
              <ToolbarDivider color={borderColor} />
              <MarkdownButton
                accessibilityLabel="Bold"
                onPress={() => applyMarkdown(MARKDOWN_ACTIONS.bold)}
                icon={<TextBIcon size={20} color={subtleColor} weight="bold" />}
              />
              <MarkdownButton
                accessibilityLabel="Italic"
                onPress={() => applyMarkdown(MARKDOWN_ACTIONS.italic)}
                icon={
                  <TextItalicIcon
                    size={20}
                    color={subtleColor}
                    weight="regular"
                  />
                }
              />
              <MarkdownButton
                accessibilityLabel="Inline code"
                onPress={() => applyMarkdown(MARKDOWN_ACTIONS.code)}
                icon={<CodeIcon size={20} color={subtleColor} weight="regular" />}
              />
              <ToolbarDivider color={borderColor} />
              <MarkdownButton
                accessibilityLabel="Bulleted list"
                onPress={() => applyMarkdown(MARKDOWN_ACTIONS.bullet)}
                icon={
                  <ListBulletsIcon
                    size={20}
                    color={subtleColor}
                    weight="regular"
                  />
                }
              />
              <MarkdownButton
                accessibilityLabel="Numbered list"
                onPress={() => applyMarkdown(MARKDOWN_ACTIONS.numbered)}
                icon={
                  <ListNumbersIcon
                    size={20}
                    color={subtleColor}
                    weight="regular"
                  />
                }
              />
              <MarkdownButton
                accessibilityLabel="Quote"
                onPress={() => applyMarkdown(MARKDOWN_ACTIONS.quote)}
                icon={
                  <QuotesIcon size={20} color={subtleColor} weight="regular" />
                }
              />
              <MarkdownButton
                accessibilityLabel="Link"
                onPress={() => applyMarkdown(MARKDOWN_ACTIONS.link)}
                icon={
                  <LinkSimpleIcon
                    size={20}
                    color={subtleColor}
                    weight="regular"
                  />
                }
              />
            </ScrollView>

            {/* MD hint chip — names the markdown block the cursor sits in,
                complementing the live-rendered styling in the input. */}
            {activeMarkdownHint ? (
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: `${accent}1F`,
                  flexShrink: 0,
                }}
              >
                <Text
                  style={{
                    fontFamily: "JetBrainsMono-Medium",
                    fontSize: 10,
                    letterSpacing: 0.4,
                    color: accent,
                  }}
                >
                  MD · {activeMarkdownHint}
                </Text>
              </View>
            ) : null}

            {/* Attach — sits in its own group, with a hairline divider
                separating the formatting group from action affordances. */}
            <View
              style={{
                width: 1,
                height: 24,
                backgroundColor: borderColor,
              }}
            />
            <View style={{ width: 40, height: 40, borderRadius: 10, overflow: "hidden" }}>
              <Pressable
                onPress={() => {
                  if (!resolvedNoteId) return;
                  Keyboard.dismiss();
                  setAttachmentPickerOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Attach file"
                android_ripple={ANDROID_ICON_RIPPLE}
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <PaperclipIcon
                  size={20}
                  color={attachments.length > 0 ? accent : subtleColor}
                  weight={attachments.length > 0 ? "fill" : "regular"}
                />
              </Pressable>
            </View>

            {/* Send — outer View owns sizing + background color (these
                drop on Android inside a Pressable function-callback
                style on some devices, which is how the icon ended up
                rendering white-on-white). Inner Pressable carries a
                STATIC centering style; press feedback is the ripple. */}
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                overflow: "hidden",
                backgroundColor: isStreaming || canSend ? accent : surfaceChip,
                opacity: isStreaming || canSend ? 1 : 0.6,
                shadowColor: "#000",
                shadowOpacity: canSend ? 0.18 : 0,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 2 },
                elevation: canSend ? 3 : 0,
              }}
            >
              <Pressable
                onPress={isStreaming ? handleStop : () => void handleSend()}
                onLongPress={
                  isStreaming || dispatchMode !== "cloud"
                    ? undefined
                    : () => setRepoPickerOpen(true)
                }
                disabled={!isStreaming && !canSend}
                accessibilityRole="button"
                accessibilityState={{ disabled: !isStreaming && !canSend }}
                accessibilityLabel={isStreaming ? "Stop dispatch" : "Send note"}
                android_ripple={Platform.select({
                  android: {
                    color: "rgba(255,255,255,0.20)",
                    borderless: false,
                    foreground: true,
                  } as const,
                  default: undefined,
                })}
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                }}
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
            </View>
          </Animated.View>
        )}

        {/* ─── First-note coachmark (S1 only — blank canvas) ─────── */}
        {shouldShowCoachmark ? (
          <Pressable
            // Tap anywhere dismisses permanently (per design). The toolbar
            // sits below this overlay's hit region only while the coachmark
            // is up — first tap dismisses, then the toolbar is interactive.
            onPress={dismissCoachmark}
            style={{
              position: "absolute",
              right: 0,
              left: 0,
              bottom: TOOLBAR_HEIGHT,
              top: 0,
            }}
          >
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                right: 16,
                bottom: 8,
                alignItems: "flex-end",
              }}
            >
              <FirstNoteCoachmark />
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
        onConnectAnthropic={() => setConnectAnthropicOpen(true)}
        onConnectCloudGitHub={() => setCloudGitHubOpen(true)}
        onShowComingSoon={(label) => {
          // Lightweight feedback for non-functional rows (Profile, Subscription).
          // Replace with real destinations as they ship.
          Alert.alert(label, `${label} is coming soon.`);
        }}
      />
      <ConnectAnthropicSheet
        open={connectAnthropicOpen}
        onClose={() => setConnectAnthropicOpen(false)}
      />
      <CloudGitHubSheet
        open={cloudGitHubOpen}
        onClose={() => setCloudGitHubOpen(false)}
      />
      <CloudRepoPickerSheet
        open={repoPickerOpen}
        currentRepo={noteCwd}
        onClose={() => setRepoPickerOpen(false)}
        onPick={(fullName) => {
          setCwd(fullName);
          void saveNote({ id: resolvedNoteId, cwd: fullName });
        }}
      />
      <PaywallSheet
        open={paywall !== null}
        reason={paywall}
        onClose={() => setPaywall(null)}
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
        onInjectCommand={injectCommand}
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
        content={fileViewer.content}
        editExcerpt={fileViewer.editExcerpt}
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

/** Material-style ripple for icon-shaped buttons (top bar, toolbar).
 *  borderless: true makes it a circular ripple that spills past the icon
 *  bounds slightly — the standard Android icon-button look. We tint with
 *  the accent at low opacity so the ripple reads as "branded" without
 *  overwhelming the iOS scale/opacity feedback (which still runs alongside
 *  on Android, harmlessly). `undefined` on iOS leaves behavior unchanged. */
const ANDROID_ICON_RIPPLE = Platform.select({
  android: { color: "rgba(216,90,60,0.20)", borderless: true } as const,
  default: undefined,
});

function IconButton(props: {
  icon: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <View style={{ width: 36, height: 36, borderRadius: 8, overflow: "hidden" }}>
      <Pressable
        onPress={props.onPress}
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel}
        android_ripple={ANDROID_ICON_RIPPLE}
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {props.icon}
      </Pressable>
    </View>
  );
}

/** Square 40×40 markdown-insert button. Spring-press feedback + hairline
 *  rounded background on press so taps feel deliberate. Used inside the
 *  horizontally-scrolling formatting row in the keyboard toolbar. */
function MarkdownButton(props: {
  onPress: () => void;
  accessibilityLabel: string;
  icon: React.ReactNode;
}) {
  return (
    <View style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden" }}>
      <Pressable
        onPress={props.onPress}
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel}
        hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
        android_ripple={ANDROID_ICON_RIPPLE}
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {props.icon}
      </Pressable>
    </View>
  );
}

/** Vertical hairline divider between toolbar groups. */
function ToolbarDivider(props: { color: string }) {
  return (
    <View
      style={{
        width: 1,
        height: 18,
        backgroundColor: props.color,
        marginHorizontal: 4,
        opacity: 0.7,
      }}
    />
  );
}

function FollowUpInput(props: {
  value: string;
  onChangeText: (s: string) => void;
  /** Selection mirror — only wired up for the last follow-up, since that's
   *  the only one the toolbar can insert into. */
  onSelectionChange?: (sel: { start: number; end: number }) => void;
  placeholder: string;
  placeholderColor: string;
  inkColor: string;
  caretColor: string;
  mdTheme: LiveMarkdownTheme;
  inputRef: (r: LiveMarkdownInputHandle | null) => void;
  isLast: boolean;
  onFocus: () => void;
}) {
  // No inline send button here — the keyboard toolbar (always visible) owns
  // the single send affordance. Having both confused users with two sends.
  return (
    <View
      style={{
        marginTop: 16,
        marginBottom: props.isLast ? 0 : 4,
      }}
    >
      <LiveMarkdownInput
        ref={props.inputRef}
        value={props.value}
        onChangeText={props.onChangeText}
        theme={props.mdTheme}
        onFocus={props.onFocus}
        onSelectionChange={
          props.onSelectionChange
            ? (e) => props.onSelectionChange!(e.nativeEvent.selection)
            : undefined
        }
        placeholder={props.placeholder}
        placeholderTextColor={props.placeholderColor}
        selectionColor={props.caretColor}
        scrollEnabled={false}
        style={{
          minHeight: 40,
          fontFamily: "Inter-Regular",
          fontSize: typography.body.fontSize,
          lineHeight: typography.body.lineHeight,
          letterSpacing: -0.187,
          color: props.inkColor,
          padding: 0,
          margin: 0,
        }}
      />
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
      android_ripple={ANDROID_ICON_RIPPLE}
      style={{
        width: 56,
        height: 56,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: props.borderColor,
        backgroundColor: props.chipBg,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
      }}
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
    links: run.links,
    warnings: run.warnings,
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
    warnings: run.warnings,
    durationMs: run.durationMs,
    costUsd: run.costUsd,
    error: run.error,
  };
}

/* ─── Markdown insertion ──────────────────────────────────────────────
   Two insertion styles, matched to how each markdown element wants to
   live in the document:

     - "linePrefix" — headings, bullets, numbered, quote. The prefix
       belongs at the START of a line. We find the line containing the
       cursor and prepend the prefix there (idempotent-ish: if the user
       hits H1 twice we stack `# # ` — that's fine, the user can backspace
       and it matches how desktop editors behave).
     - "wrap"       — bold, italic, code, link. If the user has selected
       text, we wrap it. Otherwise we insert the marker pair and drop the
       cursor in the middle so they can start typing.

   We compute and return the resulting text + final cursor position so
   the caller can mirror selection state forward. */

type MarkdownAction =
  | { kind: "linePrefix"; prefix: string }
  | { kind: "wrap"; left: string; right: string; placeholder?: string }
  | { kind: "link" };

const MARKDOWN_ACTIONS: Record<string, MarkdownAction> = {
  h1: { kind: "linePrefix", prefix: "# " },
  h2: { kind: "linePrefix", prefix: "## " },
  h3: { kind: "linePrefix", prefix: "### " },
  bullet: { kind: "linePrefix", prefix: "- " },
  numbered: { kind: "linePrefix", prefix: "1. " },
  quote: { kind: "linePrefix", prefix: "> " },
  bold: { kind: "wrap", left: "**", right: "**", placeholder: "bold" },
  italic: { kind: "wrap", left: "*", right: "*", placeholder: "italic" },
  code: { kind: "wrap", left: "`", right: "`", placeholder: "code" },
  link: { kind: "link" },
};

interface InsertResult {
  text: string;
  cursor: number;
}

function insertText(
  current: string,
  selection: { start: number; end: number },
  snippet: string,
): InsertResult {
  const start = Math.max(0, Math.min(selection.start, current.length));
  const end = Math.max(start, Math.min(selection.end, current.length));
  const text = current.slice(0, start) + snippet + current.slice(end);
  return { text, cursor: start + snippet.length };
}

function insertMarkdown(
  current: string,
  selection: { start: number; end: number },
  action: MarkdownAction,
): InsertResult {
  const start = Math.max(0, Math.min(selection.start, current.length));
  const end = Math.max(start, Math.min(selection.end, current.length));

  if (action.kind === "linePrefix") {
    // Find the start of the current line.
    let lineStart = start;
    while (lineStart > 0 && current[lineStart - 1] !== "\n") lineStart--;
    const before = current.slice(0, lineStart);
    const after = current.slice(lineStart);
    const text = `${before}${action.prefix}${after}`;
    return { text, cursor: lineStart + action.prefix.length };
  }

  if (action.kind === "wrap") {
    const selected = current.slice(start, end);
    if (selected.length > 0) {
      const text =
        current.slice(0, start) +
        action.left +
        selected +
        action.right +
        current.slice(end);
      return {
        text,
        cursor: end + action.left.length + action.right.length,
      };
    }
    const placeholder = action.placeholder ?? "";
    const inner = placeholder;
    const text =
      current.slice(0, start) +
      action.left +
      inner +
      action.right +
      current.slice(end);
    // Drop cursor right after the left marker so the user can start
    // typing over the placeholder. (We don't pre-select it because RN's
    // controlled selection across iOS/Android is finicky.)
    return { text, cursor: start + action.left.length };
  }

  // Link: `[text](url)`. If text selected, use it as the label.
  const selected = current.slice(start, end);
  const label = selected.length > 0 ? selected : "text";
  const insertion = `[${label}](url)`;
  const text = current.slice(0, start) + insertion + current.slice(end);
  // Cursor lands on "url" so the user can replace it immediately.
  const urlStart = start + label.length + 3; // "[" + label + "](" → 3 chars after label
  return { text, cursor: urlStart };
}

/** Race-friendly auto-title generation. POSTs directly to `/run` instead of
 *  going through useDispatch so it doesn't collide with the main dispatch's
 *  abort controller / running flag. Returns null when the daemon is
 *  un-configured, the network fails, or Claude returns nothing useful. */
async function generateAutoTitle(args: {
  url: string;
  token: string;
  body: string;
}): Promise<string | null> {
  if (!args.url || !args.token) return null;
  const excerpt = args.body.trim().slice(0, 500);
  if (excerpt.length === 0) return null;
  const prompt = `Generate a 2-4 word title (no quotes, no period, never more than 4 words) for this note body:\n\n"""\n${excerpt}\n"""\n\nReply with the title only.`;
  try {
    const { fetch: expoFetch } = await import("expo/fetch");
    const url = `${args.url.replace(/\/$/, "")}/run?t=${encodeURIComponent(args.token)}`;
    const res = await expoFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let title = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const frame of frames) {
        const dataLine = frame
          .split("\n")
          .find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const payload = dataLine.slice(dataLine.startsWith("data: ") ? 6 : 5).trim();
        if (!payload) continue;
        try {
          const json = JSON.parse(payload);
          if (json.type === "assistant" && Array.isArray(json.message?.content)) {
            for (const c of json.message.content) {
              if (c.type === "text" && typeof c.text === "string") title += c.text;
            }
          }
        } catch {
          // skip non-JSON frames
        }
      }
    }
    const cleaned = title
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\.+$/, "")
      .replace(/\s+/g, " ")
      // Hard cap at 4 words — the prompt asks, this enforces.
      .split(" ")
      .slice(0, 4)
      .join(" ")
      .slice(0, 60);
    return cleaned.length > 0 ? cleaned : null;
  } catch {
    return null;
  }
}

/** Detect the markdown token (if any) on the line containing the cursor.
 *  Returns a short label for the toolbar hint chip. */
function detectMarkdownToken(text: string, cursor: number): string | null {
  if (text.length === 0) return null;
  const c = Math.max(0, Math.min(cursor, text.length));
  let lineStart = c;
  while (lineStart > 0 && text[lineStart - 1] !== "\n") lineStart--;
  let lineEnd = c;
  while (lineEnd < text.length && text[lineEnd] !== "\n") lineEnd++;
  const line = text.slice(lineStart, lineEnd);
  if (/^###\s/.test(line)) return "H3";
  if (/^##\s/.test(line)) return "H2";
  if (/^#\s/.test(line)) return "H1";
  if (/^>\s?/.test(line)) return "Quote";
  if (/^-\s/.test(line) || /^\*\s/.test(line)) return "List";
  if (/^\d+\.\s/.test(line)) return "List";
  if (/^```/.test(line)) return "Code";
  return null;
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
