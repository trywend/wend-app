/**
 * Wend — Bonjour / mDNS discovery for the local-network pairing path.
 *
 * On the same WiFi as the Mac, the daemon advertises `_wend._tcp.local.`
 * with a TXT record that includes the cloudflared tunnel URL + a
 * version hint. The phone scans on launch of the Connect-Mac sheet; if
 * a service appears within `DISCOVERY_TIMEOUT_MS` the UI offers a
 * one-tap "Connect to <hostname>'s Mac" instead of the QR sheet.
 *
 * Library: `react-native-zeroconf` (NSNetService on iOS, NSD on Android).
 * Loaded via `require` so a dev client built before the package was
 * added doesn't crash on module eval — same pattern as `expo-camera`
 * in `ConnectMacSheet.tsx`. When the native module is missing the
 * `discoverDaemon` function returns null after a short delay and the
 * caller falls back to the QR scanner.
 *
 * iOS 14+ permission: requires `NSLocalNetworkUsageDescription` +
 * `NSBonjourServices: ["_wend._tcp"]` in Info.plist, wired through
 * `app.json -> ios.infoPlist`. First scan triggers the Local Network
 * prompt; the copy comes from `NSLocalNetworkUsageDescription`. If the
 * user denies, we silently fall through to the QR sheet — no surfaced
 * error, since the QR is the canonical path.
 *
 * Security: the discovered TXT-record URL + host name are not
 * trusted directly. We POST to `/v1/lan-pair` on the Mac and wait for
 * the user to approve from the Mac side. Only then does the Mac hand
 * over the token + final tunnel URL. Anyone on the same WiFi can claim
 * to be the daemon, but they can't impersonate the user's approval.
 */
import { Platform } from "react-native";

/** TXT records keyed by string. The Mac daemon publishes:
 *   - `url`     — current cloudflared tunnel URL (https://*.trycloudflare.com)
 *   - `host`    — friendly Mac name (`scutil --get ComputerName`)
 *   - `version` — daemon build version, e.g. "1.0.0"
 *   - `pk`      — Ed25519 pubkey (base64), placeholder for future
 *                 identity proof. Not validated by the phone yet.
 *
 *  Apple's zeroconf docs allow up to 255 bytes per TXT record value;
 *  we stay well under that even with a long https URL. */
export interface WendBonjourTxt {
  url?: string;
  host?: string;
  version?: string;
  pk?: string;
}

export interface DiscoveredDaemon {
  /** mDNS service name, typically the Mac's hostname. */
  name: string;
  /** `_wend._tcp.` */
  type: string;
  /** First resolved IPv4 (or IPv6 fallback). Informational; the
   *  tunnel URL in TXT is what we actually POST against. */
  host: string;
  /** Local-network port the daemon's HTTP server binds (9876 default).
   *  Used for `/v1/lan-pair`. */
  port: number;
  /** TXT records parsed into a typed shape. Mac daemon controls all
   *  keys here — see `BonjourAdvertiser.swift`. */
  txt: WendBonjourTxt;
}

/** Service type the Mac advertises. Keep in sync with
 *  `BonjourAdvertiser.swift` and the `NSBonjourServices` entry in
 *  `app.json`. */
export const WEND_SERVICE_TYPE = "wend";
export const WEND_SERVICE_PROTOCOL = "tcp";
export const WEND_SERVICE_DOMAIN = "local.";

/** Hard ceiling on how long we wait for Bonjour to surface a daemon
 *  before falling through to the QR sheet. The task brief calls for
 *  ~3s; we err slightly higher (3500ms) to absorb the iOS Local
 *  Network permission prompt round-trip on first launch. */
export const DISCOVERY_TIMEOUT_MS = 3500;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ZeroconfModule: any = null;
let zeroconfLoadError: string | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ZeroconfModule = require("react-native-zeroconf").default;
} catch (err) {
  zeroconfLoadError =
    err instanceof Error ? err.message : "react-native-zeroconf not available";
}

export function isBonjourAvailable(): boolean {
  return Boolean(ZeroconfModule);
}

export function bonjourLoadError(): string | null {
  return zeroconfLoadError;
}

/** Fire-and-forget: kick off an mDNS scan, resolve the first matching
 *  service, and stop. Resolves to null if nothing surfaces within
 *  `DISCOVERY_TIMEOUT_MS`, or if the native module isn't linked, or if
 *  the user denied Local Network access (we can't distinguish denied
 *  from "nothing found" from JS, so both paths look the same). */
export async function discoverDaemon(
  timeoutMs: number = DISCOVERY_TIMEOUT_MS,
): Promise<DiscoveredDaemon | null> {
  if (!ZeroconfModule) {
    // eslint-disable-next-line no-console
    console.warn("[bonjour] native module not linked:", zeroconfLoadError);
    await new Promise((r) => setTimeout(r, 50));
    return null;
  }
  const zc = new ZeroconfModule();
  // eslint-disable-next-line no-console
  console.log("[bonjour] discovery starting", {
    type: WEND_SERVICE_TYPE,
    protocol: WEND_SERVICE_PROTOCOL,
    domain: WEND_SERVICE_DOMAIN,
    timeoutMs,
  });

  return new Promise<DiscoveredDaemon | null>((resolve) => {
    let settled = false;
    const finish = (value: DiscoveredDaemon | null, reason: string) => {
      if (settled) return;
      settled = true;
      // eslint-disable-next-line no-console
      console.log("[bonjour] discovery finished", {
        found: Boolean(value),
        reason,
      });
      try {
        zc.stop();
        zc.removeDeviceListeners();
      } catch {
        // best-effort cleanup
      }
      resolve(value);
    };

    const timer = setTimeout(() => finish(null, "timeout"), timeoutMs);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    zc.on("start", () => console.log("[bonjour] event:start"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    zc.on("stop", () => console.log("[bonjour] event:stop"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    zc.on("found", (name: any) =>
      // eslint-disable-next-line no-console
      console.log("[bonjour] event:found", name),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    zc.on("update", () => console.log("[bonjour] event:update"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    zc.on("resolved", (service: any) => {
      // eslint-disable-next-line no-console
      console.log("[bonjour] event:resolved", {
        name: service?.name,
        host: service?.host,
        port: service?.port,
        addresses: service?.addresses,
        txt: service?.txt,
      });
      clearTimeout(timer);
      const txtRaw = (service?.txt as Record<string, string> | undefined) ?? {};
      finish(
        {
          name: String(service?.name ?? "Mac"),
          type: String(
            service?.type ?? `_${WEND_SERVICE_TYPE}._${WEND_SERVICE_PROTOCOL}`,
          ),
          host: String(service?.host ?? service?.addresses?.[0] ?? ""),
          port: Number(service?.port ?? 9876),
          txt: {
            url: typeof txtRaw.url === "string" ? txtRaw.url : undefined,
            host: typeof txtRaw.host === "string" ? txtRaw.host : undefined,
            version:
              typeof txtRaw.version === "string" ? txtRaw.version : undefined,
            pk: typeof txtRaw.pk === "string" ? txtRaw.pk : undefined,
          },
        },
        "resolved",
      );
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    zc.on("error", (err: any) => {
      // eslint-disable-next-line no-console
      console.warn("[bonjour] event:error", err);
      finish(null, "error");
    });

    try {
      zc.scan(WEND_SERVICE_TYPE, WEND_SERVICE_PROTOCOL, WEND_SERVICE_DOMAIN);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[bonjour] scan threw", err);
      finish(null, "scan-threw");
    }
  });
}

/* ─── LAN pair handshake ──────────────────────────────────────────── */

/** POST /v1/lan-pair body. The Mac displays an NSAlert with the
 *  `phoneName` and the user approves or rejects. */
export interface LanPairRequest {
  /** Random 32-byte hex string. Phone-generated. Doesn't authenticate
   *  anything yet — the next-iteration spec will key it to the Mac's
   *  TXT-record pubkey. */
  nonce: string;
  /** Human-readable label for the NSAlert. `Device.modelName` on iOS
   *  ("iPhone 15 Pro") + optional user-chosen suffix. */
  phoneName: string;
}

export interface LanPairPending {
  status: "pending";
  id: string;
}

export interface LanPairReady {
  status: "ready";
  /** Tunnel URL the phone uses for subsequent dispatches. Identical
   *  to what a v1/v2 QR pairing would have produced. */
  url: string;
  /** Bearer token. v2 rendezvous token if the Mac is registered;
   *  v1 fallback token otherwise. */
  token: string;
  /** Friendly Mac name. */
  host: string;
  /** Optional v2 deviceId — set when the Mac is registered with the
   *  rendezvous. Phone uses it the same way as a v2 QR payload. */
  deviceId?: string;
}

export type LanPairResult =
  | LanPairPending
  | LanPairReady
  | { status: "rejected"; reason: string }
  | { status: "error"; reason: string };

/** Generate a cryptographically-meh nonce. Doesn't need to be secure
 *  for now — the Mac-side approval is what gates the token release. */
export function generateNonce(): string {
  let out = "";
  const chars = "0123456789abcdef";
  for (let i = 0; i < 64; i++) {
    out += chars[Math.floor(Math.random() * 16)];
  }
  return out;
}

/** Build the local-network HTTP base for the Bonjour-discovered Mac.
 *  Uses raw IPv4/IPv6 host because `.local.` mDNS hostnames are only
 *  resolvable while the Bonjour listener is active. */
export function lanBaseFor(d: DiscoveredDaemon): string {
  // IPv6 must be bracketed when in a URL.
  const isV6 = d.host.includes(":") && !d.host.includes(".");
  const host = isV6 ? `[${d.host}]` : d.host;
  return `http://${host}:${d.port}`;
}

/** POST /v1/lan-pair. Returns the pending-approval id on 202. */
export async function startLanPair(
  daemon: DiscoveredDaemon,
  req: LanPairRequest,
  signal?: AbortSignal,
): Promise<LanPairPending | { status: "error"; reason: string }> {
  const base = lanBaseFor(daemon);
  try {
    const res = await fetch(`${base}/v1/lan-pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      signal,
    });
    if (res.status === 202) {
      const body = (await res.json()) as { id?: string };
      if (typeof body.id === "string" && body.id.length > 0) {
        return { status: "pending", id: body.id };
      }
      return { status: "error", reason: "Mac returned no pairing id." };
    }
    return {
      status: "error",
      reason: `Mac rejected the pairing request (HTTP ${res.status}).`,
    };
  } catch (err) {
    // ECONNREFUSED, network down, etc.
    return {
      status: "error",
      reason:
        err instanceof Error ? err.message : "Couldn't reach your Mac on the local network.",
    };
  }
}

/** Poll GET /v1/lan-pair/<id> until the user approves on the Mac or
 *  the request expires. The Mac returns:
 *    - 202 + {status:"pending"}            while waiting
 *    - 200 + {status:"ready", url, token,
 *             host, deviceId?}             on approval
 *    - 410 + {error:"rejected"|"expired"}  on terminal failure
 *
 *  We poll every `intervalMs` (default 1500ms) up to `maxMs`
 *  (default 90s, slightly above the Mac's 60s timeout to absorb
 *  clock skew). */
export async function pollLanPair(
  daemon: DiscoveredDaemon,
  pairId: string,
  opts: {
    intervalMs?: number;
    maxMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<LanPairResult> {
  const intervalMs = opts.intervalMs ?? 1500;
  const maxMs = opts.maxMs ?? 90_000;
  const base = lanBaseFor(daemon);
  const deadline = Date.now() + maxMs;

  // Loop until we resolve or exceed maxMs.
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) {
      return { status: "error", reason: "Cancelled." };
    }
    try {
      const res = await fetch(`${base}/v1/lan-pair/${encodeURIComponent(pairId)}`, {
        method: "GET",
        signal: opts.signal,
      });
      if (res.status === 200) {
        const body = (await res.json()) as Partial<LanPairReady> & {
          status?: string;
        };
        if (
          body.status === "ready" &&
          typeof body.url === "string" &&
          typeof body.token === "string" &&
          typeof body.host === "string"
        ) {
          return {
            status: "ready",
            url: body.url,
            token: body.token,
            host: body.host,
            deviceId:
              typeof body.deviceId === "string" && body.deviceId.length > 0
                ? body.deviceId
                : undefined,
          };
        }
        return { status: "error", reason: "Mac returned an unexpected response." };
      }
      if (res.status === 202) {
        // Pending — keep polling.
      } else if (res.status === 410) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const reason =
          body.error === "expired"
            ? "Pairing request timed out."
            : body.error === "rejected"
              ? "Mac rejected the pairing request."
              : "Mac closed the pairing request.";
        return {
          status: body.error === "rejected" ? "rejected" : "error",
          reason,
        };
      } else {
        return {
          status: "error",
          reason: `Mac returned HTTP ${res.status}.`,
        };
      }
    } catch (err) {
      if (opts.signal?.aborted) {
        return { status: "error", reason: "Cancelled." };
      }
      // Transient — keep polling until deadline.
      // eslint-disable-next-line no-console
      console.warn("[bonjour] poll error", err);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { status: "error", reason: "Pairing request timed out." };
}

/** Build a friendly default for the NSAlert that pops on the Mac.
 *  Stays Apple-clean even when `expo-device` isn't available — falls
 *  back to a generic "iPhone" / "Android" label. */
export function defaultPhoneName(): string {
  // expo-device is already a transitive dep of the project; load it
  // lazily so this lib stays usable from test contexts.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const Device = require("expo-device") as any;
    const model = Device?.modelName as string | undefined;
    if (model && model.length > 0) return model;
  } catch {
    // ignore
  }
  return Platform.OS === "ios" ? "iPhone" : Platform.OS === "android" ? "Android phone" : "Phone";
}
