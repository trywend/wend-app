/**
 * Wend — palette commands.
 *
 * The command palette's slash actions. Each carries a distinct system prompt
 * that frames the run independently of the surrounding note. A command is
 * injected inline at the cursor (`/fix `), and when the note is dispatched the
 * leading command segment fires in isolation — its system prompt replaces the
 * generic intent framing in `buildPrompt`, and only that segment is sent.
 *
 * These are NOT Claude Code CLI slash commands (`/clear`, `/model`). `buildPrompt`
 * matches palette tokens BEFORE its generic slash-verbatim passthrough, so an
 * unknown slash (a real CLI command) still passes through untouched.
 */

export type CommandIconKind = "terminal" | "filetext" | "rocket";

export interface PaletteCommand {
  /** Slash-prefixed token as the user types it. Lowercase. */
  name: string;
  description: string;
  icon: CommandIconKind;
  /** Distinct framing for this command's isolated dispatch. */
  systemPrompt: string;
}

export const PALETTE_COMMANDS: PaletteCommand[] = [
  {
    name: "/fix",
    description: "Find and fix a bug in the codebase",
    icon: "terminal",
    systemPrompt:
      "You're fixing a bug from a phone note. Reproduce or locate the fault first, make the smallest change that resolves it, and report the root cause plus the files you touched in one tight summary. Don't refactor adjacent code or expand scope. If the bug can't be found, say what you ruled out.",
  },
  {
    name: "/summarize",
    description: "Summarize a thread, doc, or run",
    icon: "filetext",
    systemPrompt:
      "You're summarizing for someone reading on a phone. Lead with the single most important takeaway, then 3-5 tight bullets. No preamble, no restating the prompt. Preserve concrete names, numbers, and decisions; drop filler.",
  },
  {
    name: "/deploy",
    description: "Kick off a deploy to staging",
    icon: "rocket",
    systemPrompt:
      "You're handling a deploy request from a phone note. Confirm the target and the current state before acting. Run the project's actual deploy path, surface the command output, and report success or the exact failure. Do not invent deploy steps — if the pipeline is unclear, stop and say what you need.",
  },
  {
    name: "/explain",
    description: "Explain a file or symbol in plain English",
    icon: "filetext",
    systemPrompt:
      "You're explaining code to someone on a phone. Read the referenced file or symbol, then explain what it does and why it exists in plain English — no line-by-line narration. Surface the non-obvious: invariants, gotchas, and how it connects to the rest of the system.",
  },
  {
    name: "/test",
    description: "Generate or run tests",
    icon: "terminal",
    systemPrompt:
      "You're handling a test request from a phone note. If tests exist for the target, run them and report pass/fail with the failing output. If asked to write tests, cover the real behavior and edge cases — not trivial getters — and run them before reporting. Report what you ran and the result.",
  },
];

const BY_TOKEN: Record<string, PaletteCommand> = Object.fromEntries(
  PALETTE_COMMANDS.map((c) => [c.name.toLowerCase(), c]),
);

const LEAD_TOKEN_RE = /^\s*(\/[a-z][a-z0-9-]*)/i;

/**
 * Parse a leading palette command off a string. Returns the matched command
 * and the argument text that follows it (the rest of the string after the
 * token). Null when the string doesn't lead with a known palette command —
 * including real CLI slash commands, which fall through to verbatim dispatch.
 */
export function parseCommand(
  text: string,
): { command: PaletteCommand; argument: string } | null {
  const m = LEAD_TOKEN_RE.exec(text);
  if (!m) return null;
  const command = BY_TOKEN[m[1]!.toLowerCase()];
  if (!command) return null;
  const argument = text.slice(m[0].length).trim();
  return { command, argument };
}

/**
 * Split the leading command segment off a note body for isolated dispatch.
 * The segment is the command token plus everything up to the first blank line
 * (double newline); the rest is the remainder, left untouched in the note.
 * Null when the body doesn't lead with a known palette command.
 */
export function splitLeadingCommand(
  body: string,
): { segment: string; rest: string } | null {
  if (!parseCommand(body)) return null;
  const blank = body.search(/\n[ \t]*\n/);
  if (blank === -1) return { segment: body.trim(), rest: "" };
  const segment = body.slice(0, blank).trim();
  const rest = body.slice(blank).replace(/^\s+/, "");
  return { segment, rest };
}
