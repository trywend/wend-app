/**
 * Wend — daemon connection store (zustand, persisted).
 *
 * Holds the URL + token the phone uses to dispatch to the user's Mac
 * daemon. Set by scanning the QR code from Wend.app's onboarding window
 * (or pasting the pairing JSON manually). Persists across relaunches via
 * AsyncStorage so the user doesn't have to re-scan every cold launch.
 *
 * When the slice has a value, it takes priority over the env-var defaults
 * (`EXPO_PUBLIC_DAEMON_URL` / `_TOKEN`). Env stays in place as a fallback
 * for dev — it's how we used the spike daemon before this scanner existed.
 *
 * Phase 4+ will add: backend-issued tailscale auth keys, multi-device
 * pairing, key rotation. For now the slice just holds whatever the QR
 * payload said.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { zustandStorage } from "./storage";

/**
 * Shape that Wend.app's QR code encodes. Mirrors `PairingPayload.swift`
 * in `~/Desktop/Wend/mac-daemon/Sources/WendApp/`. `v` is the protocol
 * version — bump on the Mac side first, then teach the phone about new
 * fields.
 */
export interface PairingPayload {
  v: number;
  url: string;
  token: string;
  host: string;
  /** Mac-side timestamp (ms epoch). Surfaces in the UI as "paired N
   *  minutes ago"; not used for staleness checks yet. */
  issued: number;
}

interface DaemonState {
  /** Public URL of the user's Mac daemon (Funnel ts.net URL, ngrok, or
   *  a 127.0.0.1 dev URL). Empty when not paired. */
  url: string;
  /** Bearer token the daemon expects. Empty when not paired. */
  token: string;
  /** Friendly Mac name from `scutil --get ComputerName`. Surfaced as
   *  "Connected to Agnij's MacBook Pro" in the Settings row. */
  host: string;
  /** ms epoch when the QR was issued by Wend.app. */
  issuedAt: number;
  /** ms epoch when the phone accepted the payload (now). Distinct from
   *  issuedAt — the QR could be hours old by the time the phone scans. */
  pairedAt: number;

  /** Accept a freshly-scanned pairing payload. Replaces any prior pairing. */
  setPaired: (payload: PairingPayload) => void;
  /** Forget the current pairing. Called from Settings "Disconnect Mac". */
  clear: () => void;
}

export const useDaemonStore = create<DaemonState>()(
  persist(
    (set) => ({
      url: "",
      token: "",
      host: "",
      issuedAt: 0,
      pairedAt: 0,
      setPaired: (payload) =>
        set({
          url: payload.url,
          token: payload.token,
          host: payload.host,
          issuedAt: payload.issued,
          pairedAt: Date.now(),
        }),
      clear: () =>
        set({ url: "", token: "", host: "", issuedAt: 0, pairedAt: 0 }),
    }),
    {
      name: "wend.daemon.v1",
      storage: createJSONStorage(() => zustandStorage),
    },
  ),
);

/**
 * Validate a string the user just scanned (or pasted) as a pairing
 * payload. Returns the parsed payload if valid, else an error message.
 * Centralized here so the scanner sheet and any future manual-paste UI
 * share one parser.
 */
export function parsePairingString(
  raw: string,
): { ok: true; payload: PairingPayload } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Couldn't parse the code as JSON." };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "Pairing payload was not a JSON object." };
  }
  const p = parsed as Partial<PairingPayload>;
  if (p.v !== 1) {
    return {
      ok: false,
      error: `Unsupported pairing version (got v=${String(p.v)}, need v=1). Update the Wend Mac app.`,
    };
  }
  if (typeof p.url !== "string" || p.url.length === 0) {
    return { ok: false, error: "Pairing payload is missing the daemon URL." };
  }
  if (typeof p.token !== "string" || p.token.length === 0) {
    return { ok: false, error: "Pairing payload is missing the token." };
  }
  if (typeof p.host !== "string") {
    return { ok: false, error: "Pairing payload is missing the host name." };
  }
  if (typeof p.issued !== "number") {
    return { ok: false, error: "Pairing payload is missing the issued timestamp." };
  }
  return {
    ok: true,
    payload: {
      v: p.v,
      url: p.url,
      token: p.token,
      host: p.host,
      issued: p.issued,
    },
  };
}
