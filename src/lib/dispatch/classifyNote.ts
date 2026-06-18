/**
 * Wend — note classification + completeness gate for auto-arming.
 *
 * Pure, side-effect-free. `classifyNote` is the public name for the intent
 * heuristic that already lives in buildPrompt; `isComplete` decides whether a
 * settled note has landed enough to arm a dispatch. Both feed the arm-bar
 * state machine in useArming.
 */
import { detectIntent, type Intent } from "@/lib/dispatch/buildPrompt";

export type { Intent } from "@/lib/dispatch/buildPrompt";

export const MIN_ARM_LENGTH = 12;

export function classifyNote(text: string): Intent {
  return detectIntent(text);
}

const AT_FILE_RE = /(?:^|\s)@\.?\/?[A-Za-z0-9_./()\-]/;
const TRAILING_OPEN_RE = /[.?!)\]]$|```$/;
const TRAILING_CONJUNCTION_RE = /\b(and|or|but|so|then|because)$|,$/i;

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
];

function hasTaskKeyword(lower: string): boolean {
  for (const kw of TASK_KEYWORDS) {
    const idx = lower.indexOf(kw);
    if (idx === -1) continue;
    const before = idx === 0 ? " " : lower[idx - 1]!;
    const after = lower[idx + kw.length] ?? " ";
    if (/\s/.test(before) && (after === " " || /[^a-z]/.test(after))) {
      return true;
    }
  }
  return false;
}

/**
 * A settled note is "complete" enough to arm when it clears the min length
 * AND looks like a finished thought rather than a phrase the user is still
 * extending. Self-complete intents (slash/command/ticket) and explicit signals
 * (@file mention, task keyword) pass on their own. Otherwise we fall back to
 * the settle itself — except a trailing conjunction/comma reads as mid-sentence
 * and keeps the note composing.
 */
export function isComplete(text: string, intent: Intent): boolean {
  const trimmed = text.trim();
  if (trimmed.length < MIN_ARM_LENGTH) return false;

  if (TRAILING_OPEN_RE.test(trimmed)) return true;

  if (intent === "slash" || intent === "command" || intent === "ticket") {
    return true;
  }

  if (AT_FILE_RE.test(trimmed)) return true;
  if (hasTaskKeyword(trimmed.toLowerCase())) return true;

  if (TRAILING_CONJUNCTION_RE.test(trimmed)) return false;
  return true;
}
