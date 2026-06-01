/**
 * Wend — Clerk token cache backed by expo-secure-store.
 *
 * Clerk's session/refresh tokens live here so the user stays signed in across
 * app restarts. We keep one cache module so future hardening (e.g. swapping
 * secure-store for a keychain wrapper) is a single-file change.
 */
import * as SecureStore from "expo-secure-store";

export const tokenCache = {
  async getToken(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[wend/auth] tokenCache.getToken failed", err);
      return null;
    }
  },
  async saveToken(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[wend/auth] tokenCache.saveToken failed", err);
    }
  },
  async clearToken(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[wend/auth] tokenCache.clearToken failed", err);
    }
  },
};
