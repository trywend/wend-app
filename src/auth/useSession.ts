/**
 * Wend — Clerk → zustand session mirror.
 *
 * When Clerk is configured (publishable key present), we subscribe to Clerk's
 * session state and project it into useAuthStore. When NOT configured we
 * export a no-op variant that just marks the store as anon — calling Clerk's
 * hooks without a ClerkProvider would throw at runtime. The choice happens
 * at module load (env vars are constants once Metro starts), so the consumer
 * just imports `useSessionBootstrap` and the right implementation runs.
 */
import { useEffect } from "react";
import { useAuth, useUser } from "@clerk/clerk-expo";

import { useAuthStore } from "@/store/authSlice";
import { isClerkConfigured } from "@/config/env";

function useSessionBootstrapWithClerk() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const setSession = useAuthStore((s) => s.setSession);
  const setLoading = useAuthStore((s) => s.setLoading);

  useEffect(() => {
    if (!isLoaded) {
      setLoading();
      return;
    }
    if (isSignedIn && user) {
      setSession({
        id: user.id,
        email: user.primaryEmailAddress?.emailAddress ?? "",
        name: user.fullName,
      });
    } else {
      setSession(null);
    }
  }, [isLoaded, isSignedIn, user, setSession, setLoading]);
}

function useSessionBootstrapWithoutClerk() {
  // No Clerk → keep the store at anon so the route gate sends user to sign-in,
  // where they see the "Clerk publishable key not set" caption.
  const setSession = useAuthStore((s) => s.setSession);
  useEffect(() => {
    setSession(null);
  }, [setSession]);
}

export const useSessionBootstrap = isClerkConfigured
  ? useSessionBootstrapWithClerk
  : useSessionBootstrapWithoutClerk;
