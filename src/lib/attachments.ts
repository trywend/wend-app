/**
 * Wend — attachment storage helpers.
 *
 * v1 scope is intentionally minimal: attachments are LOCAL to the phone. We
 * copy the picked file into `${Paths.document}/wend-attachments/<noteId>/<uuid>.<ext>`
 * via expo-file-system's new class-based API (SDK 56 — File / Directory /
 * Paths). The metadata gets persisted on the note record (see notes-storage).
 *
 * What this file does NOT do (yet):
 *   - Upload bytes to the daemon. Claude on the Mac never sees the file in
 *     v1 — the user's prose may reference the attachment but the agent's
 *     response is text-only. That's a follow-up, possibly via a separate
 *     `daemon/attachments` endpoint.
 *   - Delete an attachment when the owning note is deleted. The directory
 *     is left behind on purpose — it's small, and a future cleanup pass
 *     can sweep it. Doing it inline would require notes-storage to depend
 *     on this module which inverts the layering.
 */

import * as Crypto from "expo-crypto";

// expo-file-system was newly added in this release; lazy-require so a
// stale dev client (built before this dep was linked) doesn't crash the
// whole bundle at module-eval time — same pattern as expo-image-picker
// in AttachmentPicker. When the native module is missing, the type
// aliases below resolve to `any` and the public API functions throw a
// clear error at call time. The AttachmentPicker already short-circuits
// with a "rebuild the dev client" alert before reaching the file ops,
// so this is the last-line safety net.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let FS: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  FS = require("expo-file-system");
} catch {
  FS = null;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Directory: any = FS?.Directory;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const File: any = FS?.File;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Paths: any = FS?.Paths;
export const fileSystemAvailable = Boolean(Directory && File && Paths);

function assertFS(): void {
  if (!fileSystemAvailable) {
    throw new Error(
      "expo-file-system isn't linked into this dev client. Rebuild with " +
        "`npx eas-cli build --profile development --platform android` and reinstall.",
    );
  }
}

/* ===========================================================================
   TYPES
   =========================================================================== */

export interface Attachment {
  /** UUID; matches the filename stem on disk. */
  id: string;
  /** Best-effort MIME type. Pickers populate it; fall back to `octet-stream`. */
  mimeType: string;
  /** Original filename as the user picked it (or our synthesized image name). */
  name: string;
  /** Absolute `file://` URI inside our wend-attachments dir. */
  localUri: string;
  /** Size in bytes, or 0 if we couldn't read it back. */
  sizeBytes: number;
  /** ms epoch. */
  addedAt: number;
  /** Where this attachment renders inline in the editor: -1 (or absent,
   *  for pre-existing data) = under the body text; n ≥ 0 = under run n's
   *  follow-up. Set at add time to the last run index. */
  afterRun?: number;
}

/** Per-attachment directory root (relative to Paths.document). */
const ATTACHMENTS_DIRNAME = "wend-attachments";

/* ===========================================================================
   INTERNAL HELPERS
   =========================================================================== */

/**
 * Ensure `Paths.document/wend-attachments/<noteId>/` exists and return it.
 * Creates intermediate directories when missing — idempotent so callers can
 * fire and forget on every save.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ensureNoteDir(noteId: string): any {
  assertFS();
  const root = new Directory(Paths.document, ATTACHMENTS_DIRNAME);
  if (!root.exists) {
    root.create({ intermediates: true });
  }
  const noteDir = new Directory(root, noteId);
  if (!noteDir.exists) {
    noteDir.create({ intermediates: true });
  }
  return noteDir;
}

/**
 * Best-effort extension lookup. Returns "bin" when the source has nothing
 * useful — we never want a missing-extension filename causing the OS share
 * sheet to misroute the file later.
 */
function extensionFor(name: string | null | undefined, mimeType: string): string {
  if (name) {
    const dot = name.lastIndexOf(".");
    if (dot !== -1 && dot < name.length - 1) {
      return name.slice(dot + 1).toLowerCase();
    }
  }
  // Mime → extension fallback for the common cases. Keep this tiny — the
  // long tail flows through `bin` and works fine.
  const mt = mimeType.toLowerCase();
  if (mt.startsWith("image/jpeg")) return "jpg";
  if (mt.startsWith("image/png")) return "png";
  if (mt.startsWith("image/heic")) return "heic";
  if (mt.startsWith("image/gif")) return "gif";
  if (mt.startsWith("image/webp")) return "webp";
  if (mt === "application/pdf") return "pdf";
  if (mt === "text/plain") return "txt";
  if (mt === "text/markdown") return "md";
  if (mt === "application/json") return "json";
  if (
    mt ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mt === "application/msword"
  ) {
    return "docx";
  }
  if (
    mt ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mt === "application/vnd.ms-excel"
  ) {
    return "xlsx";
  }
  return "bin";
}

/* ===========================================================================
   PUBLIC API
   =========================================================================== */

/**
 * Copy a picked source URI into our per-note attachments directory and
 * return the persisted metadata. The source is left untouched — image-picker
 * already gives us a cache copy, and document-picker (with
 * `copyToCacheDirectory: true`, the default) does the same. We re-copy to
 * the document directory so attachments survive cache eviction.
 */
export async function copyAttachmentIntoNote(args: {
  noteId: string;
  sourceUri: string;
  name?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
}): Promise<Attachment> {
  const { noteId, sourceUri } = args;
  const mimeType = args.mimeType?.trim() || "application/octet-stream";
  const id = Crypto.randomUUID();
  const ext = extensionFor(args.name, mimeType);
  const filename = `${id}.${ext}`;

  const noteDir = ensureNoteDir(noteId);
  const src = new File(sourceUri);
  const dest = new File(noteDir, filename);

  // copy() throws if the destination already exists — fine here, filename
  // is a fresh UUID.
  await src.copy(dest);

  // Size: prefer the dest file's reported size; fall back to the picker's
  // reported size; final fallback is 0 (better than crashing).
  let resolvedSize = 0;
  try {
    resolvedSize = dest.size;
  } catch {
    resolvedSize = args.sizeBytes ?? 0;
  }

  return {
    id,
    mimeType,
    name: args.name?.trim() || filename,
    localUri: dest.uri,
    sizeBytes: resolvedSize,
    addedAt: Date.now(),
  };
}

/**
 * Upload one attachment's bytes to the Mac daemon's /upload endpoint and
 * return the absolute path the daemon staged it at. The dispatch then
 * references that path so Claude can read the file. Raw-binary upload
 * (expo-file-system's default uploadType) — the daemon reads the request
 * body verbatim. Throws on any non-2xx so the caller can decide whether to
 * proceed without the file.
 */
export async function uploadAttachmentToDaemon(args: {
  baseUrl: string;
  token: string;
  noteId: string;
  attachment: Pick<Attachment, "localUri" | "name" | "mimeType">;
}): Promise<{ path: string; name: string }> {
  assertFS();
  const { baseUrl, token, noteId, attachment } = args;
  const url =
    `${baseUrl.replace(/\/$/, "")}/upload` +
    `?t=${encodeURIComponent(token)}` +
    `&noteId=${encodeURIComponent(noteId)}` +
    `&name=${encodeURIComponent(attachment.name)}`;
  const file = new File(attachment.localUri);
  const res = await file.upload(url, {
    httpMethod: "POST",
    headers: { "content-type": attachment.mimeType || "application/octet-stream" },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`upload failed: HTTP ${res.status}`);
  }
  const body = JSON.parse(res.body) as { path?: string; name?: string };
  if (!body.path) throw new Error("upload response missing path");
  return { path: body.path, name: body.name ?? attachment.name };
}

/**
 * Best-effort removal of an attachment's bytes on disk. Returns true when
 * the file was deleted (or already gone), false on error. Metadata removal
 * is the caller's responsibility — we don't touch the notes store from here.
 */
export async function removeAttachmentFile(uri: string): Promise<boolean> {
  if (!fileSystemAvailable) return false;
  try {
    const f = new File(uri);
    if (f.exists) {
      f.delete();
    }
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[attachments] remove failed:", err);
    return false;
  }
}

/**
 * Format a byte count as a short human string. Used by FileViewerModal and
 * the composer chip subtitle.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  // One decimal for KB+; whole for B.
  return i === 0 ? `${Math.round(v)} ${units[i]}` : `${v.toFixed(1)} ${units[i]}`;
}

/**
 * Guess a generic file kind from MIME type / extension. Used by the viewer
 * to pick a renderer.
 */
export type AttachmentKind =
  | "image"
  | "pdf"
  | "text"
  | "docx"
  | "xlsx"
  | "other";

const TEXT_EXTS = new Set([
  "txt",
  "md",
  "mdx",
  "log",
  "json",
  "yaml",
  "yml",
  "toml",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "swift",
  "py",
  "rs",
  "go",
  "java",
  "kt",
  "kts",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "m",
  "mm",
  "rb",
  "php",
  "html",
  "css",
  "scss",
  "sql",
  "sh",
  "bash",
  "zsh",
  "xml",
  "plist",
  "lock",
  "gradle",
  "podspec",
]);

export function classifyAttachment(
  mimeType: string | undefined,
  nameOrPath: string,
): AttachmentKind {
  const mt = (mimeType ?? "").toLowerCase();
  if (mt.startsWith("image/")) return "image";
  if (mt === "application/pdf") return "pdf";
  if (
    mt ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mt === "application/msword"
  ) {
    return "docx";
  }
  if (
    mt ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mt === "application/vnd.ms-excel"
  ) {
    return "xlsx";
  }
  if (mt.startsWith("text/")) return "text";

  // Fall back to extension sniffing — pickers don't always populate mimeType
  // (DocumentPicker on Android skips it for some sources).
  const dot = nameOrPath.lastIndexOf(".");
  if (dot === -1) return "other";
  const ext = nameOrPath.slice(dot + 1).toLowerCase();
  if (
    ext === "jpg" ||
    ext === "jpeg" ||
    ext === "png" ||
    ext === "heic" ||
    ext === "gif" ||
    ext === "webp"
  ) {
    return "image";
  }
  if (ext === "pdf") return "pdf";
  if (ext === "docx" || ext === "doc") return "docx";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (TEXT_EXTS.has(ext)) return "text";
  return "other";
}

/**
 * Read a text file's content. Returns null on error. Caps the read at
 * `maxBytes` to keep the viewer responsive on big logs.
 */
export async function readTextFile(
  uri: string,
  maxBytes = 200 * 1024,
): Promise<string | null> {
  if (!fileSystemAvailable) return null;
  try {
    const f = new File(uri);
    if (!f.exists) return null;
    // size is a sync getter on the native file object.
    const sz = f.size ?? 0;
    if (sz > maxBytes) {
      // Read the whole thing then slice — expo-file-system 56 doesn't expose
      // a byte-range read in the public API. 200KB is small enough that the
      // round-trip is fine; we slice to maxBytes to keep render light.
      const full = await f.text();
      return full.slice(0, maxBytes);
    }
    return await f.text();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[attachments] readTextFile failed:", err);
    return null;
  }
}

/**
 * Does this path live inside our local attachments dir (or any other
 * file:// path on the phone)? Used by the viewer to decide whether to fetch
 * over the network vs. read locally.
 */
export function isLocalUri(uri: string): boolean {
  return uri.startsWith("file:") || uri.startsWith("content:");
}

/**
 * Looks like a path-on-the-Mac that the daemon would understand. Used by
 * the viewer to render the "this file lives on your Mac" panel.
 */
export function looksLikeMacPath(path: string): boolean {
  if (!path) return false;
  if (isLocalUri(path)) return false;
  if (path.startsWith("http://") || path.startsWith("https://")) return false;
  return path.startsWith("/") || path.startsWith("~") || !path.includes(":");
}
