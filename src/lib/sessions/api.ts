/**
 * Wend — global sessions API.
 *
 * Talks to the Mac daemon's session endpoints (shared contract):
 *   GET /sessions?limit=&t=   → every Claude Code session on the Mac,
 *                               newest first (Wend notes + terminal runs).
 *   GET /session/<id>?t=      → one session's parsed transcript.
 *
 * Uses `expo/fetch` (not global fetch) to match the rest of the dispatch
 * layer. Both calls append the daemon bearer token as `?t=`.
 */
import { fetch as expoFetch } from "expo/fetch";

export interface SessionSummary {
  id: string;
  cwd: string;
  project: string;
  title: string;
  lastModified: number;
  messageCount?: number;
  gitBranch?: string;
}

export interface SessionMessage {
  role: "user" | "assistant";
  text: string;
  ts: number;
}

export interface SessionDetail {
  id: string;
  cwd: string;
  project: string;
  messages: SessionMessage[];
}

export async function fetchSessions(args: {
  url: string;
  token: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<SessionSummary[]> {
  const { url, token, limit = 50, signal } = args;
  if (!url || !token) return [];
  const target =
    `${url.replace(/\/$/, "")}/sessions` +
    `?limit=${encodeURIComponent(String(limit))}&t=${encodeURIComponent(token)}`;
  const res = await expoFetch(target, { method: "GET", signal });
  if (!res.ok) {
    throw new Error(`Daemon returned ${res.status}`);
  }
  const body = (await res.json()) as { sessions?: SessionSummary[] };
  return (body.sessions ?? []).filter((s) => s && typeof s.id === "string");
}

export async function fetchSession(args: {
  url: string;
  token: string;
  id: string;
  signal?: AbortSignal;
}): Promise<SessionDetail> {
  const { url, token, id, signal } = args;
  const target =
    `${url.replace(/\/$/, "")}/session/${encodeURIComponent(id)}` +
    `?t=${encodeURIComponent(token)}`;
  const res = await expoFetch(target, { method: "GET", signal });
  if (!res.ok) {
    throw new Error(`Daemon returned ${res.status}`);
  }
  const body = (await res.json()) as Partial<SessionDetail>;
  return {
    id: body.id ?? id,
    cwd: body.cwd ?? "",
    project: body.project ?? projectFromCwd(body.cwd ?? ""),
    messages: (body.messages ?? []).filter(
      (m): m is SessionMessage =>
        !!m && (m.role === "user" || m.role === "assistant"),
    ),
  };
}

export function projectFromCwd(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, "");
  const parts = trimmed.split("/");
  return parts[parts.length - 1] || cwd;
}

export function formatSessionTime(ts: number): string {
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
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
