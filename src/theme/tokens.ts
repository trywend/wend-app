/**
 * Wend — Paper & Ember design tokens (single source of truth).
 *
 * Ported from Design Doc § 3.1 + the landing's globals.css. Both the
 * NativeWind Tailwind config (tailwind.config.js) and the runtime
 * ThemeProvider read from here so the two surfaces (app + web) stay in lockstep
 * and there is exactly ONE place to change a hex value.
 *
 * Components NEVER hardcode hex and NEVER branch on `dark:` for color. They use
 * semantic Tailwind classes (e.g. `bg-canvas`, `text-primary`, `bg-accent`)
 * which resolve to CSS variables that the ThemeProvider flips per scheme.
 *
 * Where the Design Doc and the landing disagreed on a hex (the landing tuned a
 * few values for the web canvas), the landing's resolved values win for the
 * overlapping semantic tokens (canvas/text/accent/border/status) so the two
 * surfaces match exactly. Tokens the landing never defined (surface-elevated,
 * surface-agent, surface-chip, diff.*, syntax.*) come straight from the
 * Design Doc primitives.
 */

// --- Primitives (Design Doc § 3.1) -----------------------------------------
const paper = {
  50: "#FBFAF7",
  100: "#F7F4EE",
  200: "#EFEAE0",
  300: "#E2DCD0",
  400: "#C9C1B2",
  500: "#8E8779",
} as const;

const ink = {
  900: "#1A1714",
  700: "#3A342D",
  500: "#6B645A",
  300: "#9A9388",
} as const;

const soot = {
  900: "#161412",
  800: "#1E1B18",
  700: "#221E1A",
  600: "#2A2622",
  500: "#3A332C",
  400: "#5C544A",
  300: "#8A8278",
} as const;

const bone = {
  100: "#F5F1EA",
  300: "#D6CFC2",
  500: "#A39B8E",
} as const;

const emberLight = { 300: "#F0876E", 500: "#D85A3C", 700: "#B0432A" } as const;
const emberDark = { 300: "#E87155", 500: "#D85A3C", 700: "#C04F33" } as const;

/**
 * Semantic token names. This list is the contract: every value below has a
 * `light` and a `dark` resolution. Keep names in sync with `tailwind.config.js`
 * (it maps each to a CSS variable of the same kebab-cased name).
 */
export interface ThemeTokens {
  // surfaces
  "surface-canvas": string;
  "surface-elevated": string;
  "surface-agent": string;
  "surface-chip": string;
  // borders
  "border-hairline": string;
  "border-default": string;
  "border-focus": string;
  // text
  "text-primary": string;
  "text-secondary": string;
  "text-tertiary": string;
  "text-agent": string;
  "text-placeholder": string;
  // accent (the one ember verb)
  "accent-default": string;
  "accent-pressed": string;
  "accent-caret": string;
  "accent-on": string; // foreground placed on top of an accent fill
  // status
  "status-running": string;
  "status-done": string;
  "status-failed": string;
  "status-warn": string;
  // diff
  "diff-add-bg": string;
  "diff-add-gutter": string;
  "diff-del-bg": string;
  "diff-del-gutter": string;
  // syntax (for later code rendering — Design Doc § 3.1)
  "syntax-keyword": string;
  "syntax-string": string;
  "syntax-number": string;
  "syntax-comment": string;
  "syntax-function": string;
  "syntax-type": string;
}

export const lightTokens: ThemeTokens = {
  "surface-canvas": paper[50],
  "surface-elevated": "#FFFFFF",
  "surface-agent": paper[100],
  "surface-chip": paper[200],

  "border-hairline": paper[300],
  "border-default": paper[400],
  "border-focus": emberLight[500],

  "text-primary": ink[900],
  "text-secondary": ink[500],
  "text-tertiary": ink[300],
  "text-agent": ink[700],
  "text-placeholder": paper[500],

  "accent-default": emberLight[500],
  "accent-pressed": emberLight[700],
  "accent-caret": emberLight[500],
  "accent-on": "#FFFFFF",

  "status-running": "#C28A1F", // amber.500
  "status-done": "#4F7A5E", // sage.500
  "status-failed": "#B3464A", // rose.500
  "status-warn": "#C28A1F", // amber.500

  "diff-add-bg": "#E8F2EA",
  "diff-add-gutter": "#4F7A5E",
  "diff-del-bg": "#F6E5E2",
  "diff-del-gutter": "#B3464A",

  "syntax-keyword": "#7A5BC9",
  "syntax-string": "#4F7A5E",
  "syntax-number": "#C28A1F",
  "syntax-comment": ink[300],
  "syntax-function": "#3A6DA8",
  "syntax-type": emberLight[500],
};

export const darkTokens: ThemeTokens = {
  "surface-canvas": soot[900],
  "surface-elevated": soot[800],
  "surface-agent": soot[700],
  "surface-chip": soot[600],

  "border-hairline": soot[500],
  "border-default": soot[400],
  "border-focus": emberDark[500],

  "text-primary": bone[100],
  "text-secondary": bone[300],
  "text-tertiary": bone[500],
  "text-agent": bone[100],
  "text-placeholder": soot[300],

  "accent-default": emberDark[500],
  "accent-pressed": emberDark[700],
  "accent-caret": emberDark[300],
  "accent-on": "#FFFFFF",

  "status-running": "#DAA13B", // amber.400
  "status-done": "#7DA88B", // sage.400
  "status-failed": "#D26A6E", // rose.400
  "status-warn": "#DAA13B", // amber.400

  "diff-add-bg": "#1F2D24",
  "diff-add-gutter": "#7DA88B",
  "diff-del-bg": "#2E1F1D",
  "diff-del-gutter": "#D26A6E",

  "syntax-keyword": "#B49BEE",
  "syntax-string": "#7DA88B",
  "syntax-number": "#DAA13B",
  "syntax-comment": bone[500],
  "syntax-function": "#8DB6E5",
  "syntax-type": emberDark[300],
};

/** Every semantic token name, derived from the light map (both maps share keys). */
export const tokenNames = Object.keys(lightTokens) as (keyof ThemeTokens)[];

/**
 * Typography scale — Design Doc § 3.2. Values are [fontSize, lineHeight, weight].
 * Exposed as NativeWind text utilities (text-display, text-title, …) AND as a
 * runtime map for the few places that set type imperatively (e.g. TextInput).
 */
export const typography = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: "600" },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "600" },
  heading: { fontSize: 19, lineHeight: 26, fontWeight: "600" },
  body: { fontSize: 17, lineHeight: 26, fontWeight: "400" },
  "body-em": { fontSize: 17, lineHeight: 26, fontWeight: "500" },
  meta: { fontSize: 13, lineHeight: 18, fontWeight: "500" },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "500" },
  "mono-body": { fontSize: 14, lineHeight: 22, fontWeight: "400" },
  "mono-inline": { fontSize: 14, lineHeight: 20, fontWeight: "500" },
} as const;

export type TypographyToken = keyof typeof typography;

/** Font family names as registered with expo-font (see theme/fonts.ts). */
export const fontFamily = {
  sans: "Inter",
  sansMedium: "Inter-Medium",
  sansSemibold: "Inter-SemiBold",
  mono: "JetBrainsMono",
  monoMedium: "JetBrainsMono-Medium",
} as const;

export type ColorScheme = "light" | "dark";
