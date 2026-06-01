/**
 * Wend — Clerk-backed auth primitives.
 *
 * Clerk handles the OAuth flow + session lifecycle. This module exposes thin
 * hooks so the rest of the app doesn't import Clerk directly (one swap point
 * if we ever change providers).
 *
 * Three sign-in paths:
 *   - OAuth Google  (useGoogleSignIn)
 *   - OAuth GitHub  (useGithubSignIn)
 *   - Email + code  (useEmailSignIn: sendCode / verifyCode)
 *
 * Module-level dispatch on isClerkConfigured: the no-key variants are safe
 * no-ops so screens calling these hooks at the top of their bodies don't crash
 * before the founder pastes the publishable key. Once Metro restarts with the
 * key, the Clerk variants take over.
 */
import { useCallback, useRef } from "react";
import { useOAuth, useAuth, useSignIn, useSignUp } from "@clerk/clerk-expo";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";

import { isClerkConfigured } from "@/config/env";

// Idempotent. Required so the system browser closes cleanly on OAuth return.
WebBrowser.maybeCompleteAuthSession();

// -------- OAuth (Google + GitHub) -----------------------------------------

function useOAuthSignIn(strategy: "oauth_google" | "oauth_github") {
  const { startOAuthFlow } = useOAuth({ strategy });

  return useCallback(async () => {
    // Send Clerk back to the app's root. AuthGate sees the active session and
    // routes to (app) — we don't need a dedicated callback screen. Without
    // this, Clerk defaults to `wend://oauth-native-callback`, which Expo
    // Router resolves as Unmatched Route.
    const redirectUrl = Linking.createURL("/");
    const result = await startOAuthFlow({ redirectUrl });

    // Happy path — Clerk created a session.
    if (result.createdSessionId && result.setActive) {
      await result.setActive({ session: result.createdSessionId });
      return;
    }

    // User dismissed the browser tab.
    if (result.authSessionResult?.type === "cancel") return;

    // OAuth completed but no session yet — Clerk needs us to either transfer
    // (existing user with this email signed up via a different provider) or
    // finish a sign-up. We attempt the transfer path because the most common
    // case is: user signed up with Google, now taps GitHub with the same email.
    const signInRef = result.signIn;
    const signUpRef = result.signUp;

    const signInStatus = signInRef?.firstFactorVerification?.status;
    const signUpStatus = signUpRef?.verifications?.externalAccount?.status;

    if (signInStatus === "transferable" && signUpRef) {
      const transferred = await signUpRef.create({ transfer: true });
      if (transferred.createdSessionId && result.setActive) {
        await result.setActive({ session: transferred.createdSessionId });
        return;
      }
    }

    if (signUpStatus === "transferable" && signInRef) {
      const transferred = await signInRef.create({ transfer: true });
      if (transferred.createdSessionId && result.setActive) {
        await result.setActive({ session: transferred.createdSessionId });
        return;
      }
    }

    // Surface a more useful error than "did not produce a session". The most
    // likely real cause: the provider isn't enabled in the Clerk dashboard.
    const provider = strategy === "oauth_google" ? "Google" : "GitHub";
    throw new Error(
      `${provider} sign-in did not complete. Make sure ${provider} is enabled in the Clerk dashboard (Configure → SSO Connections).`,
    );
  }, [startOAuthFlow, strategy]);
}

function useGoogleSignInWithClerk() {
  return useOAuthSignIn("oauth_google");
}

function useGithubSignInWithClerk() {
  return useOAuthSignIn("oauth_github");
}

// -------- Email + verification code ---------------------------------------

export type EmailMode = "signin" | "signup";

export interface EmailSignIn {
  /** Step 1: ask Clerk to send a 6-digit code to the given email. Returns the
   *  mode (signin if user exists, signup if we just created the account) so
   *  the UI can show the right copy on the verify screen. */
  sendCode: (email: string) => Promise<EmailMode>;
  /** Step 2: verify the code the user typed. Activates the session on success. */
  verifyCode: (code: string) => Promise<void>;
  /** Resend a code without re-running the create() step. */
  resendCode: () => Promise<void>;
}

function useEmailSignInWithClerk(): EmailSignIn {
  const { signIn, setActive: setActiveSignIn, isLoaded: signInLoaded } = useSignIn();
  const { signUp, setActive: setActiveSignUp, isLoaded: signUpLoaded } = useSignUp();

  // Remember which flow we're in across the send/verify hop.
  const modeRef = useRef<EmailMode>("signin");

  const sendCode = useCallback(
    async (email: string): Promise<EmailMode> => {
      if (!signInLoaded || !signUpLoaded || !signIn || !signUp) {
        throw new Error("Clerk is still loading. Try again in a moment.");
      }
      // Try existing-user sign-in first.
      try {
        const attempt = await signIn.create({ identifier: email });
        const emailFactor = attempt.supportedFirstFactors?.find(
          (f) => f.strategy === "email_code",
        );
        if (!emailFactor || !("emailAddressId" in emailFactor)) {
          throw new Error("Email code not available for this account");
        }
        await signIn.prepareFirstFactor({
          strategy: "email_code",
          emailAddressId: emailFactor.emailAddressId,
        });
        modeRef.current = "signin";
        return "signin";
      } catch (err: unknown) {
        // If no such user, fall through to sign-up.
        const code = extractClerkErrorCode(err);
        if (code !== "form_identifier_not_found") throw err;
      }

      await signUp.create({ emailAddress: email });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      modeRef.current = "signup";
      return "signup";
    },
    [signIn, signUp, signInLoaded, signUpLoaded],
  );

  const verifyCode = useCallback(
    async (code: string): Promise<void> => {
      if (modeRef.current === "signin") {
        if (!signIn) throw new Error("Clerk not loaded");
        const result = await signIn.attemptFirstFactor({
          strategy: "email_code",
          code,
        });
        if (result.status === "complete" && result.createdSessionId) {
          await setActiveSignIn({ session: result.createdSessionId });
          return;
        }
        throw new Error("Sign-in incomplete");
      }
      if (!signUp) throw new Error("Clerk not loaded");
      const result = await signUp.attemptEmailAddressVerification({ code });
      if (result.status === "complete" && result.createdSessionId) {
        await setActiveSignUp({ session: result.createdSessionId });
        return;
      }
      throw new Error("Sign-up incomplete");
    },
    [signIn, signUp, setActiveSignIn, setActiveSignUp],
  );

  const resendCode = useCallback(async () => {
    if (modeRef.current === "signin") {
      if (!signIn) return;
      const emailFactor = signIn.supportedFirstFactors?.find(
        (f) => f.strategy === "email_code",
      );
      if (emailFactor && "emailAddressId" in emailFactor) {
        await signIn.prepareFirstFactor({
          strategy: "email_code",
          emailAddressId: emailFactor.emailAddressId,
        });
      }
      return;
    }
    if (!signUp) return;
    await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
  }, [signIn, signUp]);

  return { sendCode, verifyCode, resendCode };
}

function extractClerkErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const maybe = err as { errors?: Array<{ code?: string }>; code?: string };
  return maybe.errors?.[0]?.code ?? maybe.code;
}

// -------- Stubs (used when Clerk key is missing) ---------------------------

function useSignInStub(provider: string) {
  return useCallback(async () => {
    // eslint-disable-next-line no-console
    console.warn(
      `[wend/auth] ${provider} sign-in disabled — set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in .env.local`,
    );
  }, [provider]);
}

function useGoogleSignInStub() {
  return useSignInStub("google");
}

function useGithubSignInStub() {
  return useSignInStub("github");
}

function useEmailSignInStub(): EmailSignIn {
  return {
    sendCode: async () => {
      // eslint-disable-next-line no-console
      console.warn("[wend/auth] email sign-in disabled — Clerk key missing");
      return "signin";
    },
    verifyCode: async () => {},
    resendCode: async () => {},
  };
}

// -------- Sign-out ---------------------------------------------------------

function useSignOutWithClerk() {
  const { signOut } = useAuth();
  return useCallback(async () => {
    await signOut();
  }, [signOut]);
}

function useSignOutStub() {
  return useCallback(async () => {}, []);
}

// -------- Public exports ---------------------------------------------------

export const useGoogleSignIn = isClerkConfigured
  ? useGoogleSignInWithClerk
  : useGoogleSignInStub;

export const useGithubSignIn = isClerkConfigured
  ? useGithubSignInWithClerk
  : useGithubSignInStub;

export const useEmailSignIn = isClerkConfigured
  ? useEmailSignInWithClerk
  : useEmailSignInStub;

export const useSignOut = isClerkConfigured
  ? useSignOutWithClerk
  : useSignOutStub;
