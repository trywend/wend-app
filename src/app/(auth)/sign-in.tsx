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
    <SafeAreaView style={{ flex: 1, backgroundColor: canvasBg }}>
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

  return (
    <>
      {/* Hero — fade up. Fixed natural height. */}
      <Animated.View
        entering={FadeInDown.duration(700)}
        style={{ alignItems: "center", marginTop: 32 }}
      >
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            backgroundColor: accent,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 24,
          }}
        >
          <Text
            style={{ fontFamily: "JetBrainsMono-Medium", fontSize: 28, color: "#FFFFFF" }}
          >
            W
          </Text>
        </View>

        <Text
          style={{
            fontFamily: "Inter-SemiBold",
            fontSize: 30,
            lineHeight: 36,
            color: tokens.inkColor,
            textAlign: "center",
          }}
        >
          Notes you can
        </Text>
        <Text
          style={{
            fontFamily: "JetBrainsMono-Medium",
            fontSize: 30,
            lineHeight: 36,
            color: accent,
            textAlign: "center",
          }}
        >
          send.
        </Text>
        <Text
          style={{
            marginTop: 12,
            color: tokens.subtleColor,
            letterSpacing: 3,
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
      <View style={{ width: "100%" }}>
        {/* Email row: rounded input + circular send-arrow button on the right. */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: tokens.surfaceSubtle,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: tokens.borderColor,
            paddingLeft: 20,
            paddingRight: 6,
            height: 56,
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
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: tokens.pillBg,
              alignItems: "center",
              justifyContent: "center",
              opacity: busy && busyProvider !== "email" ? 0.4 : 1,
              transform: [{ scale: pressed ? 0.94 : 1 }],
            })}
          >
            {busyProvider === "email" ? (
              <ActivityIndicator color={tokens.pillFg} />
            ) : (
              <ArrowRightIcon size={18} color={tokens.pillFg} weight="bold" />
            )}
          </Pressable>
        </View>

        {/* "or" divider */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginVertical: 18,
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

        {/* Google pill */}
        <Pressable
          onPress={onGoogle}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => ({
            height: 56,
            borderRadius: 999,
            backgroundColor: tokens.pillBg,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            opacity: busy && busyProvider !== "google" ? 0.4 : busy ? 0.7 : 1,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}
        >
          {busyProvider === "google" ? (
            <ActivityIndicator color={tokens.pillFg} />
          ) : (
            <GoogleLogoIcon size={20} color={tokens.pillFg} weight="bold" />
          )}
          <Text
            style={{
              color: tokens.pillFg,
              marginLeft: 10,
              fontFamily: "Inter-SemiBold",
              fontSize: 16,
            }}
          >
            Continue with Google
          </Text>
        </Pressable>

        {/* GitHub pill */}
        <Pressable
          onPress={onGithub}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => ({
            height: 56,
            borderRadius: 999,
            marginTop: 12,
            backgroundColor: tokens.pillBg,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            opacity: busy && busyProvider !== "github" ? 0.4 : busy ? 0.7 : 1,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}
        >
          {busyProvider === "github" ? (
            <ActivityIndicator color={tokens.pillFg} />
          ) : (
            <GithubLogoIcon size={20} color={tokens.pillFg} weight="bold" />
          )}
          <Text
            style={{
              color: tokens.pillFg,
              marginLeft: 10,
              fontFamily: "Inter-SemiBold",
              fontSize: 16,
            }}
          >
            Continue with GitHub
          </Text>
        </Pressable>

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
            height: 56,
            borderRadius: 999,
            marginTop: 16,
            backgroundColor: tokens.pillBg,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            opacity: busy || code.length < 6 ? 0.5 : 1,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}
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
