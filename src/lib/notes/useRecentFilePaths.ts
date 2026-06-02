/**
 * Wend — useRecentFilePaths.
 *
 * Scans the current note's PersistedRuns for file paths mentioned in
 * tool-use names / responses and returns a deduped, recency-ordered list.
 *
 * Phase 2 scope: we don't have structured tool inputs persisted (toolUses
 * is just a string[] of tool names), so we lean on the run.response text +
 * the prompt as the haystack. The regex matches conventional repo paths
 * (src/foo/bar.ts, app/page.tsx, etc.).
 *
 * Future: when ToolUseEvent payloads are persisted, swap the regex scan for
 * a structured pass over inputs (Read.file_path, Edit.file_path, …).
 */
import { useMemo } from "react";
import type { PersistedRun } from "@/lib/notes-storage";

const FILE_PATH_RE =
  /\b(?:src|app|components|lib|pages|public|server|test|tests|scripts)\/[\w/.-]+\.(?:ts|tsx|js|jsx|md|mdx|css|json|swift|py|go|rs|html)\b/g;

export interface RecentFilePath {
  path: string;
  /** ms epoch when the run that mentioned this path completed. */
  mentionedAt: number;
}

export function useRecentFilePaths(
  runs: PersistedRun[],
  limit = 10,
): RecentFilePath[] {
  return useMemo(() => {
    const seen = new Map<string, number>();
    // Walk newest → oldest so the first occurrence wins for `mentionedAt`.
    for (let i = runs.length - 1; i >= 0; i--) {
      const run = runs[i];
      if (!run) continue;
      const haystack = `${run.prompt}\n${run.response}\n${run.toolUses.join(" ")}`;
      const matches = haystack.match(FILE_PATH_RE);
      if (!matches) continue;
      for (const m of matches) {
        if (!seen.has(m)) seen.set(m, run.createdAt);
      }
    }
    return Array.from(seen.entries())
      .map(([path, mentionedAt]) => ({ path, mentionedAt }))
      .sort((a, b) => b.mentionedAt - a.mentionedAt)
      .slice(0, limit);
  }, [runs, limit]);
}
