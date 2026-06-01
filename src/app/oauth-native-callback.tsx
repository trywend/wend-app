/**
 * Safety net for Clerk OAuth's default redirect URL (`wend://oauth-native-callback`).
 *
 * Normally `useOAuthSignIn` passes its own redirectUrl pointing at "/", so we
 * never land here. But if any path falls back to Clerk's default, this route
 * catches the deep link and forwards to root — AuthGate then takes it from
 * there based on whether the session is active.
 */
import { Redirect } from "expo-router";

export default function OAuthNativeCallback() {
  return <Redirect href="/" />;
}
