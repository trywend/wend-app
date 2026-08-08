/**
 * Wend — notes persistence module (Phase 2: LOCAL-ONLY).
 *
 * ============================================================================
 * PHASE 2 SCOPE — local-first, no server sync.
 * ============================================================================
 *
 * There is no backend deployed for notes CRUD yet. The Expo client cannot
 * safely talk to Neon directly (would expose DATABASE_URL bundled in the app).
 * For Phase 2 we persist everything to AsyncStorage on the device and call
 * it done. Server sync is intentionally deferred — it lands in a later phase
 * once we have an HTTP backend (most likely co-deployed with Better Auth's
 * `/api/auth` endpoint around Phase 4).
 *
 * The API surface below is designed to be a drop-in target for that future
 * server sync layer:
 *
 *   - Every function is already async (signatures don't change when the
 *     implementation swaps to fetch).
 *   - IDs are uuid v4 generated client-side via expo-crypto.randomUUID(),
 *     matching the Drizzle `notes.id` / `note_blocks.id` `uuid` columns —
 *     no ID translation needed when records sync up to Postgres.
 *   - Field names + shapes mirror the Drizzle schema (`src/db/schema.ts`)
 *     with two deliberate translations for client convenience:
 *       (a) timestamps are `number` (ms epoch) instead of `Date` — simpler
 *           to serialize to/from AsyncStorage; convert at the sync boundary.
 *       (b) the body of a note is stored as a single `user_text` block
 *           internally (`note_blocks` row with position 0). The screen sees
 *           a flat `bodyText: string`. This keeps the data model
 *           forward-compatible with multi-block notes (agent_run / code /
 *           diff / file_list blocks come later) without a future refactor.
 *
 * When server sync lands it will need:
 *   1. A backend with notes + note_blocks CRUD endpoints (probably tRPC or
 *      a thin REST surface on the same host as Better Auth).
 *   2. Conflict resolution — v1 is last-write-wins by `updatedAt`. Good
 *      enough for a single-user multi-device case; not enough for true
 *      collaborative editing (out of scope until Phase 7+).
 *   3. Optimistic updates with rollback on failure — write locally first,
 *      enqueue a sync job, reconcile when the server responds.
 *
 * None of that is built here. This file is purely the local persistence
 * layer with a forward-compatible shape.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

import type { Attachment } from "./attachments";
import { bumpNotesVersion } from "@/store/notesCacheSlice";

/* ===========================================================================
   TYPES — plain client shapes, no Drizzle/Neon imports.
   =========================================================================== */

export type NoteBlockKind = "user_text"; // Phase 2 only; widens to schema enum later.

/**
 * A downloadable deliverable produced by a run. Shape mirrors the shared
 * daemon contract (see wend-contract.md § Artifact shape). Bytes are served
 * at `GET /run/<runId>/artifact/<id>?t=<token>` on the paired daemon; the
 * virtual `answer` kind is served from the stored run text.
 */
export type ArtifactKind = "diff" | "file" | "html" | "answer" | "image";

export interface Artifact {
  /** Stable within a run: "diff" | "answer" | file-basename-slug. */
  id: string;
  /** Display name — "constants.ts", "draft.md", "Report". */
  name: string;
  kind: ArtifactKind;
  /** "text/x-patch", "text/markdown", "text/html", "image/png", … */
  mime: string;
  /** Bytes. 0 allowed for the virtual answer artifact. */
  size: number;
}

export interface Note {
  id: string;
  userId: string;
  title: string;
  /** Per-note dispatch target (absolute path on the user's Mac). When null,
   *  the dispatch hook falls back to EXPO_PUBLIC_DAEMON_CWD. Set per-note via
   *  the project picker — keeps a note about the landing repo running in the
   *  landing repo, not whatever the global default is. Phase 4 will derive
   *  this automatically from content via the daemon-side project indexer. */
  cwd: string | null;
  /** ms epoch — converted to/from Postgres `timestamptz` at the sync boundary. */
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  /**
   * Local-only attachments (v1). Bytes live in
   * `Paths.document/wend-attachments/<noteId>/`; this list is just the
   * metadata so we can re-render chips and resolve the file later. Defaults
   * to an empty array — older persisted notes get backfilled on read.
   */
  attachments?: Attachment[];
}

/**
 * A completed agent run, persisted inline inside the body block.
 *
 * Phase 2 keeps runs glued to the note's body block (single AsyncStorage key
 * per note) rather than separate `note_blocks` rows so we don't fan out
 * storage I/O while server sync is still missing. When the Drizzle-backed
 * sync layer lands, each run gets promoted to its own `note_blocks` row
 * (kind="agent_run") and `followUp` becomes the next "user_text" row — the
 * shape here mirrors that future schema so the migration is mechanical.
 */
export interface PersistedRun {
  id: string;
  /** What got sent to Claude — kept for display/debug. */
  prompt: string;
  /** The assistant's full text response (interim reasoning + final answer),
   *  in stream order. Kept for expansion, file/link extraction, and back-compat
   *  with rows persisted before the split landed. */
  response: string;
  /** Interim "thinking" text — assistant prose emitted between tool calls,
   *  joined in order. Hidden by default on the phone; revealed on tap. Absent
   *  on rows persisted before the split (fall back to empty). */
  reasoning?: string;
  /** The final deliverable text — the trailing assistant segment after the
   *  last tool call. This is what the note produced, shown as the run's output.
   *  Absent on old rows / cross-device catch-up (fall back to `response`). */
  answer?: string;
  /** Claude's session_id, for --resume on the next run. */
  sessionId: string | null;
  status: "done" | "error";
  durationMs: number;
  costUsd: number;
  /** Total tokens (input + output + cache) for the run. Shown instead of
   *  cost. Optional for back-compat with rows persisted before it landed. */
  tokens?: number;
  toolUses: string[];
  /** Richer per-call records (name + input) when captured. Optional for
   *  back-compat with rows persisted before the structured shape landed. */
  toolCalls?: Array<{ name: string; input?: unknown }>;
  /** Deliverable URLs the run produced (PRs, dashboards). Populated by
   *  cloud catch-up when the backend reports them. */
  links?: string[];
  /** stderr lines claude emitted during a run that still succeeded —
   *  rendered as a collapsed "N warnings" line, never as a failure. */
  warnings?: string[];
  /** Downloadable deliverables the run produced — diff, files, html, the
   *  virtual answer. Served by the paired daemon. Optional for back-compat
   *  with rows persisted before deliverables landed (default undefined). */
  artifacts?: Artifact[];
  error: string | null;
  /** User text typed after this run — becomes the prompt for the NEXT run. */
  followUp: string;
  createdAt: number;
}

export interface NoteBlock {
  id: string;
  noteId: string;
  kind: NoteBlockKind;
  /** jsonb-equivalent. Body text + chronological completed runs. */
  content: { text: string; runs?: PersistedRun[] };
  position: number;
  createdAt: number;
}

/* ===========================================================================
   STORAGE KEY LAYOUT

   - `wend.notes.index`           → JSON-serialized Note[] (metadata only,
                                    no body text). Small and read often.
   - `wend.notes.body.<noteId>`   → the user_text block as a JSON string.
                                    Separated from the index so a keystroke
                                    save only rewrites that one note's body,
                                    not the whole index array.

   Why one index instead of one record per note: the list screen needs to
   iterate notes for the current user. AsyncStorage has no scan/prefix API,
   so we'd have to maintain an index of keys anyway — might as well keep the
   metadata in it directly.
   =========================================================================== */

const INDEX_KEY = "wend.notes.index";
const BODY_KEY_PREFIX = "wend.notes.body.";
const bodyKey = (noteId: string) => `${BODY_KEY_PREFIX}${noteId}`;

/* ===========================================================================
   LOW-LEVEL HELPERS

   Every AsyncStorage call is wrapped in try/catch. RN AsyncStorage is
   reliable but does occasionally hiccup (corrupted backing file on Android,
   process kill mid-write). The UI should degrade gracefully — a failed
   read returns null / empty list; a failed write logs and moves on. The
   user's next keystroke triggers another save attempt anyway.
   =========================================================================== */

async function readIndex(): Promise<Note[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Backfill missing fields so older persisted notes don't break the
    // current schema (cwd was added in smart-routing v1).
    return parsed
      .map((p) => normalizeNote(p))
      .filter((n): n is Note => n !== null);
  } catch (err) {
    console.warn("[notes-storage] readIndex failed:", err);
    return [];
  }
}

async function writeIndex(notes: Note[]): Promise<void> {
  try {
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(notes));
  } catch (err) {
    console.warn("[notes-storage] writeIndex failed:", err);
  }
}

async function readBodyBlock(noteId: string): Promise<NoteBlock | null> {
  try {
    const raw = await AsyncStorage.getItem(bodyKey(noteId));
    if (!raw) return null;
    return JSON.parse(raw) as NoteBlock;
  } catch (err) {
    console.warn("[notes-storage] readBodyBlock failed:", err);
    return null;
  }
}

async function writeBodyBlock(block: NoteBlock): Promise<void> {
  try {
    await AsyncStorage.setItem(bodyKey(block.noteId), JSON.stringify(block));
  } catch (err) {
    console.warn("[notes-storage] writeBodyBlock failed:", err);
  }
}

async function removeBodyBlock(noteId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(bodyKey(noteId));
  } catch (err) {
    console.warn("[notes-storage] removeBodyBlock failed:", err);
  }
}

function newId(): string {
  return Crypto.randomUUID();
}

function makeEmptyBlock(noteId: string): NoteBlock {
  const now = Date.now();
  return {
    id: newId(),
    noteId,
    kind: "user_text",
    content: { text: "" },
    position: 0,
    createdAt: now,
  };
}

function makeEmptyNote(userId: string): Note {
  const now = Date.now();
  return {
    id: newId(),
    userId,
    title: "",
    cwd: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    attachments: [],
  };
}

/**
 * Backfill any persisted note that pre-dates the `cwd` field. Reading old
 * data shouldn't crash; treat missing as null. Centralized here so every
 * read path runs through it.
 */
function normalizeNote(raw: unknown): Note | null {
  if (typeof raw !== "object" || raw === null) return null;
  const n = raw as Partial<Note> & Record<string, unknown>;
  if (typeof n.id !== "string" || typeof n.userId !== "string") return null;
  return {
    id: n.id,
    userId: n.userId,
    title: typeof n.title === "string" ? n.title : "",
    cwd: typeof n.cwd === "string" ? n.cwd : null,
    createdAt: typeof n.createdAt === "number" ? n.createdAt : Date.now(),
    updatedAt: typeof n.updatedAt === "number" ? n.updatedAt : Date.now(),
    archivedAt: typeof n.archivedAt === "number" ? n.archivedAt : null,
    attachments: Array.isArray(n.attachments)
      ? (n.attachments as Attachment[])
      : [],
  };
}

/* ===========================================================================
   PUBLIC API
   =========================================================================== */

/**
 * Resolve the current draft note for a user, creating one if no usable
 * draft exists.
 *
 * "Draft" definition for Phase 2: the most-recently-updated non-archived
 * note for this user. If none exists, we create a fresh empty note.
 *
 * For the integration turn — if you want "open a brand new note" behavior
 * (independent of the most-recent draft), call `createNote(userId)` instead
 * (see below). loadOrCreateDraftNote is intended for the editor's default
 * landing state.
 */
export async function loadOrCreateDraftNote(
  userId: string,
): Promise<{ note: Note; bodyText: string; runs: PersistedRun[] }> {
  const all = await readIndex();
  const mine = all
    .filter((n) => n.userId === userId && n.archivedAt == null)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (mine.length > 0) {
    const existing = mine[0]!;
    // Idle-threshold gate: if the most recent draft hasn't been touched
    // for longer than IDLE_NEW_DRAFT_MS, drop it and open a fresh blank
    // note instead. The user is starting a new thought, not resuming.
    // Default: 15 minutes. Override via the SESSION_IDLE_MS env so the
    // dev build can crank this lower for testing.
    const idleMs = Date.now() - existing.updatedAt;
    if (idleMs < IDLE_NEW_DRAFT_MS) {
      const block = await readBodyBlock(existing.id);
      // Sweep abandoned blank drafts (and backfill the existing pile), but
      // keep the one we're resuming.
      await pruneEmptyNotes(userId, existing.id);
      return {
        note: existing,
        bodyText: block?.content.text ?? "",
        runs: block?.content.runs ?? [],
      };
    }
    // Stale draft → fall through to creating a fresh one. The old one
    // stays in the inbox; we just don't auto-resume it on cold launch.
  }

  // Nothing to load (or stale) — create a fresh empty note + body block.
  const note = makeEmptyNote(userId);
  const block = makeEmptyBlock(note.id);
  await writeIndex([note, ...all]);
  await writeBodyBlock(block);
  // Sweep abandoned blank drafts (and backfill the pile), keeping this fresh
  // one so the editor has something to land on.
  await pruneEmptyNotes(userId, note.id);
  bumpNotesVersion();
  return { note, bodyText: "", runs: [] };
}

/** Default cold-launch idle threshold for auto-resuming the last draft.
 *  After this much idle time, loadOrCreateDraftNote skips the last draft
 *  and creates a fresh one. The old draft stays in the inbox. */
const IDLE_NEW_DRAFT_MS = (() => {
  // EXPO_PUBLIC_SESSION_IDLE_MS lets dev builds force a shorter idle for
  // testing. Numeric env vars come through as strings in Expo.
  const raw = process.env.EXPO_PUBLIC_SESSION_IDLE_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15 * 60 * 1000;
})();

/**
 * Create a brand-new empty note for the user (always a new record).
 * Useful for an explicit "+ new note" action.
 */
export async function createNote(
  userId: string,
): Promise<{ note: Note; bodyText: string; runs: PersistedRun[] }> {
  const note = makeEmptyNote(userId);
  const block = makeEmptyBlock(note.id);
  const all = await readIndex();
  await writeIndex([note, ...all]);
  await writeBodyBlock(block);
  // Tapping "+ new note" repeatedly shouldn't leave a trail of blank drafts —
  // prune the prior empties, keeping only this fresh one.
  await pruneEmptyNotes(userId, note.id);
  bumpNotesVersion();
  return { note, bodyText: "", runs: [] };
}

/**
 * Persist a title and/or body update for an existing note.
 *
 * Always bumps `updatedAt`. Title goes into the index; body goes into the
 * separate body key — independent writes so a keystroke save doesn't
 * rewrite the whole index.
 *
 * Note: this function itself is NOT debounced. Callers should debounce
 * (the `useNoteEditor` hook does). We intentionally keep this primitive
 * un-debounced so non-keystroke callers (e.g. blur, navigation away)
 * can flush immediately without waiting.
 */
export async function saveNote(args: {
  id: string;
  title?: string;
  bodyText?: string;
  runs?: PersistedRun[];
  cwd?: string | null;
  attachments?: Attachment[];
}): Promise<void> {
  const { id, title, bodyText, runs, cwd, attachments } = args;

  // Update index (title + cwd + attachments + updatedAt). One read-modify-write per save.
  const all = await readIndex();
  const idx = all.findIndex((n) => n.id === id);
  if (idx === -1) {
    console.warn(`[notes-storage] saveNote: note ${id} not found in index`);
    return;
  }
  const prev = all[idx]!;
  const next: Note = {
    ...prev,
    title: title !== undefined ? title : prev.title,
    cwd: cwd !== undefined ? cwd : prev.cwd,
    attachments:
      attachments !== undefined ? attachments : prev.attachments ?? [],
    updatedAt: Date.now(),
  };
  all[idx] = next;
  await writeIndex(all);

  // Update body block if any block-level field changed (text or runs). The
  // index write above already happened, so a failure here still leaves
  // title persisted.
  if (bodyText !== undefined || runs !== undefined) {
    const existing = await readBodyBlock(id);
    const base: NoteBlock = existing ?? makeEmptyBlock(id);
    const block: NoteBlock = {
      ...base,
      content: {
        text: bodyText !== undefined ? bodyText : base.content.text,
        runs: runs !== undefined ? runs : base.content.runs,
      },
    };
    await writeBodyBlock(block);
  }
  bumpNotesVersion();
}

/**
 * List notes owned by `userId`, most-recently-updated first.
 * Excludes archived notes unless `includeArchived` is true.
 */
export async function listNotes(
  userId: string,
  opts?: { includeArchived?: boolean },
): Promise<Note[]> {
  const all = await readIndex();
  const includeArchived = opts?.includeArchived ?? false;
  return all
    .filter((n) => n.userId === userId && (includeArchived || n.archivedAt == null))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Read a single note + its body text in one call.
 */
export async function getNote(
  id: string,
): Promise<{ note: Note; bodyText: string; runs: PersistedRun[] } | null> {
  const all = await readIndex();
  const note = all.find((n) => n.id === id);
  if (!note) return null;
  const block = await readBodyBlock(id);
  return {
    note,
    bodyText: block?.content.text ?? "",
    runs: block?.content.runs ?? [],
  };
}

/**
 * Soft-delete a note by setting `archivedAt = Date.now()`. The body block
 * is intentionally left in storage so an "unarchive" path could restore
 * it later (out of scope for Phase 2, but the data is preserved).
 */
export async function archiveNote(id: string): Promise<void> {
  const all = await readIndex();
  const idx = all.findIndex((n) => n.id === id);
  if (idx === -1) return;
  const now = Date.now();
  all[idx] = { ...all[idx]!, archivedAt: now, updatedAt: now };
  await writeIndex(all);
  bumpNotesVersion();
}

/**
 * Hard-delete a note + its body block. Not part of the required API but
 * exposed for completeness (e.g. wiping a corrupted draft). Server sync
 * will need a tombstone instead of an outright delete; that's a future
 * concern.
 */
export async function deleteNote(id: string): Promise<void> {
  const all = await readIndex();
  const next = all.filter((n) => n.id !== id);
  await writeIndex(next);
  await removeBodyBlock(id);
  bumpNotesVersion();
}

/**
 * Delete empty drafts — notes with no title, no body text, no runs, and no
 * attachments. The editor eagerly creates a note when it opens, so an
 * abandoned (never-typed) draft would otherwise linger in the inbox as
 * "Untitled" and accumulate over time. `exceptId` keeps the currently-open
 * draft alive. Also serves as a one-time backfill for the pile that already
 * built up. Returns the count removed.
 */
export async function pruneEmptyNotes(
  userId: string,
  exceptId?: string,
): Promise<number> {
  const all = await readIndex();
  const survivors: Note[] = [];
  const removed: string[] = [];
  for (const n of all) {
    if (
      n.userId !== userId ||
      n.archivedAt != null ||
      n.id === exceptId ||
      n.title.trim().length > 0 ||
      (n.attachments?.length ?? 0) > 0
    ) {
      survivors.push(n);
      continue;
    }
    const block = await readBodyBlock(n.id);
    const hasBody = (block?.content.text ?? "").trim().length > 0;
    const hasRuns = (block?.content.runs?.length ?? 0) > 0;
    if (hasBody || hasRuns) {
      survivors.push(n);
      continue;
    }
    removed.push(n.id);
  }
  if (removed.length > 0) {
    await writeIndex(survivors);
    for (const id of removed) await removeBodyBlock(id);
    bumpNotesVersion();
  }
  return removed.length;
}
