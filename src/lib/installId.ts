/**
 * Wend — stable per-install id.
 *
 * A presence key the rendezvous backend upserts device rows by, so a phone
 * shows up on the Mac even when push registration never completes. Generated
 * once on first call, persisted in AsyncStorage, and memoized in-module so
 * repeat callers within a launch share one value. Must be stable across
 * launches and survive a denied push permission.
 */
import { storage } from "@/store/storage";

const STORAGE_KEY = "wend:installId";

let cached: string | null = null;
let inflight: Promise<string> | null = null;
let fallbackCounter = 0;

function generateId(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const Crypto = require("expo-crypto") as any;
    if (typeof Crypto?.randomUUID === "function") {
      const id = Crypto.randomUUID() as string;
      if (id && id.length > 0) return id;
    }
    if (typeof Crypto?.getRandomBytes === "function") {
      const bytes = Crypto.getRandomBytes(16) as Uint8Array;
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex: string[] = [];
      for (let i = 0; i < 16; i += 1) {
        hex.push((bytes[i] + 0x100).toString(16).slice(1));
      }
      return (
        hex.slice(0, 4).join("") +
        "-" +
        hex.slice(4, 6).join("") +
        "-" +
        hex.slice(6, 8).join("") +
        "-" +
        hex.slice(8, 10).join("") +
        "-" +
        hex.slice(10, 16).join("")
      );
    }
  } catch {
    // fall through to the timestamp+counter fallback
  }
  fallbackCounter += 1;
  return `inst-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
}

export async function getInstallId(): Promise<string> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const existing = await storage.getItem(STORAGE_KEY);
      if (existing && existing.length > 0) {
        cached = existing;
        return existing;
      }
    } catch {
      // storage read failed — generate a fresh id and try to persist below
    }
    const id = generateId();
    cached = id;
    try {
      await storage.setItem(STORAGE_KEY, id);
    } catch {
      // persistence failed; the in-module memo keeps it stable this launch
    }
    return id;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
