/**
 * SCREEN: S27 — Sign-in (O1 onboarding hero).
 *
 * Three paths, in order of priority on screen:
 *   1. Email + verification code (Clerk's email_code factor)
 *   2. Continue with Google
 *   3. Continue with GitHub
 *
 * Layout uses an explicit flex-1 spacer (NOT justify-between) to push the auth
 * stack to the bottom — earlier attempts with justify-between + className on
 * Pressables had the pills collapsing to 0 height under NativeWind's
 * style-callback transform.
 *
 * All sizing/layout for Pressables lives in inline style (not className) so
 * NativeWind can't drop layout utilities when the style prop is a function.
 *
 * Two states:
 *   - "start"  → hero + email input + Google + GitHub
 *   - "verify" → "we sent a code" + 6-digit input + verify button + back
 */
import { useRef, useState } from "react";
import {
  View,
  Image,
  Pressable,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  GoogleLogoIcon,
  GithubLogoIcon,
  ArrowRightIcon,
} from "phosphor-react-native";

import { Text } from "@/components/primitives";
import {
  useGoogleSignIn,
  useGithubSignIn,
  useEmailSignIn,
  type EmailMode,
} from "@/auth/client";
import { isClerkConfigured } from "@/config/env";
import { useTheme } from "@/theme/ThemeProvider";

type Provider = "google" | "github" | "email" | null;
type Step = "start" | "verify";

export default function SignInScreen() {
  const { tokens } = useTheme();
  const [busyProvider, setBusyProvider] = useState<Provider>(null);
  const [step, setStep] = useState<Step>("start");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [emailMode, setEmailMode] = useState<EmailMode>("signin");
  const [error, setError] = useState<string | null>(null);
  const codeInputRef = useRef<TextInput>(null);

  const signInWithGoogle = useGoogleSignIn();
  const signInWithGithub = useGithubSignIn();
  const { sendCode, verifyCode, resendCode } = useEmailSignIn();

  const busy = busyProvider !== null;

  // Inverse-surface palette for the dark ink pill (Google/GitHub/Verify).
  const pillBg = tokens["text-primary"];
  const pillFg = tokens["surface-canvas"];
  const canvasBg = tokens["surface-canvas"];
  const inkColor = tokens["text-primary"];
  const subtleColor = tokens["text-tertiary"];
  const surfaceSubtle = tokens["surface-chip"];
  const borderColor = tokens["border-hairline"];

  async function onOAuth(provider: "google" | "github") {
    if (!isClerkConfigured) {
      setError("Auth provider not configured yet.");
      return;
    }
    setBusyProvider(provider);
    setError(null);
    try {
      if (provider === "google") await signInWithGoogle();
      else await signInWithGithub();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[wend/auth] ${provider} sign-in failed`, err);
      setError(provider + " sign-in failed. Try again?");
    } finally {
      setBusyProvider(null);
    }
  }

  async function onSendCode() {
    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setError("That doesn't look like a valid email.");
      return;
    }
    if (!isClerkConfigured) {
      setError("Auth provider not configured yet.");
      return;
    }
    setBusyProvider("email");
    setError(null);
    try {
      const mode = await sendCode(trimmed);
      setEmailMode(mode);
      setStep("verify");
      // Tiny delay so the next render mounts the input first.
      setTimeout(() => codeInputRef.current?.focus(), 50);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[wend/auth] email send failed", err);
      setError("Couldn't send code. Check the email and try again.");
    } finally {
      setBusyProvider(null);
    }
  }

  async function onVerifyCode() {
    if (code.length < 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setBusyProvider("email");
    setError(null);
    try {
      await verifyCode(code.trim());
      // Session goes active; route gate redirects.
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[wend/auth] code verify failed", err);
      setError("That code didn't work. Double-check or resend.");
    } finally {
      setBusyProvider(null);
    }
  }

  async function onResend() {
    setError(null);
    try {
      await resendCode();
    } catch {
      setError("Couldn't resend. Try going back and starting over.");
    }
  }

  function onBack() {
    setStep("start");
    setCode("");
    setError(null);
  }

  return (
    <View style={{ flex: 1, backgroundColor: canvasBg }}>
      {/* Full-bleed background — abstract paper-and-shapes art behind the
          entire sign-in flow. Sits below SafeAreaView so it covers the
          status bar and gesture inset edges too. */}
      <Image
        source={require("../../../assets/images/sign-in-bg.png")}
        resizeMode="cover"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          // Nudge the framing: shift the image down + right so the upper-row
          // shapes pull into view from the top edge and the lower-row shapes
          // ride higher on the bottom. The 1.08 scale gives ~24px of bleed
          // on each axis so the translates don't expose empty paper at the
          // corners.
          transform: [
            { scale: 1.08 },
            { translateX: 22 },
            { translateY: 40 },
          ],
        }}
      />
      <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View
          style={{
            flex: 1,
            paddingHorizontal: 24,
            paddingTop: 64,
            paddingBottom: 32,
          }}
        >
          {step === "start" ? (
            <StartView
              tokens={{ pillBg, pillFg, inkColor, subtleColor, surfaceSubtle, borderColor }}
              email={email}
              setEmail={setEmail}
              onSendCode={onSendCode}
              onGoogle={() => onOAuth("google")}
              onGithub={() => onOAuth("github")}
              busy={busy}
              busyProvider={busyProvider}
              error={error}
              clerkOk={isClerkConfigured}
            />
          ) : (
            <VerifyView
              tokens={{ pillBg, pillFg, inkColor, subtleColor, surfaceSubtle, borderColor }}
              email={email}
              code={code}
              setCode={setCode}
              onVerify={onVerifyCode}
              onResend={onResend}
              onBack={onBack}
              busy={busy}
              error={error}
              emailMode={emailMode}
              codeInputRef={codeInputRef}
            />
          )}
        </View>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Start view — hero + email + Google + GitHub
// ---------------------------------------------------------------------------

interface ViewTokens {
  pillBg: string;
  pillFg: string;
  inkColor: string;
  subtleColor: string;
  surfaceSubtle: string;
  borderColor: string;
}

function StartView(props: {
  tokens: ViewTokens;
  email: string;
  setEmail: (s: string) => void;
  onSendCode: () => void;
  onGoogle: () => void;
  onGithub: () => void;
  busy: boolean;
  busyProvider: Provider;
  error: string | null;
  clerkOk: boolean;
}) {
  const { tokens, email, setEmail, onSendCode, onGoogle, onGithub, busy, busyProvider, error, clerkOk } = props;
  const accent = "#C25A3B"; // ember — could also pull from tokens.accent

  // Dark ink color used by the OAuth pills + email send button. The design
  // calls for the on-background token (#1d1b19) so the buttons feel like
  // ink-stamped objects on the paper canvas behind. Pulling the literal
  // here (not the theme token) so dark-mode doesn't accidentally invert.
  const ink = "#1d1b19";
  const inkOn = "#FFFFFF";

  return (
    <>
      {/* Spacer above so the hero sits roughly in the upper third on tall
          phones, balanced against the auth actions pinned to the bottom. */}
      <View style={{ flex: 1 }} />

      {/* Hero — small ember W mark + 2-line headline + WEND IT. caption. */}
      <Animated.View
        entering={FadeInDown.duration(700)}
        style={{ alignItems: "center" }}
      >
        <Text
          style={{
            fontFamily: "JetBrainsMono-Medium",
            fontSize: 36,
            lineHeight: 36,
            color: accent,
            marginBottom: 20,
            letterSpacing: -1,
          }}
        >
          W
        </Text>

        <Text
          style={{
            fontFamily: "Inter-SemiBold",
            fontSize: 34,
            lineHeight: 40,
            color: tokens.inkColor,
            textAlign: "center",
            letterSpacing: -0.6,
          }}
        >
          Notes you can
        </Text>
        <Text
          style={{
            fontFamily: "Inter-SemiBold",
            fontSize: 34,
            lineHeight: 40,
            color: accent,
            textAlign: "center",
            letterSpacing: -0.6,
          }}
        >
          send.
        </Text>
        <Text
          style={{
            marginTop: 14,
            color: tokens.subtleColor,
            letterSpacing: 4,
            textTransform: "uppercase",
            fontSize: 11,
            fontFamily: "Inter-Medium",
          }}
        >
          Wend it.
        </Text>
      </Animated.View>

      {/* Spacer — pushes auth stack to bottom. */}
      <View style={{ flex: 1 }} />

      {/* Auth stack — anchored to bottom. */}
      <View style={{ width: "100%", gap: 24 }}>
        {/* Email row — frosted pill with dark ink send button on the right.
            The send button is INSIDE the input row (absolute-ish placement
            via padding) per the new design mock. */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: "rgba(255,248,244,0.55)",
            borderRadius: 999,
            borderWidth: 1,
            borderColor: "rgba(0,0,0,0.06)",
            paddingLeft: 22,
            paddingRight: 8,
            height: 64,
          }}
        >
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="your email"
            placeholderTextColor={tokens.subtleColor}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="send"
            onSubmitEditing={onSendCode}
            editable={!busy}
            style={{
              flex: 1,
              fontSize: 16,
              fontFamily: "Inter-Regular",
              color: tokens.inkColor,
              paddingVertical: 0,
            }}
          />
          <Pressable
            onPress={onSendCode}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Send code to email"
            style={({ pressed }) => ({
              opacity: busy && busyProvider !== "email" ? 0.4 : pressed ? 0.85 : 1,
            })}
          >
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                backgroundColor: ink,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {busyProvider === "email" ? (
                <ActivityIndicator color={inkOn} />
              ) : (
                <ArrowRightIcon size={20} color={inkOn} weight="bold" />
              )}
            </View>
          </Pressable>
        </View>

        {/* "or" divider */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          <View style={{ flex: 1, height: 1, backgroundColor: tokens.borderColor }} />
          <Text
            style={{
              marginHorizontal: 12,
              color: tokens.subtleColor,
              fontSize: 12,
              letterSpacing: 2,
              textTransform: "uppercase",
              fontFamily: "Inter-Medium",
            }}
          >
            or
          </Text>
          <View style={{ flex: 1, height: 1, backgroundColor: tokens.borderColor }} />
        </View>

        {/* OAuth pair — dark ink pills stacked with a paired-radius "joint"
            (Google has a softer bottom edge, GitHub a softer top edge) so
            they visually belong together as one segmented control. */}
        <View style={{ gap: 12 }}>
          <Pressable
            onPress={onGoogle}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => ({
              opacity:
                busy && busyProvider !== "google"
                  ? 0.4
                  : busy
                    ? 0.7
                    : pressed
                      ? 0.85
                      : 1,
            })}
          >
            <View
              style={{
                height: 56,
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                borderBottomLeftRadius: 10,
                borderBottomRightRadius: 10,
                backgroundColor: ink,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.16,
                shadowRadius: 12,
                elevation: 4,
              }}
            >
              {busyProvider === "google" ? (
                <ActivityIndicator color={inkOn} />
              ) : (
                <GoogleLogoIcon size={20} color={inkOn} weight="bold" />
              )}
              <Text
                style={{
                  color: inkOn,
                  marginLeft: 10,
                  fontFamily: "Inter-Medium",
                  fontSize: 16,
                }}
              >
                Continue with Google
              </Text>
            </View>
          </Pressable>

          <Pressable
            onPress={onGithub}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => ({
              opacity:
                busy && busyProvider !== "github"
                  ? 0.4
                  : busy
                    ? 0.7
                    : pressed
                      ? 0.85
                      : 1,
            })}
          >
            <View
              style={{
                height: 56,
                borderTopLeftRadius: 10,
                borderTopRightRadius: 10,
                borderBottomLeftRadius: 28,
                borderBottomRightRadius: 28,
                backgroundColor: ink,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.16,
                shadowRadius: 12,
                elevation: 4,
              }}
            >
              {busyProvider === "github" ? (
                <ActivityIndicator color={inkOn} />
              ) : (
                <GithubLogoIcon size={20} color={inkOn} weight="bold" />
              )}
              <Text
                style={{
                  color: inkOn,
                  marginLeft: 10,
                  fontFamily: "Inter-Medium",
                  fontSize: 16,
                }}
              >
                Continue with GitHub
              </Text>
            </View>
          </Pressable>
        </View>

        {/* Error / config caption */}
        {error ? (
          <Text
            style={{
              marginTop: 14,
              color: accent,
              textAlign: "center",
              fontSize: 13,
              fontFamily: "Inter-Medium",
            }}
          >
            {error}
          </Text>
        ) : null}
        {!clerkOk ? (
          <Text
            style={{
              marginTop: 14,
              color: tokens.subtleColor,
              textAlign: "center",
              fontSize: 12,
              fontFamily: "Inter-Regular",
            }}
          >
            Clerk publishable key not set. Paste it into .env.local.
          </Text>
        ) : null}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Verify view — 6-digit code entry
// ---------------------------------------------------------------------------

function VerifyView(props: {
  tokens: ViewTokens;
  email: string;
  code: string;
  setCode: (s: string) => void;
  onVerify: () => void;
  onResend: () => void;
  onBack: () => void;
  busy: boolean;
  error: string | null;
  emailMode: EmailMode;
  codeInputRef: React.RefObject<TextInput | null>;
}) {
  const { tokens, email, code, setCode, onVerify, onResend, onBack, busy, error, emailMode, codeInputRef } = props;
  const accent = "#C25A3B";

  return (
    <>
      <Animated.View
        entering={FadeInDown.duration(500)}
        style={{ alignItems: "center", marginTop: 48 }}
      >
        <Text
          style={{
            fontFamily: "Inter-SemiBold",
            fontSize: 26,
            color: tokens.inkColor,
            textAlign: "center",
          }}
        >
          {emailMode === "signin" ? "Welcome back." : "Check your email."}
        </Text>
        <Text
          style={{
            marginTop: 8,
            color: tokens.subtleColor,
            textAlign: "center",
            fontSize: 14,
            fontFamily: "Inter-Regular",
            lineHeight: 20,
            paddingHorizontal: 24,
          }}
        >
          We sent a 6-digit code to{"\n"}
          <Text style={{ color: tokens.inkColor, fontFamily: "Inter-Medium" }}>
            {email}
          </Text>
        </Text>
      </Animated.View>

      <View style={{ flex: 1 }} />

      <View style={{ width: "100%" }}>
        <TextInput
          ref={codeInputRef}
          value={code}
          onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, 6))}
          placeholder="000000"
          placeholderTextColor={tokens.subtleColor}
          keyboardType="number-pad"
          autoFocus
          maxLength={6}
          editable={!busy}
          onSubmitEditing={onVerify}
          style={{
            height: 64,
            borderRadius: 16,
            backgroundColor: tokens.surfaceSubtle,
            borderWidth: 1,
            borderColor: tokens.borderColor,
            color: tokens.inkColor,
            textAlign: "center",
            fontSize: 26,
            letterSpacing: 8,
            fontFamily: "JetBrainsMono-Medium",
          }}
        />

        <Pressable
          onPress={onVerify}
          disabled={busy || code.length < 6}
          accessibilityRole="button"
          style={({ pressed }) => ({
            marginTop: 16,
            opacity: busy || code.length < 6 ? 0.5 : pressed ? 0.85 : 1,
          })}
        >
          <View
            style={{
              height: 56,
              borderRadius: 999,
              backgroundColor: tokens.pillBg,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
          {busy ? (
            <ActivityIndicator color={tokens.pillFg} />
          ) : (
            <Text
              style={{
                color: tokens.pillFg,
                fontFamily: "Inter-SemiBold",
                fontSize: 16,
              }}
            >
              Verify
            </Text>
          )}
          </View>
        </Pressable>

        <View
          style={{
            flexDirection: "row",
            justifyContent: "center",
            marginTop: 18,
          }}
        >
          <Pressable onPress={onBack} accessibilityRole="button">
            <Text
              style={{
                color: tokens.subtleColor,
                fontSize: 13,
                fontFamily: "Inter-Medium",
              }}
            >
              Wrong email?
            </Text>
          </Pressable>
          <Text style={{ marginHorizontal: 8, color: tokens.subtleColor }}>·</Text>
          <Pressable onPress={onResend} accessibilityRole="button" disabled={busy}>
            <Text
              style={{
                color: tokens.inkColor,
                fontSize: 13,
                fontFamily: "Inter-Medium",
              }}
            >
              Resend code
            </Text>
          </Pressable>
        </View>

        {error ? (
          <Text
            style={{
              marginTop: 14,
              color: accent,
              textAlign: "center",
              fontSize: 13,
              fontFamily: "Inter-Medium",
            }}
          >
            {error}
          </Text>
        ) : null}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
