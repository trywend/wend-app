/**
 * Wend — deliverable download helper.
 *
 * Every artifact is downloadable. Two sources:
 *   - a daemon URL (diff / file / html / image bytes), fetched to a cache file
 *   - in-memory text (the virtual answer artifact), written to a cache file
 *
 * We save bytes with react-native-blob-util (expo-file-system is NOT in this
 * app's deps) and present the OS share/save sheet with expo-sharing. Both are
 * lazy-required so a stale dev client that predates them degrades to RN's
 * built-in Share / opening the URL in the browser instead of crashing.
 */
import { Linking, Share } from "react-native";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Blob: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("react-native-blob-util");
  Blob = mod?.default ?? mod;
} catch {
  Blob = null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Sharing: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Sharing = require("expo-sharing");
} catch {
  Sharing = null;
}

export const fileSaveSupported = Boolean(Blob);

function sanitizeName(name: string): string {
  const cleaned = name.replace(/[\/\\:*?"<>|]/g, "_").trim();
  return cleaned.length > 0 ? cleaned : "deliverable";
}

async function present(localUri: string, mime: string, name: string): Promise<void> {
  if (Sharing) {
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(localUri, { mimeType: mime, dialogTitle: name });
        return;
      }
    } catch {
      // fall through to RN Share
    }
  }
  await Share.share({ url: localUri, title: name });
}

/** Download an artifact's bytes from the daemon and hand them to the OS
 *  share/save sheet. Falls back to opening the URL when no filesystem
 *  module is linked. */
export async function downloadFromUrl(args: {
  url: string;
  name: string;
  mime: string;
}): Promise<void> {
  const { url, name, mime } = args;
  if (!Blob) {
    await Linking.openURL(url).catch(() => {});
    return;
  }
  const path = `${Blob.fs.dirs.CacheDir}/${sanitizeName(name)}`;
  const res = await Blob.config({ path }).fetch("GET", url);
  const status: number = res.info?.().status ?? 200;
  if (status < 200 || status >= 300) {
    await Blob.fs.unlink(res.path()).catch(() => {});
    throw new Error(`download failed: ${status}`);
  }
  await present(`file://${res.path()}`, mime, name);
}

/** Save in-memory text (the virtual answer) to a cache file and present the
 *  share/save sheet. Falls back to sharing the raw text. */
export async function downloadText(args: {
  text: string;
  name: string;
  mime: string;
}): Promise<void> {
  const { text, name, mime } = args;
  if (!Blob) {
    await Share.share({ message: text, title: name });
    return;
  }
  const path = `${Blob.fs.dirs.CacheDir}/${sanitizeName(name)}`;
  await Blob.fs.writeFile(path, text, "utf8");
  await present(`file://${path}`, mime, name);
}
