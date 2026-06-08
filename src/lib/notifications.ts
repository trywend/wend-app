/**
 * Wend — push notifications client.
 *
 * Flow:
 *   1. After Clerk sign-in (see `src/auth/useSession.ts`), call
 *      `ensurePushNotificationsRegistered(userId, getToken)`. That:
 *        a) Requests OS permission (idempotent — once granted, returns ok).
 *        b) Fetches the device's Expo push token.
 *        c) POSTs it to `${BACKEND}/api/notifications/register` with the
 *           Clerk JWT as bearer.
 *        d) Caches it in the `notificationsSlice` (zustand + AsyncStorage)
 *           keyed by userId so re-registering on every cold launch is
 *           a no-op when the token hasn't rotated.
 *   2. A foreground notification handler logs (and toasts when there's a
 *      UI surface for it). Background presentation is handled by Expo /
 *      the OS — no app code needed.
 *
 * Why the heavy comment block at the top: this module deliberately can't
 * touch `app.json` or `package.json` (the human merges those). The
 * REQUIRED ADDITIONS comments below tell them exactly what to add.
 *
 * ───────────────────────────────────────────────────────────────────────
 * REQUIRED ADDITIONS to app.json (human must merge):
 *   - Add plugin: ["expo-notifications", {icon: "./assets/notification-icon.png", color: "#D85A3C"}]
 *   - Add to `android.permissions`: ["NOTIFICATIONS"]
 *   - Add to `ios`: { infoPlist: { UIBackgroundModes: ["remote-notification"] } }
 * REQUIRED ADDITIONS to package.json:
 *   - "expo-notifications": "<sdk-56-compatible-version>" (run `npx expo install expo-notifications`)
 * ───────────────────────────────────────────────────────────────────────
 *
 * Design notes:
 *   - We intentionally do NOT pull `expo-notifications` at module scope
 *     with a static import. Until the human merges the package.json
 *     change, the import would crash Metro. Instead, we lazy-import via
 *     `require()` inside an isolated try/catch so the rest of the app
 *     continues to build and run when the module isn't installed.
 *   - All network failures degrade silently. Push notifications are a
 *     "nice to have" — they must not break sign-in or dispatch.
 */

import Constants from "expo-constants";
import { Platform } from "react-native";

import { useNotificationsStore } from "@/store/notificationsSlice";

/** Production rendezvous backend (Vercel deployment of the landing).
 *  Override via EXPO_PUBLIC_RENDEZVOUS_BASE for local dev. Same env var
 *  we use elsewhere in dispatch so an override applies uniformly. */
const BACKEND_BASE =
  process.env.EXPO_PUBLIC_RENDEZVOUS_BASE ||
  "https://wend-landing.vercel.app";

/** EAS projectId is required by expo-notifications' `getExpoPushTokenAsync`
 *  for SDK 56's experience-host model. Resolved from app.json's `extra.eas.projectId`.
 *  When absent (e.g. running in Expo Go on a project without EAS configured)
 *  we still pass `projectId: undefined` and let the SDK fall through to its
 *  legacy resolution — sufficient for dev. */
function easProjectId(): string | undefined {
  const fromExtra =
    (Constants.expoConfig as unknown as
      | { extra?: { eas?: { projectId?: string } } }
      | null
      | undefined)?.extra?.eas?.projectId;
  if (typeof fromExtra === "string" && fromExtra.length > 0) return fromExtra;
  return undefined;
}

type ExpoNotificationsModule = {
  setNotificationHandler: (
    handler: {
      handleNotification: () => Promise<{
        shouldShowAlert?: boolean;
        shouldShowBanner?: boolean;
        shouldShowList?: boolean;
        shouldPlaySound: boolean;
        shouldSetBadge: boolean;
      }>;
    },
  ) => void;
  getPermissionsAsync: () => Promise<{ status: string }>;
  requestPermissionsAsync: () => Promise<{ status: string }>;
  getExpoPushTokenAsync: (opts?: {
    projectId?: string;
  }) => Promise<{ data: string }>;
  setNotificationChannelAsync?: (
    name: string,
    channel: Record<string, unknown>,
  ) => Promise<void>;
  AndroidImportance?: { MAX: number; DEFAULT: number; HIGH: number };
  addNotificationReceivedListener: (
    cb: (n: { request: { content: { title?: string; body?: string; data?: unknown } } }) => void,
  ) => { remove: () => void };
  addNotificationResponseReceivedListener: (
    cb: (r: { notification: { request: { content: { data?: Record<string, unknown> } } } }) => void,
  ) => { remove: () => void };
};

/** Lazy-load expo-notifications. Returns null when the module isn't
 *  available (not yet merged into package.json). All callers must
 *  handle this gracefully. */
function loadExpoNotifications(): ExpoNotificationsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("expo-notifications") as ExpoNotificationsModule;
  } catch {
    return null;
  }
}

let foregroundHandlerInstalled = false;
let receivedSubscription: { remove: () => void } | null = null;
let responseSubscription: { remove: () => void } | null = null;

/** Callback the app registers so a tapped notification can deep-link
 *  into the right note. Set once at app boot from the root layout. */
let onResponseDeepLink: ((noteId: string) => void) | null = null;

export function setNotificationResponseHandler(handler: (noteId: string) => void) {
  onResponseDeepLink = handler;
}

/** Install the foreground notification presentation policy + a listener
 *  that logs (and could later toast). Idempotent. */
function installForegroundHandler(N: ExpoNotificationsModule) {
  if (foregroundHandlerInstalled) return;
  foregroundHandlerInstalled = true;

  N.setNotificationHandler({
    handleNotification: async () => ({
      // Both legacy + SDK 56 keys so we don't break across versions.
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

  receivedSubscription = N.addNotificationReceivedListener((n) => {
    const title = n.request.content.title ?? "(no title)";
    const body = n.request.content.body ?? "";
    // TODO: wire to a toast component when one lands. For now log so the
    // founder can verify e2e from a debug build.
    console.log("[wend.push] received in-app:", title, "—", body);
  });

  // Tap-to-deep-link: when the user opens a push notification, route to
  // the note that completed. The notification carries data.noteId set
  // by whichever route fired the push (Mac daemon or cloud container).
  responseSubscription = N.addNotificationResponseReceivedListener((resp) => {
    const data = resp.notification.request.content.data ?? {};
    const noteId = typeof data.noteId === "string" ? data.noteId : "";
    if (!noteId) return;
    if (onResponseDeepLink) {
      onResponseDeepLink(noteId);
    } else {
      // App not yet wired; stash for the layout effect to pick up.
      pendingDeepLink = noteId;
    }
  });
}

let pendingDeepLink: string | null = null;
export function consumePendingDeepLink(): string | null {
  const v = pendingDeepLink;
  pendingDeepLink = null;
  return v;
}

/** Configure an Android notification channel. Required for visible
 *  heads-up display on Android 8+. No-op elsewhere. */
async function ensureAndroidChannel(N: ExpoNotificationsModule) {
  if (Platform.OS !== "android") return;
  if (!N.setNotificationChannelAsync) return;
  await N.setNotificationChannelAsync("default", {
    name: "Wend",
    importance: N.AndroidImportance?.HIGH ?? 4,
    lightColor: "#D85A3C",
    vibrationPattern: [0, 250, 250, 250],
  });
}

export interface RegisterPushArgs {
  /** Clerk user id of the currently authed user. */
  userId: string;
  /** Function that returns a fresh Clerk JWT for the backend. Provided by
   *  the Clerk SDK's `useAuth().getToken`. */
  getToken: () => Promise<string | null>;
}

/**
 * Request permission + fetch + register the device's Expo push token.
 * Safe to call on every sign-in; the slice short-circuits if the same
 * token was already registered for the same user.
 *
 * Returns the token on success, or null when permission was denied /
 * the module wasn't installed / a network error occurred. NEVER throws.
 */
export async function ensurePushNotificationsRegistered(
  args: RegisterPushArgs,
): Promise<string | null> {
  const N = loadExpoNotifications();
  if (!N) {
    console.log(
      "[wend.push] expo-notifications not installed — skipping. " +
        "Merge the additions documented at the top of src/lib/notifications.ts.",
    );
    return null;
  }

  // Install handlers up front so notifications that land before the
  // (token-) registration step still display correctly.
  try {
    installForegroundHandler(N);
    await ensureAndroidChannel(N);
  } catch (err) {
    console.log("[wend.push] handler install failed:", err);
  }

  // Permission: prompt only if not already determined. SDK 56's
  // `requestPermissionsAsync` is idempotent — calling it when already
  // granted returns the existing status, never re-prompts.
  let status: string;
  try {
    const existing = await N.getPermissionsAsync();
    status = existing.status;
    if (status !== "granted") {
      const req = await N.requestPermissionsAsync();
      status = req.status;
    }
  } catch (err) {
    console.log("[wend.push] permission check failed:", err);
    return null;
  }
  if (status !== "granted") {
    console.log("[wend.push] permission not granted; skipping registration");
    return null;
  }

  // Fetch token. May throw on simulator / Expo Go without a projectId.
  let token: string;
  try {
    const projectId = easProjectId();
    const res = await N.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    token = res.data;
  } catch (err) {
    console.log("[wend.push] getExpoPushTokenAsync failed:", err);
    return null;
  }
  if (!token || token.length === 0) return null;

  // Short-circuit if we've already registered this exact token for this user.
  const slice = useNotificationsStore.getState();
  if (slice.userId === args.userId && slice.token === token) {
    // Touch lastRegisteredAt anyway so the value reflects most recent boot.
    slice.markRegistered(args.userId, token);
    return token;
  }

  // POST to backend with Clerk JWT.
  let jwt: string | null = null;
  try {
    jwt = await args.getToken();
  } catch (err) {
    console.log("[wend.push] getToken failed:", err);
  }
  if (!jwt) {
    // Without a JWT we can't authorize the register call. Cache the
    // token locally so a later sign-in can replay.
    slice.setPendingToken(token);
    return token;
  }

  const platform: "ios" | "android" | "other" =
    Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "other";

  try {
    const res = await fetch(`${BACKEND_BASE}/api/notifications/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ token, platform }),
    });
    if (!res.ok) {
      console.log(
        `[wend.push] register HTTP ${res.status} — leaving slice unchanged`,
      );
      slice.setPendingToken(token);
      return token;
    }
    slice.markRegistered(args.userId, token);
    return token;
  } catch (err) {
    console.log("[wend.push] register network error:", err);
    slice.setPendingToken(token);
    return token;
  }
}

/** Cleanup hook — call from a top-level component's unmount path if
 *  you ever need to dispose of the foreground listener. The current
 *  app lifecycle doesn't, but we expose it for testing. */
export function disposePushNotifications() {
  if (receivedSubscription) {
    receivedSubscription.remove();
    receivedSubscription = null;
  }
  if (responseSubscription) {
    responseSubscription.remove();
    responseSubscription = null;
  }
  foregroundHandlerInstalled = false;
}
