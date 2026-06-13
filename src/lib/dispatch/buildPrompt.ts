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
 * On top of intent we extract a small set of signal hints that we surface
 * to Claude as a brief CONTEXT bullet list right before the framing:
 *
 *   - language hint   ("in Swift", "in JS", "Python") — keeps Claude from
 *     defaulting to the wrong language on a vague task.
 *   - ticket id + known project — `WEND-` is Wend, etc.
 *   - @-mentioned files — `@src/foo.ts` → "the user is referring to file
 *     `src/foo.ts`". We do NOT pretend to know its contents.
 *   - explicit imperatives — "Don't do X", "Make sure Y" — passed through
 *     as constraints so Claude doesn't lose them after the framing.
 *
 * Every framing ends with a uniform conciseness directive — the single
 * biggest mobile UX win, since long Claude essays are unreadable on a
 * phone screen.
 *
 * Follow-up turns (when opts.followUp + opts.sessionId are set) skip
 * wrapping entirely — `claude -p --resume <sessionId>` already has the
 * prior turn's context including the original framing.
 *
 * ─── Quick sanity samples (run mentally; not a test file) ───
 *   "fix the bug in JS"
 *     → intent=task, language=JavaScript
 *   "WEND-42 looks broken"
 *     → intent=ticket, ticket=WEND-42 (project=Wend)
 *   "@src/foo.ts what does this do?"
 *     → intent=question, files=[src/foo.ts]
 *   "refactor the auth flow. don't touch the tests"
 *     → intent=task, constraints=["don't touch the tests"]
 *   "/clear"
 *     → intent=slash, verbatim passthrough
 */

import { parseCommand } from "@/lib/dispatch/commands";

export interface BuiltPrompt {
  prompt: string;
  intent: "command" | "slash" | "ticket" | "question" | "task" | "idea";
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
const TICKET_RE = /\b([A-Z]{2,})-(\d+)\b/;
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

/* ─── Signal extraction ─────────────────────────────────────────────────── */

/**
 * Language hint detection. We look for explicit "in <Lang>" phrasing OR a
 * bare language word that's clear enough to disambiguate (Swift, Kotlin,
 * Rust — these don't show up as casual nouns). We deliberately DON'T match
 * ambiguous words like "Go" or "C" alone — too many false positives.
 */
const LANGUAGE_HINTS: Array<{ re: RegExp; label: string }> = [
  { re: /\bin\s+(java\s?script|js)\b/i, label: "JavaScript" },
  { re: /\bin\s+(type\s?script|ts)\b/i, label: "TypeScript" },
  { re: /\bin\s+swift\b/i, label: "Swift" },
  { re: /\bin\s+kotlin\b/i, label: "Kotlin" },
  { re: /\bin\s+python\b/i, label: "Python" },
  { re: /\bin\s+rust\b/i, label: "Rust" },
  { re: /\bin\s+go(lang)?\b/i, label: "Go" },
  { re: /\bin\s+ruby\b/i, label: "Ruby" },
  { re: /\bin\s+java\b/i, label: "Java" },
  { re: /\bin\s+c\+\+\b/i, label: "C++" },
  { re: /\bin\s+c#\b/i, label: "C#" },
  { re: /\bin\s+php\b/i, label: "PHP" },
  // Bare mentions of unambiguous languages.
  { re: /\bswift(ui)?\b/i, label: "Swift" },
  { re: /\bkotlin\b/i, label: "Kotlin" },
  { re: /\btypescript\b/i, label: "TypeScript" },
  { re: /\bpython\b/i, label: "Python" },
];

function detectLanguage(note: string): string | null {
  for (const { re, label } of LANGUAGE_HINTS) {
    if (re.test(note)) return label;
  }
  return null;
}

/**
 * Known ticket-prefix → project name map. Conservative: only map prefixes
 * we're sure about. Unknown prefixes fall through and we just surface the
 * raw ticket id without a project name.
 */
const TICKET_PROJECTS: Record<string, string> = {
  WEND: "Wend",
};

interface TicketHit {
  id: string;
  project: string | null;
}

function detectTicket(note: string): TicketHit | null {
  const m = TICKET_RE.exec(note);
  if (!m) return null;
  const prefix = m[1]!.toUpperCase();
  return {
    id: `${prefix}-${m[2]}`,
    project: TICKET_PROJECTS[prefix] ?? null,
  };
}

/**
 * @-mentioned files. `@src/foo.ts`, `@app/(app)/index.tsx`, `@./bar`.
 * We capture the token after `@` up to whitespace or quote. The path is
 * surfaced as-is — no fabricated context about its contents.
 */
const AT_FILE_RE = /(?:^|\s)@(\.?\/?[A-Za-z0-9_./()\-]+(?:\.[A-Za-z0-9]+)?)/g;

function detectAtFiles(note: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  // Reset lastIndex defensively (regex is global).
  AT_FILE_RE.lastIndex = 0;
  while ((m = AT_FILE_RE.exec(note)) !== null) {
    const path = m[1]!.replace(/[.,;:!?)]+$/, "");
    if (path.length === 0 || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/**
 * Explicit imperative constraints — sentences that start with "don't",
 * "do not", "make sure", "ensure", "avoid", "never", "always". We take the
 * containing sentence (split on `.`, `!`, `?`, newline) so the constraint
 * carries its object with it.
 */
const CONSTRAINT_LEAD_RE = /^(don'?t|do\s+not|make\s+sure|ensure|avoid|never|always)\b/i;

function detectConstraints(note: string): string[] {
  const sentences = note
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of sentences) {
    if (CONSTRAINT_LEAD_RE.test(s)) {
      // Strip trailing punctuation for cleaner display.
      const clean = s.replace(/[.!]+$/, "");
      const key = clean.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(clean);
      }
    }
  }
  return out;
}

/* ─── Framing strings ───────────────────────────────────────────────────── */

const FRAME_TICKET =
  "You're receiving a short note from a phone. The user referenced a ticket id — look it up only if the rest of the note doesn't make sense without it. Otherwise just respond.";

const FRAME_QUESTION =
  "You're receiving a short question from a phone. Answer concisely — one or two short paragraphs at most. Skip preamble. If the answer truly needs code or commands, keep them minimal. Don't fabricate context you don't have.";

const FRAME_TASK =
  "You're receiving a short work request from a phone. Do the work and report what changed in one tight summary at the end (files touched + one-line why). Skip preamble. Ask only if a decision is genuinely ambiguous — otherwise pick the reasonable default and proceed.";

const FRAME_IDEA =
  "You're receiving a thinking-out-loud note from a phone. Engage as a thinking partner: react, sharpen the idea, surface tradeoffs. Do NOT start doing work, writing code, or editing files unless the user explicitly asks. Keep the reply conversational.";

const CONCISENESS_DIRECTIVE =
  "Respond concisely. Prefer 2-4 sentences over a multi-section essay. Show your work only if the user asks.";

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

/* ─── Context block assembly ────────────────────────────────────────────── */

interface Signals {
  language: string | null;
  ticket: TicketHit | null;
  files: string[];
  constraints: string[];
}

function extractSignals(note: string): Signals {
  return {
    language: detectLanguage(note),
    ticket: detectTicket(note),
    files: detectAtFiles(note),
    constraints: detectConstraints(note),
  };
}

function renderContext(signals: Signals): string {
  const lines: string[] = [];
  if (signals.language) {
    lines.push(`- Language hint: ${signals.language}.`);
  }
  if (signals.ticket) {
    if (signals.ticket.project) {
      lines.push(
        `- Ticket: ${signals.ticket.id} (project: ${signals.ticket.project}).`,
      );
    } else {
      lines.push(`- Ticket: ${signals.ticket.id}.`);
    }
  }
  for (const f of signals.files) {
    lines.push(`- The user is referring to file \`${f}\`.`);
  }
  if (signals.constraints.length > 0) {
    lines.push("- Constraints from the note:");
    for (const c of signals.constraints) {
      lines.push(`  • ${c}`);
    }
  }
  if (lines.length === 0) return "";
  return `Context:\n${lines.join("\n")}`;
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

  // Palette commands: a distinct system prompt frames the run, replacing the
  // generic intent framing. Matched BEFORE the slash passthrough so an unknown
  // slash (a real CLI command) still falls through to verbatim below.
  const parsed = parseCommand(rawNote);
  if (parsed) {
    const preamble = `${parsed.command.systemPrompt}\n\n${CONCISENESS_DIRECTIVE}`;
    const arg = parsed.argument;
    const prompt = arg ? `${preamble}\n\n---\n\n${arg}` : preamble;
    return { prompt, intent: "command", rawNote };
  }

  // Slash commands: ALWAYS verbatim. The CLI parses them; wrapping breaks
  // them.
  if (intent === "slash") {
    return { prompt: rawNote, intent, rawNote };
  }

  const frame = frameFor(intent);
  if (!frame) return { prompt: rawNote, intent, rawNote };

  const signals = extractSignals(rawNote);
  const context = renderContext(signals);

  // Compose: framing first as a brief system-style preamble, then optional
  // context block, then the conciseness directive, then a separator, then
  // the note verbatim. We send everything as a single user-turn string
  // because `claude -p` doesn't take a separate system prompt argument in
  // our daemon's current shape — the framing is just the first paragraph
  // of the user message. Empirically Claude treats it the way you'd expect.
  const parts: string[] = [frame];
  if (context) parts.push(context);
  parts.push(CONCISENESS_DIRECTIVE);
  const preamble = parts.join("\n\n");

  const prompt = `${preamble}\n\n---\n\n${rawNote.trim()}`;
  return { prompt, intent, rawNote };
}
