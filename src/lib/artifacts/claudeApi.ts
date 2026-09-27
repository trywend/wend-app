/**
 * Wend — claude.ai artifacts API.
 *
 * The Mac daemon mirrors the user's claude.ai artifact list:
 *   GET /claude-artifacts?t=[&refresh=1]   → cached list, answered immediately.
 *                                            `refreshing` is true while a
 *                                            background refresh runs.
 */
import { fetch as expoFetch } from "expo/fetch";

export interface ClaudeArtifact {
  id: string;
  title: string;
  url: string;
  owned: boolean;
  /** Local-midnight precision on the Mac. */
  updatedAt: number;
}

export interface ClaudeArtifactsPayload {
  artifacts: ClaudeArtifact[];
  fetchedAt: number | null;
  refreshing: boolean;
  error: string | null;
}

function base(url: string): string {
  return url.replace(/\/$/, "");
}

export async function fetchClaudeArtifacts(args: {
  url: string;
  token: string;
  refresh?: boolean;
  signal?: AbortSignal;
}): Promise<ClaudeArtifactsPayload> {
  const { url, token, refresh, signal } = args;
  const res = await expoFetch(
    `${base(url)}/claude-artifacts?t=${encodeURIComponent(token)}${refresh ? "&refresh=1" : ""}`,
    { method: "GET", signal },
  );
  if (res.status === 404) {
    throw new Error("Update Wend on your Mac to see Claude artifacts.");
  }
  if (!res.ok) throw new Error(`Daemon returned ${res.status}`);
  const body = (await res.json()) as {
    artifacts?: Partial<ClaudeArtifact>[];
    fetchedAt?: number;
    refreshing?: boolean;
    error?: string;
  };
  const artifacts = (body.artifacts ?? []).flatMap((a): ClaudeArtifact[] => {
    if (!a || typeof a.id !== "string" || typeof a.url !== "string") return [];
    return [
      {
        id: a.id,
        title: a.title || "Untitled artifact",
        url: a.url,
        owned: a.owned !== false,
        updatedAt: typeof a.updatedAt === "number" ? a.updatedAt : 0,
      },
    ];
  });
  return {
    artifacts,
    fetchedAt: typeof body.fetchedAt === "number" ? body.fetchedAt : null,
    refreshing: body.refreshing === true,
    error: body.error || null,
  };
}
