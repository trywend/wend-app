/**
 * Wend — buildPrompt.
 *
 * Deterministic, non-LLM prompt wrapper for note → `claude -p` dispatch.
 *
 * Users on mobile write SHORT, vague notes. "fix the bug", "what about
 * caching?", "/clear", "ABC-123 looks broken". Sent verbatim to `claude -p`
 * those produce mediocre responses because Claude has no idea what kind of
 * thing this is.
 *
 * We don't fabricate context (no fake repo state, no invented constraints —
 * that would hallucinate worse). We just add a tiny framing system prompt
 * tuned to the heuristic intent of the note. Tone is always "you got a note,
 * stay concise, don't over-elaborate".
 *
 * Five intents detected purely from the note text:
 *
 *   - slash    — note starts with `/[a-z]+`. Pass through VERBATIM. The
 *                Claude Code CLI handles `/clear`, `/model`, `/help`, etc.
 *                Wrapping these would break them.
 *   - ticket   — note contains a TICKET-123 token. Wrapper nudges Claude
 *                to look it up only if the rest of the note doesn't make
 *                sense without it.
 *   - question — note ends with `?` or starts with what/why/how/when/where
 *                /can/should/is/are/does/do/will. Wrapper asks for a
 *                concise answer.
 *   - task     — note contains action verbs (fix/add/remove/refactor/
 *                implement/test/build/update/run/check) or a file path.
 *                Wrapper asks Claude to do the work and report what changed.
 *   - idea     — fallback. Prose-y journaling. Wrapper asks Claude to
 *                engage as a thinking partner, NOT to do work uninvited.
 *
 * Follow-up turns (when opts.followUp + opts.sessionId are set) skip
 * wrapping entirely — `claude -p --resume <sessionId>` already has the
 * prior turn's context including the original framing.
 */

export interface BuiltPrompt {
  prompt: string;
  intent: "slash" | "ticket" | "question" | "task" | "idea";
  rawNote: string;
}

export interface BuildPromptOptions {
  /** True when continuing an existing session. Drops the wrapper. */
  followUp?: boolean;
  /** The Claude session id being resumed. Wrapper only drops when BOTH
   *  followUp is true and a sessionId is present — a follow-up flag without
   *  a session id is treated as a first turn (defensive). */
  sessionId?: string | null;
}

/* ─── Intent heuristics ─────────────────────────────────────────────────── */

const SLASH_RE = /^\/[a-z][a-z0-9-]*/i;
const TICKET_RE = /\b[A-Z]{2,}-\d+\b/;
const QUESTION_LEAD_RE = /^(what|why|how|when|where|can|should|is|are|does|do|will|would|could)\b/i;
const TASK_KEYWORDS = [
  "fix",
  "add",
  "remove",
  "delete",
  "refactor",
  "implement",
  "test",
  "build",
  "update",
  "run",
  "check",
  "rename",
  "move",
  "create",
  "write",
  "change",
  "make",
  "set up",
  "wire up",
  "hook up",
];
// Path-ish tokens: `src/foo`, `app/bar`, `./baz`, `packages/qux`. We match
// loosely — anything that looks like a relative source path counts as a
// task signal.
const PATH_RE = /(^|\s)(\.\/|src\/|app\/|packages\/|lib\/|components\/|tests?\/)\S+/i;

function detectIntent(note: string): BuiltPrompt["intent"] {
  const trimmed = note.trim();
  if (trimmed.length === 0) return "idea";

  if (SLASH_RE.test(trimmed)) return "slash";

  if (TICKET_RE.test(trimmed)) return "ticket";

  // Question detection: trailing `?` OR leading interrogative word.
  if (trimmed.endsWith("?") || QUESTION_LEAD_RE.test(trimmed)) {
    return "question";
  }

  // Task detection: any task keyword as a whole word, OR a file path.
  const lower = trimmed.toLowerCase();
  if (PATH_RE.test(trimmed)) return "task";
  for (const kw of TASK_KEYWORDS) {
    // Whole-word boundary check. We use indexOf + boundary chars instead of
    // RegExp.escape (not available everywhere) — keywords are static and
    // safe.
    const idx = lower.indexOf(kw);
    if (idx === -1) continue;
    const before = idx === 0 ? " " : lower[idx - 1];
    const after = lower[idx + kw.length] ?? " ";
    if (/\s/.test(before) && (after === " " || after === "" || /[^a-z]/.test(after))) {
      return "task";
    }
  }

  return "idea";
}

/* ─── Framing strings ───────────────────────────────────────────────────── */

const FRAME_TICKET =
  "You're receiving a short note from a phone. The user referenced a ticket id — look it up only if the rest of the note doesn't make sense without it. Otherwise just respond. Keep the reply concise; this is a mobile screen.";

const FRAME_QUESTION =
  "You're receiving a short question from a phone. Answer concisely — one or two short paragraphs at most. Skip preamble. If the answer truly needs code or commands, keep them minimal. Don't fabricate context you don't have.";

const FRAME_TASK =
  "You're receiving a short work request from a phone. Do the work and report what changed in one tight summary at the end (files touched + one-line why). Skip preamble. Ask only if a decision is genuinely ambiguous — otherwise pick the reasonable default and proceed.";

const FRAME_IDEA =
  "You're receiving a thinking-out-loud note from a phone. Engage as a thinking partner: react, sharpen the idea, surface tradeoffs. Do NOT start doing work, writing code, or editing files unless the user explicitly asks. Keep the reply conversational and short.";

function frameFor(intent: BuiltPrompt["intent"]): string {
  switch (intent) {
    case "ticket":
      return FRAME_TICKET;
    case "question":
      return FRAME_QUESTION;
    case "task":
      return FRAME_TASK;
    case "idea":
      return FRAME_IDEA;
    default:
      return "";
  }
}

/* ─── Public API ────────────────────────────────────────────────────────── */

export function buildPrompt(
  noteBody: string,
  opts?: BuildPromptOptions,
): BuiltPrompt {
  const rawNote = noteBody ?? "";
  const intent = detectIntent(rawNote);

  // Follow-up turns: the session already has framing in its history.
  // Pass through verbatim so Claude reads it as a continuation, not a
  // brand-new task with duplicated meta-instructions.
  if (opts?.followUp && opts.sessionId) {
    return { prompt: rawNote, intent, rawNote };
  }

  // Slash commands: ALWAYS verbatim. The CLI parses them; wrapping breaks
  // them.
  if (intent === "slash") {
    return { prompt: rawNote, intent, rawNote };
  }

  const frame = frameFor(intent);
  if (!frame) return { prompt: rawNote, intent, rawNote };

  // Compose: framing first as a brief system-style preamble, then a
  // separator, then the note verbatim. We send everything as a single
  // user-turn string because `claude -p` doesn't take a separate system
  // prompt argument in our daemon's current shape — the framing is just
  // the first paragraph of the user message. Empirically Claude treats
  // it the way you'd expect.
  const prompt = `${frame}\n\n---\n\n${rawNote.trim()}`;
  return { prompt, intent, rawNote };
}
