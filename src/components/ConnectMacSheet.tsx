/**
 * Wend — ConnectMacSheet.
 *
 * Camera-based QR scanner that pairs the phone with the Wend Mac app.
 *
 * Source of truth on the Mac side: `~/Desktop/Wend/mac-daemon/Sources/
 * WendApp/PairingPayload.swift`. The Mac's Connect Phone window renders
 * a QR encoding `{v:1, url, token, host, issued}` JSON. We scan, parse,
 * validate via `parsePairingString`, and stash into `useDaemonStore`.
 * From that point `useDispatch` + `useDaemonHealth` route to that URL
 * instead of the env fallback.
 *
 * Three render states:
 *   - "requesting" — camera permission not yet decided
 *   - "denied"     — user said no; show Settings deeplink
 *   - "scanning"   — live preview with overlay; calls onScan on detection
 *   - "success"    — paired-to confirmation; auto-closes after 1.4s
 *   - "error"      — invalid payload; lets user re-aim or paste manually
 *
 * NativeWind cssInterop gotcha: every Pressable uses the
 * wrapper-View-with-static-styling pattern. See
 * `[[wend-nativewind-gotcha]]` memory.
 */
import { useEffect, useRef, useState } from "react";
import {
  AppState,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "@clerk/clerk-expo";

// expo-camera is loaded at runtime via require so a dev client that was
// built before the package was added doesn't crash on module eval. If
// the native module is missing we fall back to OTP-only and prompt the
// user to rebuild (`npx expo run:android` / `npx expo run:ios`).
type BarcodeScanningResult = { data: string };
type CameraPermission = { granted: boolean; canAskAgain: boolean };
// createPermissionHook tuple: [status, request, get] — the third
// element re-queries the OS without prompting and updates hook state.
type UseCameraPermissionsHook = () => [
  CameraPermission | null,
  () => Promise<CameraPermission>,
  () => Promise<CameraPermission>,
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let CameraView: any = null;
let useCameraPermissions: UseCameraPermissionsHook | null = null;
let cameraLoadError: string | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("expo-camera");
  CameraView = mod.CameraView;
  useCameraPermissions = mod.useCameraPermissions;
} catch (err) {
  cameraLoadError =
    err instanceof Error ? err.message : "expo-camera not available";
}
const cameraAvailable = Boolean(CameraView && useCameraPermissions);
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from "react-native-reanimated";
import {
  CheckCircleIcon,
  GearIcon,
  LaptopIcon,
  QrCodeIcon,
  WarningIcon,
  XIcon,
} from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { registerDevicePresence } from "@/lib/notifications";
import { useTheme } from "@/theme/ThemeProvider";
import {
  parsePairingString,
  useDaemonStore,
} from "@/store/daemonSlice";
import {
  defaultPhoneName,
  discoverDaemon,
  generateNonce,
  isBonjourAvailable,
  pollLanPair,
  startLanPair,
  type DiscoveredDaemon,
  type LanPairReady,
} from "@/lib/bonjour";

/** Rendezvous backend base URL — same constant the resolver hook uses.
 *  Kept inline (instead of imported) because the resolver file already
 *  reads the same env var; duplication is cheaper than introducing a
 *  shared constants module just for one string. */
const RENDEZVOUS_BASE =
  process.env.EXPO_PUBLIC_RENDEZVOUS_BASE ||
  "https://wend-landing.vercel.app";

/** POST /api/devices/:id/adopt — binds the device to the signed-in
 *  user. Returns null on success, or a user-facing error string. The
 *  device-side state on the phone (URL, token) is already persisted by
 *  the time this fires, so a failure here is recoverable — the user
 *  can retry the adopt from a Settings affordance later (which is the
 *  follow-up turn). */
async function adoptDevice(
  deviceId: string,
  deviceToken: string,
  getToken: () => Promise<string | null>,
): Promise<string | null> {
  let jwt: string | null = null;
  try {
    jwt = await getToken();
  } catch {
    return "Couldn't get your Clerk session — try signing out and back in.";
  }
  if (!jwt) {
    return "You need to be signed in to adopt this Mac.";
  }
  const url = `${RENDEZVOUS_BASE.replace(/\/$/, "")}/api/devices/${encodeURIComponent(deviceId)}/adopt`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ deviceToken }),
    });
    if (res.ok) return null;
    if (res.status === 409) {
      return "This Mac is already paired to another account.";
    }
    if (res.status === 404) {
      // Token wrong or device unknown — same status code by design.
      return "Couldn't find this Mac. The QR may have expired; ask Wend.app to regenerate it.";
    }
    if (res.status === 401) {
      return "Your sign-in session is expired. Sign out and back in.";
    }
    return `Adoption failed (HTTP ${res.status}).`;
  } catch {
    return "Network error reaching trywend.app. You can retry from Settings.";
  }
}

/** POST /api/devices/by-code — redeem the 6-digit OTP shown on the
 *  Mac. Returns { id, token, host, currentUrl } on success which the
 *  caller can plug into the daemon slice exactly like a v2 QR scan
 *  (and the row is auto-adopted server-side, so no extra adopt call).
 *  Returns { error } on failure. */
interface RedeemSuccess {
  ok: true;
  id: string;
  token: string;
  host: string;
  currentUrl: string | null;
}
interface RedeemFailure { ok: false; error: string }
async function redeemCode(
  code: string,
  getToken: () => Promise<string | null>,
): Promise<RedeemSuccess | RedeemFailure> {
  let jwt: string | null = null;
  try {
    jwt = await getToken();
  } catch {
    return { ok: false, error: "Couldn't get your Clerk session." };
  }
  if (!jwt) {
    return { ok: false, error: "You need to be signed in to pair a Mac." };
  }
  const url = `${RENDEZVOUS_BASE.replace(/\/$/, "")}/api/devices/by-code`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ code }),
    });
    if (res.status === 404) {
      return { ok: false, error: "That code isn't valid or has expired. Ask Wend.app for a new one." };
    }
    if (res.status === 409) {
      return { ok: false, error: "This Mac is already paired to another account." };
    }
    if (res.status === 401) {
      return { ok: false, error: "Your sign-in session is expired. Sign out and back in." };
    }
    if (!res.ok) {
      return { ok: false, error: `Pairing failed (HTTP ${res.status}).` };
    }
    const body = (await res.json()) as {
      id?: string;
      token?: string;
      host?: string;
      currentUrl?: string | null;
    };
    if (!body.id || !body.token || typeof body.host !== "string") {
      return { ok: false, error: "Server returned an unexpected response." };
    }
    return {
      ok: true,
      id: body.id,
      token: body.token,
      host: body.host,
      currentUrl: body.currentUrl ?? null,
    };
  } catch {
    return {
      ok: false,
      error: "Network error reaching trywend.app. You can retry from Settings.",
    };
  }
}

interface ConnectMacSheetProps {
  open: boolean;
  onClose: () => void;
}

type Mode =
  | "discovering"   // Bonjour scan in progress on sheet mount
  | "discovered"    // Found a Mac on the same WiFi; awaiting tap-to-connect
  | "approving"     // POSTed /v1/lan-pair, polling for Mac-side approval
  | "scanning"      // QR scanner active
  | "code"          // OTP entry
  | "success"
  | "error"
  | "manual";

export function ConnectMacSheet(
  props: ConnectMacSheetProps,
): React.JSX.Element | null {
  if (!props.open) return null;
  return <ConnectMacMounted {...props} />;
}

function ConnectMacMounted({ open, onClose }: ConnectMacSheetProps) {
  const { tokens } = useTheme();
  // When the native module isn't linked into this dev client build, the
  // hook is null and we skip the permission flow entirely — the user
  // sees a "rebuild" notice and the OTP path remains usable.
  const cameraHook =
    useCameraPermissions ??
    (() => {
      const denied = async () => ({ granted: false, canAskAgain: false });
      return [null, denied, denied] as const;
    });
  const [permission, requestPermission, getPermission] = cameraHook();
  // Boot into Bonjour discovery when the native module is linked. If
  // not, skip straight to the QR scanner (or OTP if no camera either).
  // Falls through to QR after a short timeout if nothing surfaces — the
  // local-network path is a nicety, not the canonical flow.
  const bonjourAvailable = isBonjourAvailable();
  const [mode, setMode] = useState<Mode>(
    bonjourAvailable
      ? "discovering"
      : cameraAvailable
        ? "scanning"
        : "code",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** Which flow produced the current error. A LAN-pair failure offers
   *  "Try again" (re-attempt against the same discovered daemon, no
   *  re-scan) + "Scan QR instead"; QR/code/manual failures keep the
   *  classic "Scan again" + "Paste the JSON instead" pair. */
  const [errorSource, setErrorSource] = useState<"lan" | "generic">("generic");
  const [pairedHost, setPairedHost] = useState<string | null>(null);
  const [manualText, setManualText] = useState<string>("");
  /** The Mac surfaced by Bonjour. Carried into the "discovered" and
   *  "approving" views so we can re-poll on retry without re-scanning. */
  const [discovered, setDiscovered] = useState<DiscoveredDaemon | null>(null);
  /** Set true when Bonjour discovery completed without finding a Mac. Drives
   *  the small "not found on this WiFi" hint above the QR scanner so the
   *  user knows why they fell through. */
  const [bonjourFellBack, setBonjourFellBack] = useState(false);
  /** Lock so a sequence of QR detections in the same camera frame doesn't
   *  fire the handler twice and double-write the store. Released on
   *  error or re-mount. */
  const lockRef = useRef(false);
  /** Clerk session — used to mint a JWT for the adopt call below. The
   *  device row gets bound to the signed-in user the moment the phone
   *  finishes parsing the QR. */
  const { getToken, isSignedIn, userId } = useAuth();

  /** Fire-and-forget presence ping so the phone shows up on the Mac the
   *  moment pairing completes — don't wait for the next push-registration
   *  pass. Never blocks the UI; swallows its own failures. */
  function pingPresence() {
    if (!userId) return;
    void registerDevicePresence({ userId, getToken: () => getToken() });
  }

  // Request permission only once the user is actually IN the scanning
  // mode (chose it, or Bonjour fell through to it). Requesting on mount
  // shoved the system camera dialog into the middle of the LAN-pair
  // flow, which never needs the camera. Don't auto-request again if the
  // user explicitly denied — they can tap "Open Settings" in the denied
  // state to grant it via the system app.
  useEffect(() => {
    if (mode !== "scanning") return;
    if (!permission) return;
    if (!permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [mode, permission, requestPermission]);

  // Re-query the permission when the app returns from background — the
  // user may have granted camera access via "Open Settings". Without
  // this the denied view sticks until the sheet is closed and reopened.
  // The render gate below `mode` falls through to the scanner on its
  // own once `permission.granted` flips (mode is already "scanning"
  // whenever the denied view can be visible).
  useEffect(() => {
    if (!cameraAvailable) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void getPermission();
    });
    return () => sub.remove();
  }, [getPermission]);

  // Reset to the initial mode whenever the sheet re-opens. The initial
  // mode is `discovering` when Bonjour is linked (typical iOS dev
  // client) so we get the zero-config path; falls back to QR otherwise.
  useEffect(() => {
    if (open) {
      setMode(
        bonjourAvailable
          ? "discovering"
          : cameraAvailable
            ? "scanning"
            : "code",
      );
      setErrorMsg(null);
      setErrorSource("generic");
      setPairedHost(null);
      setManualText("");
      setDiscovered(null);
      setBonjourFellBack(false);
      lockRef.current = false;
    }
  }, [open, bonjourAvailable]);

  // Bonjour scan — runs on every transition into "discovering". The
  // hook in bonjour.ts owns the timeout and listener cleanup. If a
  // Mac surfaces, we shift to "discovered" (one-tap connect). If not,
  // we silently fall through to the QR scanner — the user can still
  // pair with the canonical flow.
  useEffect(() => {
    if (mode !== "discovering") return;
    let cancelled = false;
    void (async () => {
      const found = await discoverDaemon();
      if (cancelled) return;
      if (found) {
        setDiscovered(found);
        setMode("discovered");
      } else {
        // Fall through to QR but surface a small breadcrumb — the user
        // expected Bonjour to surface the Mac on the same WiFi.
        setBonjourFellBack(true);
        setMode(cameraAvailable ? "scanning" : "code");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, cameraAvailable]);

  function handleScan(result: BarcodeScanningResult) {
    if (lockRef.current) return;
    lockRef.current = true;
    finalize(result.data);
  }

  async function finalize(raw: string) {
    const parsed = parsePairingString(raw);
    if (!parsed.ok) {
      setErrorMsg(parsed.error);
      setErrorSource("generic");
      setMode("error");
      // Keep the lock — explicit "Scan again" releases it.
      return;
    }
    // Persist locally first so future dispatches work even if adopt
    // fails (network blip, backend cold start, etc.). The Mac can still
    // be talked to directly via the embedded URL / hint.
    useDaemonStore.getState().setPaired(parsed.payload);
    setPairedHost(parsed.payload.host);

    // Bind the device to the signed-in user. v2 payloads carry a
    // deviceId we can address; v1 payloads predate the rendezvous and
    // can't be adopted — those still work for direct dispatch but
    // won't appear in "your Macs". When the user upgrades the Mac app,
    // they re-scan a v2 QR and adoption takes over.
    if (parsed.payload.v === 2 && parsed.payload.deviceId && isSignedIn) {
      const adoptError = await adoptDevice(
        parsed.payload.deviceId,
        parsed.payload.token,
        getToken,
      );
      if (adoptError) {
        // Pairing locally succeeded, but ownership-binding didn't.
        // Surface as an error AFTER persisting so the user can still
        // dispatch — they'll see "couldn't bind to your account; you
        // can retry from Settings" and the Mac shows up in dispatch
        // but not in the device list.
        setErrorMsg(adoptError);
        setErrorSource("generic");
        setMode("error");
        return;
      }
    }

    pingPresence();
    setMode("success");
    // Auto-close so the user lands back on Settings with the "Connected
    // to <host>" subtitle.
    setTimeout(onClose, 1400);
  }

  function tryAgain() {
    setErrorMsg(null);
    setMode(cameraAvailable ? "scanning" : "code");
    lockRef.current = false;
  }

  /** From a LAN-pair error: abandon the LAN path and switch to the
   *  canonical QR flow. Clears the stale error so it can't leak into
   *  the scanning view. */
  function scanInstead() {
    setErrorMsg(null);
    setErrorSource("generic");
    lockRef.current = false;
    setMode(cameraAvailable ? "scanning" : "code");
  }

  function trySubmitManual() {
    finalize(manualText.trim());
  }

  /** Bonjour → Mac approval handshake. Fired from the "discovered"
   *  view's "Connect" button. POSTs /v1/lan-pair, then polls the same
   *  endpoint until the user approves on the Mac. On approval, we hand
   *  the resulting URL + token to the daemon slice exactly as a QR scan
   *  would have, plus the adopt-device round-trip when a deviceId is
   *  present. */
  async function approveLanPair(daemon: DiscoveredDaemon) {
    setMode("approving");
    setErrorMsg(null);

    const startRes = await startLanPair(daemon, {
      nonce: generateNonce(),
      phoneName: defaultPhoneName(),
    });
    if (startRes.status === "error") {
      setErrorMsg(startRes.reason);
      setErrorSource("lan");
      setMode("error");
      return;
    }

    const poll = await pollLanPair(daemon, startRes.id);
    if (poll.status !== "ready") {
      // Narrow the union for TS: "ready" is excluded above; "pending"
      // shouldn't escape pollLanPair (it polls internally), but guard
      // anyway so the message defaults to something useful.
      const reason =
        poll.status === "rejected"
          ? "Mac rejected the pairing request."
          : poll.status === "error"
            ? poll.reason
            : "Mac is still waiting — try again.";
      setErrorMsg(reason);
      setErrorSource("lan");
      setMode("error");
      return;
    }

    // Reuse the same code path as a QR pairing so daemon + rendezvous
    // adoption stay identical between the two routes. v2 if deviceId
    // was sent; v1 fallback otherwise.
    const ready = poll as LanPairReady;
    const payload =
      ready.deviceId !== undefined
        ? {
            v: 2 as const,
            deviceId: ready.deviceId,
            token: ready.token,
            host: ready.host,
            url: ready.url,
            issued: Date.now(),
          }
        : {
            v: 1 as const,
            url: ready.url,
            token: ready.token,
            host: ready.host,
            issued: Date.now(),
          };
    useDaemonStore.getState().setPaired(payload);
    setPairedHost(ready.host);

    if (payload.v === 2 && isSignedIn) {
      const adoptError = await adoptDevice(
        payload.deviceId,
        payload.token,
        getToken,
      );
      if (adoptError) {
        setErrorMsg(adoptError);
        setErrorSource("lan");
        setMode("error");
        return;
      }
    }

    pingPresence();
    setMode("success");
    setTimeout(onClose, 1400);
  }

  const ink = tokens["text-primary"];
  const subtle = tokens["text-secondary"];
  const tertiary = tokens["text-tertiary"];
  const border = tokens["border-hairline"];
  const accent = tokens["accent-default"];
  const accentOn = tokens["accent-on"];
  const surface = tokens["surface-canvas"];

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 90,
      }}
      pointerEvents="box-none"
    >
      {/* Backdrop */}
      <Animated.View
        entering={FadeIn.duration(220)}
        exiting={FadeOut.duration(180)}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.45)",
        }}
      >
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close scanner"
          style={{ flex: 1 }}
        />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        entering={SlideInDown.duration(260)}
        exiting={SlideOutDown.duration(200)}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "88%",
          backgroundColor: surface,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          overflow: "hidden",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.18,
          shadowRadius: 16,
          elevation: 16,
        }}
      >
        {/* Drag handle (visual only) */}
        <View style={{ alignItems: "center", paddingTop: 10 }}>
          <View
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: tertiary,
              opacity: 0.5,
            }}
          />
        </View>

        {/* Header */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 20,
            paddingTop: 14,
            paddingBottom: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: "Inter-SemiBold",
                fontSize: 18,
                color: ink,
                letterSpacing: -0.18,
              }}
            >
              Connect your Mac
            </Text>
            <Text
              style={{
                marginTop: 2,
                fontFamily: "Inter-Regular",
                fontSize: 12,
                color: subtle,
              }}
            >
              {bonjourFellBack
                ? "No Mac found on this WiFi. Scan the QR from Wend.app."
                : "Scan the QR code from Wend.app on your Mac."}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <XIcon size={20} color={subtle} weight="bold" />
            </View>
          </Pressable>
        </View>

        {/* Body switches on mode */}
        <View style={{ flex: 1, paddingHorizontal: 20, paddingBottom: 24 }}>
          {mode === "discovering" ? (
            <DiscoveringView
              onSkip={() => setMode(cameraAvailable ? "scanning" : "code")}
              ink={ink}
              subtle={subtle}
              accent={accent}
            />
          ) : mode === "discovered" && discovered !== null ? (
            <DiscoveredView
              daemon={discovered}
              onConnect={() => void approveLanPair(discovered)}
              onSkip={() => setMode(cameraAvailable ? "scanning" : "code")}
              ink={ink}
              subtle={subtle}
              border={border}
              accent={accent}
              accentOn={accentOn}
            />
          ) : mode === "approving" ? (
            <ApprovingView
              host={discovered?.txt.host ?? discovered?.name ?? "your Mac"}
              ink={ink}
              subtle={subtle}
              accent={accent}
            />
          ) : mode === "success" ? (
            <SuccessView host={pairedHost ?? "your Mac"} accent={accent} ink={ink} subtle={subtle} />
          ) : mode === "error" ? (
            // Error renders BEFORE any camera/permission gate — a failed
            // LAN pair must show its own error, never bounce through the
            // permission or scanner views with a stale message.
            <ErrorView
              message={errorMsg ?? "Couldn't read that code."}
              retryLabel={errorSource === "lan" ? "Try again" : "Scan again"}
              onRetry={
                errorSource === "lan" && discovered !== null
                  ? () => void approveLanPair(discovered)
                  : tryAgain
              }
              secondaryLabel={
                errorSource === "lan" ? "Scan QR instead" : "Paste the JSON instead"
              }
              onSecondary={
                errorSource === "lan"
                  ? scanInstead
                  : () => {
                      setManualText("");
                      setMode("manual");
                    }
              }
              ink={ink}
              subtle={subtle}
              border={border}
              accent={accent}
              accentOn={accentOn}
              failed={tokens["status-failed"]}
            />
          ) : !cameraAvailable && mode === "scanning" ? (
            <CameraUnavailableView
              detail={cameraLoadError ?? "Camera module not linked."}
              onUseCode={() => setMode("code")}
              onUseManual={() => setMode("manual")}
              ink={ink}
              subtle={subtle}
              border={border}
              accent={accent}
              accentOn={accentOn}
            />
          ) : mode === "scanning" && !permission ? (
            <Centered>
              <Text style={{ color: subtle, fontFamily: "Inter-Regular", fontSize: 14 }}>
                Checking camera permission…
              </Text>
            </Centered>
          ) : mode === "scanning" && !permission?.granted ? (
            <DeniedView
              canAskAgain={permission?.canAskAgain ?? false}
              onAsk={() => void requestPermission()}
              onOpenSettings={() => void Linking.openSettings()}
              ink={ink}
              subtle={subtle}
              border={border}
              accent={accent}
              accentOn={accentOn}
            />
          ) : mode === "scanning" ? (
            <ScanView
              onScan={handleScan}
              onOpenManual={() => setMode("manual")}
              onOpenCode={() => {
                setManualText("");
                setMode("code");
              }}
              ink={ink}
              subtle={subtle}
              border={border}
              accent={accent}
            />
          ) : mode === "code" ? (
            <CodeView
              onSubmit={async (digits) => {
                const out = await redeemCode(digits, getToken);
                if (!out.ok) {
                  setErrorMsg(out.error);
                  setErrorSource("generic");
                  setMode("error");
                  return;
                }
                useDaemonStore.getState().setPaired({
                  v: 2,
                  deviceId: out.id,
                  token: out.token,
                  host: out.host,
                  url: out.currentUrl ?? undefined,
                  issued: Date.now(),
                });
                setPairedHost(out.host);
                pingPresence();
                setMode("success");
                setTimeout(onClose, 1400);
              }}
              onCancel={() => (cameraAvailable ? setMode("scanning") : onClose())}
              ink={ink}
              subtle={subtle}
              border={border}
              accent={accent}
              accentOn={accentOn}
            />
          ) : (
            <ManualView
              value={manualText}
              onChange={setManualText}
              onSubmit={trySubmitManual}
              onCancel={() => setMode(cameraAvailable ? "scanning" : "code")}
              error={errorMsg}
              ink={ink}
              subtle={subtle}
              border={border}
              accent={accent}
              accentOn={accentOn}
            />
          )}
        </View>
      </Animated.View>
    </View>
  );
}

/* ─── Sub-views ─────────────────────────────────────────────────────── */

function ScanView(props: {
  onScan: (r: BarcodeScanningResult) => void;
  onOpenManual: () => void;
  onOpenCode: () => void;
  ink: string;
  subtle: string;
  border: string;
  accent: string;
}) {
  const { onScan, onOpenManual, onOpenCode, ink, subtle, border, accent } = props;
  return (
    <>
      <View
        style={{
          flex: 1,
          borderRadius: 18,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: border,
          backgroundColor: "#000",
        }}
      >
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={onScan}
        />
        {/* Cut-out overlay */}
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View
            style={{
              width: 220,
              height: 220,
              borderRadius: 16,
              borderWidth: 2,
              borderColor: "rgba(255,255,255,0.85)",
            }}
          />
          <Text
            style={{
              marginTop: 16,
              color: "#FFFFFF",
              fontFamily: "Inter-Medium",
              fontSize: 13,
              textShadowColor: "rgba(0,0,0,0.4)",
              textShadowOffset: { width: 0, height: 1 },
              textShadowRadius: 2,
            }}
          >
            Point your camera at the code
          </Text>
        </View>
      </View>

      {/* Fallback affordances — both alts to the QR. "Type code" is
          the preferred alt (one tap → small input); "paste JSON" is
          the power-user escape hatch. */}
      <View style={{ marginTop: 14, flexDirection: "row", gap: 10 }}>
        <Pressable
          onPress={onOpenCode}
          accessibilityRole="button"
          accessibilityLabel="Type pairing code instead"
          style={{ flex: 1 }}
        >
          <View
            style={{
              height: 44,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 14,
              borderRadius: 12,
              backgroundColor: accent,
            }}
          >
            <Text
              style={{
                fontFamily: "Inter-SemiBold",
                fontSize: 13,
                color: "#FFFFFF",
              }}
            >
              Type code instead
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={onOpenManual}
          accessibilityRole="button"
          accessibilityLabel="Paste pairing JSON manually"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <View
            style={{
              height: 44,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 14,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: border,
            }}
          >
            <QrCodeIcon size={14} color={subtle} weight="regular" />
            <Text
              style={{
                marginLeft: 6,
                fontFamily: "Inter-Medium",
                fontSize: 12,
                color: ink,
              }}
            >
              JSON
            </Text>
          </View>
        </Pressable>
      </View>
    </>
  );
}

/* ─── Camera-unavailable fallback ───────────────────────────────────── */

function CameraUnavailableView(props: {
  detail: string;
  onUseCode: () => void;
  onUseManual: () => void;
  ink: string;
  subtle: string;
  border: string;
  accent: string;
  accentOn: string;
}) {
  return (
    <Centered>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${props.subtle}14`,
          marginBottom: 16,
        }}
      >
        <QrCodeIcon size={28} color={props.subtle} weight="regular" />
      </View>
      <Text
        style={{
          fontFamily: "Inter-SemiBold",
          fontSize: 17,
          color: props.ink,
          textAlign: "center",
          marginBottom: 6,
        }}
      >
        Camera not available in this build
      </Text>
      <Text
        style={{
          fontFamily: "Inter-Regular",
          fontSize: 13,
          color: props.subtle,
          textAlign: "center",
          marginBottom: 18,
          paddingHorizontal: 20,
          lineHeight: 18,
        }}
      >
        Rebuild the dev client with `npx expo run:android` (or `run:ios`)
        to enable the QR scanner. You can still pair by typing the
        6-digit code shown on your Mac.
      </Text>
      <PillButton
        label="Type code instead"
        onPress={props.onUseCode}
        bg={props.accent}
        fg={props.accentOn}
      />
      <Pressable
        onPress={props.onUseManual}
        accessibilityRole="button"
        style={{ marginTop: 12 }}
      >
        <Text
          style={{
            fontFamily: "Inter-Medium",
            fontSize: 13,
            color: props.subtle,
            textDecorationLine: "underline",
          }}
        >
          Paste pairing JSON instead
        </Text>
      </Pressable>
    </Centered>
  );
}

/* ─── OTP entry view ────────────────────────────────────────────────── */

function CodeView(props: {
  onSubmit: (digits: string) => void;
  onCancel: () => void;
  ink: string;
  subtle: string;
  border: string;
  accent: string;
  accentOn: string;
}) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    // Auto-focus after the sheet's slide animation finishes.
    const t = setTimeout(() => inputRef.current?.focus(), 260);
    return () => clearTimeout(t);
  }, []);

  const digits = code.replace(/\D/g, "").slice(0, 6);
  const ready = digits.length === 6;

  async function go() {
    if (!ready || submitting) return;
    setSubmitting(true);
    await props.onSubmit(digits);
    setSubmitting(false);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: "center",
          justifyContent: "flex-start",
          paddingTop: 32,
          paddingBottom: 24,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
      <Text
        style={{
          fontFamily: "Inter-SemiBold",
          fontSize: 18,
          color: props.ink,
          marginBottom: 6,
        }}
      >
        Type the 6-digit code
      </Text>
      <Text
        style={{
          fontFamily: "Inter-Regular",
          fontSize: 13,
          color: props.subtle,
          textAlign: "center",
          marginBottom: 24,
          paddingHorizontal: 20,
          lineHeight: 18,
        }}
      >
        Open Wend.app on your Mac and look under the QR code.
      </Text>
      <TextInput
        ref={inputRef}
        value={formatOTP(digits)}
        onChangeText={(t) => setCode(t)}
        keyboardType="number-pad"
        returnKeyType="go"
        onSubmitEditing={go}
        maxLength={7 /* 6 digits + 1 space */}
        editable={!submitting}
        style={{
          width: 220,
          height: 60,
          borderWidth: 1,
          borderColor: ready ? props.accent : props.border,
          borderRadius: 14,
          textAlign: "center",
          fontSize: 26,
          letterSpacing: 6,
          color: props.ink,
          fontFamily: "JetBrainsMono-Medium",
        }}
      />
      <View style={{ marginTop: 22, flexDirection: "row", gap: 10 }}>
        <Pressable
          onPress={props.onCancel}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Back to scanner"
          style={({ pressed }) => ({
            opacity: submitting ? 0.4 : pressed ? 0.6 : 1,
          })}
        >
          <View
            style={{
              height: 44,
              paddingHorizontal: 18,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: props.border,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontFamily: "Inter-SemiBold",
                fontSize: 14,
                color: props.ink,
              }}
            >
              Cancel
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={go}
          disabled={!ready || submitting}
          accessibilityRole="button"
          accessibilityLabel="Pair"
          style={({ pressed }) => ({
            opacity: !ready ? 0.4 : submitting ? 0.6 : pressed ? 0.85 : 1,
          })}
        >
          <View
            style={{
              height: 44,
              paddingHorizontal: 28,
              borderRadius: 22,
              backgroundColor: props.accent,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontFamily: "Inter-SemiBold",
                fontSize: 14,
                color: props.accentOn,
              }}
            >
              {submitting ? "Pairing…" : "Pair"}
            </Text>
          </View>
        </Pressable>
      </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Format "123456" → "123 456" with a thin space for visual rhythm. */
function formatOTP(digits: string): string {
  if (digits.length <= 3) return digits;
  return digits.slice(0, 3) + " " + digits.slice(3);
}

function DeniedView(props: {
  canAskAgain: boolean;
  onAsk: () => void;
  onOpenSettings: () => void;
  ink: string;
  subtle: string;
  border: string;
  accent: string;
  accentOn: string;
}) {
  return (
    <Centered>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${props.subtle}14`,
          marginBottom: 16,
        }}
      >
        <GearIcon size={28} color={props.subtle} weight="regular" />
      </View>
      <Text
        style={{
          fontFamily: "Inter-SemiBold",
          fontSize: 18,
          color: props.ink,
          textAlign: "center",
          marginBottom: 6,
        }}
      >
        Camera access needed
      </Text>
      <Text
        style={{
          fontFamily: "Inter-Regular",
          fontSize: 13,
          color: props.subtle,
          textAlign: "center",
          marginBottom: 20,
          paddingHorizontal: 16,
          lineHeight: 18,
        }}
      >
        Wend uses the camera to scan the pairing QR code from your Mac.
        No images are recorded or sent anywhere.
      </Text>
      <PillButton
        label={props.canAskAgain ? "Allow camera" : "Open Settings"}
        onPress={props.canAskAgain ? props.onAsk : props.onOpenSettings}
        bg={props.accent}
        fg={props.accentOn}
      />
    </Centered>
  );
}

function SuccessView({
  host,
  accent,
  ink,
  subtle,
}: {
  host: string;
  accent: string;
  ink: string;
  subtle: string;
}) {
  return (
    <Centered>
      <Animated.View
        entering={FadeIn.duration(220)}
        style={{
          width: 76,
          height: 76,
          borderRadius: 38,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${accent}22`,
          marginBottom: 18,
        }}
      >
        <CheckCircleIcon size={42} color={accent} weight="fill" />
      </Animated.View>
      <Text
        style={{
          fontFamily: "Inter-SemiBold",
          fontSize: 18,
          color: ink,
          textAlign: "center",
        }}
      >
        Paired with {host}
      </Text>
      <Text
        style={{
          marginTop: 6,
          fontFamily: "Inter-Regular",
          fontSize: 13,
          color: subtle,
          textAlign: "center",
        }}
      >
        You can now send notes to this Mac.
      </Text>
    </Centered>
  );
}

function ErrorView(props: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
  secondaryLabel: string;
  onSecondary: () => void;
  ink: string;
  subtle: string;
  border: string;
  accent: string;
  accentOn: string;
  failed: string;
}) {
  return (
    <Centered>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${props.failed}1F`,
          marginBottom: 14,
        }}
      >
        <WarningIcon size={28} color={props.failed} weight="fill" />
      </View>
      <Text
        style={{
          fontFamily: "Inter-SemiBold",
          fontSize: 17,
          color: props.ink,
          textAlign: "center",
          marginBottom: 6,
        }}
      >
        Couldn't pair
      </Text>
      <Text
        style={{
          fontFamily: "Inter-Regular",
          fontSize: 13,
          color: props.subtle,
          textAlign: "center",
          marginBottom: 18,
          paddingHorizontal: 20,
          lineHeight: 18,
        }}
      >
        {props.message}
      </Text>
      <PillButton
        label={props.retryLabel}
        onPress={props.onRetry}
        bg={props.accent}
        fg={props.accentOn}
      />
      <Pressable
        onPress={props.onSecondary}
        accessibilityRole="button"
        style={{ marginTop: 12 }}
      >
        <Text
          style={{
            fontFamily: "Inter-Medium",
            fontSize: 13,
            color: props.subtle,
            textDecorationLine: "underline",
          }}
        >
          {props.secondaryLabel}
        </Text>
      </Pressable>
    </Centered>
  );
}

function ManualView(props: {
  value: string;
  onChange: (s: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  error: string | null;
  ink: string;
  subtle: string;
  border: string;
  accent: string;
  accentOn: string;
}) {
  return (
    <>
      <Text
        style={{
          fontFamily: "Inter-Medium",
          fontSize: 11,
          color: props.subtle,
          letterSpacing: 1.4,
          textTransform: "uppercase",
          marginBottom: 8,
          marginTop: 8,
        }}
      >
        PAIRING JSON
      </Text>
      <View
        style={{
          flex: 1,
          borderWidth: 1,
          borderColor: props.border,
          borderRadius: 12,
          padding: 12,
        }}
      >
        <TextInput
          value={props.value}
          onChangeText={props.onChange}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder='{"v":1,"url":"https://…","token":"…","host":"…","issued":…}'
          placeholderTextColor={props.subtle}
          style={{
            flex: 1,
            color: props.ink,
            fontFamily: "JetBrainsMono-Medium",
            fontSize: 12,
            lineHeight: 18,
            padding: 0,
            textAlignVertical: "top",
          }}
        />
      </View>
      {props.error ? (
        <Text
          style={{
            marginTop: 10,
            color: "#BA1A1A",
            fontFamily: "Inter-Medium",
            fontSize: 12,
          }}
        >
          {props.error}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
        <Pressable
          onPress={props.onCancel}
          accessibilityRole="button"
          accessibilityLabel="Back to scanning"
          style={{ flex: 1 }}
        >
          <View
            style={{
              height: 48,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: props.border,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontFamily: "Inter-SemiBold",
                fontSize: 14,
                color: props.ink,
              }}
            >
              Back to scanning
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={props.onSubmit}
          accessibilityRole="button"
          accessibilityLabel="Pair"
          disabled={props.value.trim().length === 0}
          style={{ flex: 1 }}
        >
          <View
            style={{
              height: 48,
              borderRadius: 12,
              backgroundColor: props.accent,
              alignItems: "center",
              justifyContent: "center",
              opacity: props.value.trim().length === 0 ? 0.4 : 1,
            }}
          >
            <Text
              style={{
                fontFamily: "Inter-SemiBold",
                fontSize: 14,
                color: props.accentOn,
              }}
            >
              Pair
            </Text>
          </View>
        </Pressable>
      </View>
    </>
  );
}

/* ─── Tiny helpers ──────────────────────────────────────────────────── */

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </View>
  );
}

function PillButton({
  label,
  onPress,
  bg,
  fg,
}: {
  label: string;
  onPress: () => void;
  bg: string;
  fg: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <View
        style={{
          height: 48,
          paddingHorizontal: 28,
          borderRadius: 24,
          backgroundColor: bg,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
        }}
      >
        <LaptopIcon size={16} color={fg} weight="bold" />
        <Text
          style={{
            marginLeft: 8,
            fontFamily: "Inter-SemiBold",
            fontSize: 14,
            color: fg,
          }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

/* ─── Bonjour discovery views ───────────────────────────────────────── */

/** Shown for the first ~3.5s while we scan `_wend._tcp.local`. Falls
 *  through silently to the QR scanner if nothing surfaces — the user
 *  never sees an explicit "no Mac found" error; that would feel like
 *  the canonical (QR) flow is the fallback when it's actually the
 *  reverse. */
function DiscoveringView(props: {
  onSkip: () => void;
  ink: string;
  subtle: string;
  accent: string;
}) {
  return (
    <Centered>
      <View
        style={{
          width: 76,
          height: 76,
          borderRadius: 38,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${props.accent}1F`,
          marginBottom: 18,
        }}
      >
        <LaptopIcon size={36} color={props.accent} weight="regular" />
      </View>
      <Text
        style={{
          fontFamily: "Inter-SemiBold",
          fontSize: 18,
          color: props.ink,
          textAlign: "center",
          marginBottom: 6,
        }}
      >
        Looking for your Mac…
      </Text>
      <Text
        style={{
          fontFamily: "Inter-Regular",
          fontSize: 13,
          color: props.subtle,
          textAlign: "center",
          marginBottom: 22,
          paddingHorizontal: 24,
          lineHeight: 18,
        }}
      >
        Same WiFi as your Mac? Wend will find it without a QR code.
      </Text>
      <Pressable
        onPress={props.onSkip}
        accessibilityRole="button"
        accessibilityLabel="Use the QR code instead"
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Text
          style={{
            fontFamily: "Inter-Medium",
            fontSize: 13,
            color: props.subtle,
            textDecorationLine: "underline",
          }}
        >
          Use the QR code instead
        </Text>
      </Pressable>
    </Centered>
  );
}

/** A Mac was found on the same WiFi. Show its hostname + a single
 *  "Connect" button. The connect path POSTs `/v1/lan-pair` and waits
 *  for the Mac-side approval (NSAlert / menu-bar popover). */
function DiscoveredView(props: {
  daemon: DiscoveredDaemon;
  onConnect: () => void;
  onSkip: () => void;
  ink: string;
  subtle: string;
  border: string;
  accent: string;
  accentOn: string;
}) {
  // Prefer the TXT-record `host` (scutil ComputerName) over the
  // mDNS `name` — the latter often has trailing `(2)` collision
  // suffixes that look ugly to a human.
  const friendly =
    props.daemon.txt.host && props.daemon.txt.host.length > 0
      ? props.daemon.txt.host
      : props.daemon.name;
  return (
    <Centered>
      <View
        style={{
          width: 76,
          height: 76,
          borderRadius: 38,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${props.accent}22`,
          marginBottom: 18,
        }}
      >
        <LaptopIcon size={36} color={props.accent} weight="fill" />
      </View>
      <Text
        style={{
          fontFamily: "Inter-SemiBold",
          fontSize: 18,
          color: props.ink,
          textAlign: "center",
          marginBottom: 6,
        }}
      >
        Found {friendly}
      </Text>
      <Text
        style={{
          fontFamily: "Inter-Regular",
          fontSize: 13,
          color: props.subtle,
          textAlign: "center",
          marginBottom: 22,
          paddingHorizontal: 24,
          lineHeight: 18,
        }}
      >
        Tap Connect, then approve the request on your Mac.
      </Text>
      <PillButton
        label="Connect"
        onPress={props.onConnect}
        bg={props.accent}
        fg={props.accentOn}
      />
      <Pressable
        onPress={props.onSkip}
        accessibilityRole="button"
        accessibilityLabel="Use the QR code instead"
        style={{ marginTop: 14 }}
      >
        <Text
          style={{
            fontFamily: "Inter-Medium",
            fontSize: 13,
            color: props.subtle,
            textDecorationLine: "underline",
          }}
        >
          Use the QR code instead
        </Text>
      </Pressable>
    </Centered>
  );
}

/** Polling state — request is in flight on the Mac side. The user is
 *  expected to glance at their Mac and click Approve. We don't expose
 *  a manual cancel here yet; the QR pill below the message lets them
 *  abandon the LAN path if the Mac alert never shows. */
function ApprovingView(props: {
  host: string;
  ink: string;
  subtle: string;
  accent: string;
}) {
  return (
    <Centered>
      <View
        style={{
          width: 76,
          height: 76,
          borderRadius: 38,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${props.accent}22`,
          marginBottom: 18,
        }}
      >
        <LaptopIcon size={36} color={props.accent} weight="regular" />
      </View>
      <Text
        style={{
          fontFamily: "Inter-SemiBold",
          fontSize: 18,
          color: props.ink,
          textAlign: "center",
          marginBottom: 6,
        }}
      >
        Waiting for {props.host}
      </Text>
      <Text
        style={{
          fontFamily: "Inter-Regular",
          fontSize: 13,
          color: props.subtle,
          textAlign: "center",
          marginBottom: 4,
          paddingHorizontal: 24,
          lineHeight: 18,
        }}
      >
        Approve the pairing request on your Mac to finish.
      </Text>
    </Centered>
  );
}
