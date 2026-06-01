/**
 * Wend — typed env access.
 *
 * Expo inlines any EXPO_PUBLIC_* var into the client bundle at build time.
 * Server-only secrets (DATABASE_URL etc.) never appear here.
 *
 * Auth: Clerk. The publishable key is the only env the React Native client
 * needs — Clerk hosts the OAuth flow, so no backend deploy is required for
 * Google sign-in to work in development.
 */

export const clerkPublishableKey =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

export const isClerkConfigured = clerkPublishableKey.length > 0;

/** Deep-link scheme — Clerk uses this for the OAuth redirect back into the app. */
export const authScheme = "wend";

/* ─── Dispatch daemon (Phase 0 spike) ──────────────────────────────────
 * URL + bearer token for the Node spike daemon (`~/Desktop/Wend/spike/
 * daemon.mjs`) running on the user's Mac, tunneled via ngrok. The phone
 * POSTs `/run` to dispatch a prompt; the daemon spawns `claude -p` and
 * streams SSE back. Phase 3 replaces this with a Swift launchd daemon
 * over Tailscale, but the API surface stays.
 *
 * Optional cwd lets the founder pin all dispatches to a specific project
 * directory. Falls through to the daemon's default (homedir) when unset.
 */
export const daemonUrl = process.env.EXPO_PUBLIC_DAEMON_URL ?? "";
export const daemonToken = process.env.EXPO_PUBLIC_DAEMON_TOKEN ?? "";
export const daemonCwd = process.env.EXPO_PUBLIC_DAEMON_CWD ?? "";

export const isDaemonConfigured =
  daemonUrl.length > 0 && daemonToken.length > 0;
