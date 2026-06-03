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
 * QR payload shape Wend.app encodes. Two versions coexist — mirror of
 * `PairingPayload.swift` in `~/Desktop/Wend/mac-daemon/Sources/WendApp/`:
 *
 *   v1 — direct URL routing. `{v:1, url, token, host, issued}`. The
 *        phone POSTs straight to `url`. Token authorizes the daemon.
 *
 *   v2 — rendezvous routing. `{v:2, deviceId, token, host, issued,
 *        url?}`. Phone resolves the live URL via
 *        `GET /api/devices/:deviceId` on the trywend.app backend; same
 *        token authorizes both the rendezvous fetch and the direct
 *        daemon call. `url` is an optional hint, used as a fallback if
 *        the rendezvous is unreachable on first dispatch.
 */
export interface PairingPayload {
  v: number;
  /** v1: required. v2: optional fallback hint. */
  url?: string;
  /** v2: required. v1: absent. Cardinal id for rendezvous lookups. */
  deviceId?: string;
  token: string;
  host: string;
  /** Mac-side timestamp (ms epoch). Surfaces in the UI as "paired N
   *  minutes ago"; not used for staleness checks yet. */
  issued: number;
}

interface DaemonState {
  /** Direct URL fallback. With a v2 pairing this is the `urlHint` from
   *  the QR; with v1 it's the canonical target. Always safe to use as a
   *  best-effort dispatch target. */
  url: string;
  /** Cardinal device identifier. Set only by v2 pairings. When present,
   *  the reconciler resolves `url` via the rendezvous backend. */
  deviceId: string;
  /** Bearer token. v1: the daemon's secret. v2: the device-scoped
   *  rendezvous token (which the daemon also accepts). Either way, this
   *  is what goes in `Authorization: Bearer` for every call. */
  token: string;
  /** Friendly Mac name from `scutil --get ComputerName`. Surfaced as
   *  "Paired with Agnij's MacBook Pro" in the Settings row. */
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
  /** Update the cached URL after a successful rendezvous resolve. The
   *  v2 path calls this whenever the backend reports a fresh URL.
   *  Doesn't touch deviceId / token / host. */
  setResolvedURL: (url: string) => void;
}

export const useDaemonStore = create<DaemonState>()(
  persist(
    (set) => ({
      url: "",
      deviceId: "",
      token: "",
      host: "",
      issuedAt: 0,
      pairedAt: 0,
      setPaired: (payload) =>
        set({
          url: payload.url ?? "",
          deviceId: payload.deviceId ?? "",
          token: payload.token,
          host: payload.host,
          issuedAt: payload.issued,
          pairedAt: Date.now(),
        }),
      clear: () =>
        set({
          url: "",
          deviceId: "",
          token: "",
          host: "",
          issuedAt: 0,
          pairedAt: 0,
        }),
      setResolvedURL: (url) => set({ url }),
    }),
    {
      // v2 bumped — old wend.daemon.v1 was {url, token, host} without
      // deviceId. The persist middleware will rehydrate misses to
      // defaults, so existing pairings drop back to v1-direct
      // (url/token only) until the user re-scans the new v2 QR.
      name: "wend.daemon.v2",
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
  if (p.v !== 1 && p.v !== 2) {
    return {
      ok: false,
      error: `Unsupported pairing version (got v=${String(p.v)}). Update the Wend Mac app.`,
    };
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

  if (p.v === 1) {
    if (typeof p.url !== "string" || p.url.length === 0) {
      return { ok: false, error: "Pairing payload is missing the daemon URL." };
    }
    return {
      ok: true,
      payload: {
        v: 1,
        url: p.url,
        token: p.token,
        host: p.host,
        issued: p.issued,
      },
    };
  }

  // v2 — deviceId mandatory, url optional hint.
  if (typeof p.deviceId !== "string" || p.deviceId.length === 0) {
    return { ok: false, error: "Pairing payload v2 is missing the deviceId." };
  }
  return {
    ok: true,
    payload: {
      v: 2,
      deviceId: p.deviceId,
      url: typeof p.url === "string" ? p.url : undefined,
      token: p.token,
      host: p.host,
      issued: p.issued,
    },
  };
}
