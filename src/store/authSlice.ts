/**
 * Wend — auth store slice (zustand).
 *
 * Holds the resolved session for the protected-route gate to read. Better Auth
 * owns the real session lifecycle + secure persistence; this slice is the
 * app-facing projection of it plus the dev-stub session (when no Google env is
 * configured — see src/auth/client.ts).
 *
 *   status "loading"  — initial; we don't know yet (avoids a sign-in flash)
 *   status "authed"   — session present
 *   status "anon"     — no session; route gate sends to (auth)/sign-in
 */
import { create } from "zustand";

export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  /** true when this is a local dev-stub session (no real Google sign-in). */
  isDevStub?: boolean;
}

type AuthStatus = "loading" | "authed" | "anon";

interface AuthState {
  status: AuthStatus;
  user: SessionUser | null;
  setSession: (user: SessionUser | null) => void;
  setLoading: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "loading",
  user: null,
  setSession: (user) =>
    set({ user, status: user ? "authed" : "anon" }),
  setLoading: () => set({ status: "loading" }),
}));
