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
  Linking,
  Pressable,
  TextInput,
  View,
} from "react-native";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";
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
import { useTheme } from "@/theme/ThemeProvider";
import {
  parsePairingString,
  useDaemonStore,
} from "@/store/daemonSlice";

interface ConnectMacSheetProps {
  open: boolean;
  onClose: () => void;
}

type Mode = "scanning" | "success" | "error" | "manual";

export function ConnectMacSheet(
  props: ConnectMacSheetProps,
): React.JSX.Element | null {
  if (!props.open) return null;
  return <ConnectMacMounted {...props} />;
}

function ConnectMacMounted({ open, onClose }: ConnectMacSheetProps) {
  const { tokens } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>("scanning");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pairedHost, setPairedHost] = useState<string | null>(null);
  const [manualText, setManualText] = useState<string>("");
  /** Lock so a sequence of QR detections in the same camera frame doesn't
   *  fire the handler twice and double-write the store. Released on
   *  error or re-mount. */
  const lockRef = useRef(false);

  // Request permission on mount if undecided. Don't auto-request again
  // if the user explicitly denied — they can tap "Open Settings" in the
  // denied state to grant it via the system app.
  useEffect(() => {
    if (!permission) return;
    if (!permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  // Reset to scanning whenever the sheet re-opens.
  useEffect(() => {
    if (open) {
      setMode("scanning");
      setErrorMsg(null);
      setPairedHost(null);
      setManualText("");
      lockRef.current = false;
    }
  }, [open]);

  function handleScan(result: BarcodeScanningResult) {
    if (lockRef.current) return;
    lockRef.current = true;
    finalize(result.data);
  }

  function finalize(raw: string) {
    const parsed = parsePairingString(raw);
    if (!parsed.ok) {
      setErrorMsg(parsed.error);
      setMode("error");
      // Keep the lock — explicit "Scan again" releases it.
      return;
    }
    useDaemonStore.getState().setPaired(parsed.payload);
    setPairedHost(parsed.payload.host);
    setMode("success");
    // Auto-close so the user lands back on Settings with the "Connected
    // to <host>" subtitle.
    setTimeout(onClose, 1400);
  }

  function tryAgain() {
    setErrorMsg(null);
    setMode("scanning");
    lockRef.current = false;
  }

  function trySubmitManual() {
    finalize(manualText.trim());
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
              Scan the QR code from Wend.app on your Mac.
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
          {!permission ? (
            <Centered>
              <Text style={{ color: subtle, fontFamily: "Inter-Regular", fontSize: 14 }}>
                Checking camera permission…
              </Text>
            </Centered>
          ) : !permission.granted ? (
            <DeniedView
              canAskAgain={permission.canAskAgain}
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
              ink={ink}
              subtle={subtle}
              border={border}
              accent={accent}
            />
          ) : mode === "success" ? (
            <SuccessView host={pairedHost ?? "your Mac"} accent={accent} ink={ink} subtle={subtle} />
          ) : mode === "error" ? (
            <ErrorView
              message={errorMsg ?? "Couldn't read that code."}
              onRetry={tryAgain}
              onOpenManual={() => {
                setManualText("");
                setMode("manual");
              }}
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
              onCancel={() => setMode("scanning")}
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
  ink: string;
  subtle: string;
  border: string;
  accent: string;
}) {
  const { onScan, onOpenManual, ink, subtle, border, accent } = props;
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

      <Pressable
        onPress={onOpenManual}
        accessibilityRole="button"
        accessibilityLabel="Paste pairing JSON manually"
        style={({ pressed }) => ({
          marginTop: 14,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: border,
          }}
        >
          <QrCodeIcon size={16} color={subtle} weight="regular" />
          <Text
            style={{
              marginLeft: 8,
              fontFamily: "Inter-Medium",
              fontSize: 13,
              color: ink,
            }}
          >
            Paste pairing JSON instead
          </Text>
        </View>
      </Pressable>
    </>
  );
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
  onRetry: () => void;
  onOpenManual: () => void;
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
          backgroundColor: "rgba(186,26,26,0.12)",
          marginBottom: 14,
        }}
      >
        <WarningIcon size={28} color="#BA1A1A" weight="fill" />
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
        label="Scan again"
        onPress={props.onRetry}
        bg={props.accent}
        fg={props.accentOn}
      />
      <Pressable
        onPress={props.onOpenManual}
        accessibilityRole="button"
        style={({ pressed }) => ({ marginTop: 12, opacity: pressed ? 0.6 : 1 })}
      >
        <Text
          style={{
            fontFamily: "Inter-Medium",
            fontSize: 13,
            color: props.subtle,
            textDecorationLine: "underline",
          }}
        >
          Paste the JSON instead
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
          style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.7 : 1 })}
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
          style={({ pressed }) => ({
            flex: 1,
            opacity:
              props.value.trim().length === 0 ? 0.4 : pressed ? 0.85 : 1,
          })}
        >
          <View
            style={{
              height: 48,
              borderRadius: 12,
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
