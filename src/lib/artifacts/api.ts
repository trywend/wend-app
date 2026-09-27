/**
 * Wend — artifacts library API.
 *
 * Talks to the Mac daemon's library endpoints (shared contract):
 *   GET    /artifacts?t=                      → every artifact from every note,
 *                                               newest first, plus stored bytes.
 *   DELETE /run/<runId>/artifact/<id>?t=      → remove one from the Mac.
 * Bytes are fetched per artifact via GET /run/<runId>/artifact/<id>.
 */
import { fetch as expoFetch } from "expo/fetch";

import type { Artifact, ArtifactKind } from "@/lib/notes-storage";

export interface LibraryArtifact extends Artifact {
  runId: string;
  noteId: string;
  noteTitle: string;
  project: string;
  prompt: string;
  createdAt: number;
  /** False when the bytes are gone from the Mac; the record remains. */
  available: boolean;
}

export interface ArtifactsLibraryPayload {
  artifacts: LibraryArtifact[];
  storedBytes: number;
}

const KINDS: ArtifactKind[] = ["diff", "file", "html", "answer", "image"];

export function libraryKey(a: { runId: string; id: string }): string {
  return `${a.runId}/${a.id}`;
}

function base(url: string): string {
  return url.replace(/\/$/, "");
}

export async function fetchArtifactsLibrary(args: {
  url: string;
  token: string;
  signal?: AbortSignal;
}): Promise<ArtifactsLibraryPayload> {
  const { url, token, signal } = args;
  const res = await expoFetch(
    `${base(url)}/artifacts?t=${encodeURIComponent(token)}`,
    { method: "GET", signal },
  );
  if (res.status === 404) {
    throw new Error("Update Wend on your Mac to browse artifacts.");
  }
  if (!res.ok) throw new Error(`Daemon returned ${res.status}`);
  const body = (await res.json()) as {
    artifacts?: Partial<LibraryArtifact>[];
    storedBytes?: number;
  };
  const artifacts = (body.artifacts ?? []).flatMap((a): LibraryArtifact[] => {
    if (!a || typeof a.id !== "string" || typeof a.runId !== "string") return [];
    const kind = KINDS.includes(a.kind as ArtifactKind) ? (a.kind as ArtifactKind) : "file";
    return [
      {
        id: a.id,
        name: a.name ?? a.id,
        kind,
        mime: a.mime ?? "application/octet-stream",
        size: typeof a.size === "number" ? a.size : 0,
        runId: a.runId,
        noteId: a.noteId ?? "",
        noteTitle: a.noteTitle || "Untitled note",
        project: a.project ?? "",
        prompt: a.prompt ?? "",
        createdAt: typeof a.createdAt === "number" ? a.createdAt : 0,
        available: a.available !== false,
      },
    ];
  });
  return { artifacts, storedBytes: body.storedBytes ?? 0 };
}

export async function deleteLibraryArtifact(args: {
  url: string;
  token: string;
  runId: string;
  id: string;
}): Promise<void> {
  const { url, token, runId, id } = args;
  const res = await expoFetch(
    `${base(url)}/run/${encodeURIComponent(runId)}/artifact/${encodeURIComponent(id)}` +
      `?t=${encodeURIComponent(token)}`,
    { method: "DELETE" },
  );
  if (!res.ok && res.status !== 404) throw new Error(`Daemon returned ${res.status}`);
}

export function isTextLike(a: Artifact): boolean {
  if (a.kind === "diff" || a.kind === "html" || a.kind === "answer") return true;
  if (a.kind === "image") return false;
  const m = a.mime;
  return (
    m.startsWith("text/") ||
    m.startsWith("application/json") ||
    m.startsWith("application/yaml") ||
    m.startsWith("application/toml") ||
    m.startsWith("application/xml")
  );
}

export function kindLabel(kind: ArtifactKind): string {
  switch (kind) {
    case "diff":
      return "Diff";
    case "html":
      return "Page";
    case "image":
      return "Image";
    case "answer":
      return "Answer";
    default:
      return "File";
  }
}

export function displayName(a: LibraryArtifact): string {
  return a.kind === "answer" ? a.noteTitle : a.name;
}
