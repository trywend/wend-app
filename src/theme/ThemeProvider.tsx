/**
 * Wend — ThemeProvider + useTheme.
 *
 * Resolves the active color scheme and exposes the resolved semantic token
 * values (for the rare imperative case — e.g. a TextInput's selectionColor or
 * an SVG icon `color` prop where a className can't reach). Components should
 * still prefer Tailwind classes (`bg-canvas`, `text-primary`, …) for color;
 * this hook is the escape hatch, not the default.
 *
 * Scheme resolution (locked decision #10 — default System):
 *   preference "system" → follow the OS via NativeWind's useColorScheme
 *   preference "light" | "dark" → force it
 * The preference lives in the UI store (zustand); we read it here and drive
 * NativeWind so the `.dark` class (and thus every color var) flips in one place.
 */
import React, { createContext, useContext, useEffect, useMemo } from "react";
import { useColorScheme as useRNColorScheme } from "react-native";
import { useColorScheme as useNativewindColorScheme } from "nativewind";

import {
  darkTokens,
  lightTokens,
  type ColorScheme,
  type ThemeTokens,
} from "./tokens";
import { useUiStore, type ThemePreference } from "@/store/uiSlice";

interface ThemeContextValue {
  scheme: ColorScheme;
  preference: ThemePreference;
  tokens: ThemeTokens;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preference = useUiStore((s) => s.themePreference);
  const setPreference = useUiStore((s) => s.setThemePreference);

  // OS-level scheme (used when preference === "system"). RN can report
  // "unspecified"/null on some Android states — treat anything non-dark as light.
  const osScheme: ColorScheme =
    useRNColorScheme() === "dark" ? "dark" : "light";
  const { setColorScheme } = useNativewindColorScheme();

  const scheme: ColorScheme = preference === "system" ? osScheme : preference;

  // Drive NativeWind's class so the `.dark` variable set (global.css) applies.
  useEffect(() => {
    setColorScheme(preference);
  }, [preference, setColorScheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      scheme,
      preference,
      tokens: scheme === "dark" ? darkTokens : lightTokens,
      setPreference,
    }),
    [scheme, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
