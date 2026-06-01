/**
 * Wend — local persistence adapter.
 *
 * PHASE 1 DECISION: AsyncStorage, not MMKV.
 * MMKV (react-native-mmkv) needs a custom native module → a dev build, which
 * would force the founder off Expo Go for the very first run. To keep Phase 1
 * launchable in Expo Go we use @react-native-async-storage/async-storage now
 * (works in Expo Go) behind this thin, swappable interface.
 *
 * MIGRATION (later phase): drop in react-native-mmkv and reimplement these
 * three methods synchronously. Callers already treat the API as async, so the
 * swap is local to this file. The zustand persist adapter below adapts whatever
 * backend this exports.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StateStorage } from "zustand/middleware";

export const storage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
};

/** zustand persist() expects this shape; AsyncStorage satisfies it directly. */
export const zustandStorage: StateStorage = {
  getItem: (name) => storage.getItem(name),
  setItem: (name, value) => storage.setItem(name, value),
  removeItem: (name) => storage.removeItem(name),
};
