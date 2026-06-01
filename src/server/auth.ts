/**
 * Wend — Better Auth server configuration.
 *
 * SERVER-ONLY. This is the auth instance the backend mounts at /api/auth/*.
 * It is intentionally separated from the RN client (src/auth/client.ts).
 *
 * Phase 1 status: there is no deployed backend yet. This config is complete and
 * correct so that, the moment the founder stands up a backend (a Next.js route
 * handler, a Hono server, an Expo API route — anything that can call
 * `auth.handler(request)`), auth works. Until then the app uses the dev-stub
 * sign-in (no backend required) — see src/auth/client.ts.
 *
 * Google OAuth is GATED behind env: if GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 * are absent, the Google social provider is simply not registered and the app
 * falls back to dev-stub. The founder adds those two server env vars (NOT
 * EXPO_PUBLIC_*) once they create a Google Cloud OAuth client, then flips
 * EXPO_PUBLIC_GOOGLE_ENABLED=true so the client offers the real button.
 *
 * Drizzle adapter targets the SHARED Neon DB and the Better Auth core tables in
 * src/db/schema.ts (user/session/account/verification).
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { expo } from "@better-auth/expo";

import { getDb } from "@/db/client";
import * as schema from "@/db/schema";

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

/** True only when BOTH halves of the Google OAuth credential exist. */
export const isGoogleConfigured = Boolean(
  googleClientId && googleClientSecret,
);

/**
 * Lazily build the auth instance so importing this module never touches the DB
 * or env (keeps tooling/bundling happy). The backend calls `getAuth()` once and
 * reuses the result.
 */
let _auth: ReturnType<typeof buildAuth> | null = null;

function buildAuth() {
  if (!isGoogleConfigured) {
    // eslint-disable-next-line no-console
    console.warn(
      "[wend/auth] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — real " +
        "Google sign-in is DISABLED. The app will use dev-stub sign-in. Set " +
        "both server env vars and EXPO_PUBLIC_GOOGLE_ENABLED=true to enable.",
    );
  }

  return betterAuth({
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    // Trusted origins: the Expo deep-link scheme + the dev tunnel. Extend with
    // the production API origin once deployed.
    trustedOrigins: ["wend://", "exp://"],
    // Google is the ONLY social provider for v1 (Android beachhead — no Apple).
    // Registered only when configured; otherwise dev-stub handles sign-in.
    socialProviders: isGoogleConfigured
      ? {
          google: {
            clientId: googleClientId as string,
            clientSecret: googleClientSecret as string,
          },
        }
      : {},
    // The Expo plugin enables the secure-store session cookie bridge + the
    // deep-link OAuth redirect handling on the native client.
    plugins: [expo()],
  });
}

/**
 * Lazily build + memoize the auth instance. The backend calls this once and
 * reuses the result (the /api/auth/* handler is `getAuth().handler`).
 */
export function getAuth() {
  if (!_auth) _auth = buildAuth();
  return _auth;
}
