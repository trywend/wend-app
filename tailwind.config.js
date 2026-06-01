// Wend — Tailwind (NativeWind 4) config.
//
// Colors are wired to CSS variables (declared in src/theme/global.css) so a
// single ThemeProvider can flip light/dark by swapping the variable set, and
// components never branch on `dark:` for color. The variable NAMES here must
// match the semantic token keys in src/theme/tokens.ts and the var
// declarations in global.css.
//
// NativeWind v4 requires Tailwind v3 (classic config + preset), NOT the v4
// CSS-engine. Hence this JS config rather than the landing's `@theme` block.

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // surfaces
        canvas: "var(--surface-canvas)",
        surface: "var(--surface-elevated)",
        "surface-agent": "var(--surface-agent)",
        "surface-chip": "var(--surface-chip)",
        // borders
        hairline: "var(--border-hairline)",
        "border-default": "var(--border-default)",
        focus: "var(--border-focus)",
        // text (use as text-* and bg-*; named to read well as text-primary etc.)
        primary: "var(--text-primary)",
        secondary: "var(--text-secondary)",
        tertiary: "var(--text-tertiary)",
        agent: "var(--text-agent)",
        placeholder: "var(--text-placeholder)",
        // accent — the one ember verb
        accent: "var(--accent-default)",
        "accent-pressed": "var(--accent-pressed)",
        "accent-caret": "var(--accent-caret)",
        "accent-on": "var(--accent-on)",
        // status
        running: "var(--status-running)",
        done: "var(--status-done)",
        failed: "var(--status-failed)",
        warn: "var(--status-warn)",
        // diff
        "diff-add": "var(--diff-add-bg)",
        "diff-add-gutter": "var(--diff-add-gutter)",
        "diff-del": "var(--diff-del-bg)",
        "diff-del-gutter": "var(--diff-del-gutter)",
        // syntax
        "syntax-keyword": "var(--syntax-keyword)",
        "syntax-string": "var(--syntax-string)",
        "syntax-number": "var(--syntax-number)",
        "syntax-comment": "var(--syntax-comment)",
        "syntax-function": "var(--syntax-function)",
        "syntax-type": "var(--syntax-type)",
      },
      fontFamily: {
        sans: ["Inter"],
        "sans-medium": ["Inter-Medium"],
        "sans-semibold": ["Inter-SemiBold"],
        mono: ["JetBrainsMono"],
        "mono-medium": ["JetBrainsMono-Medium"],
      },
      // Typography scale — Design Doc § 3.2. [fontSize, { lineHeight }].
      fontSize: {
        display: ["28px", { lineHeight: "34px" }],
        title: ["22px", { lineHeight: "28px" }],
        heading: ["19px", { lineHeight: "26px" }],
        body: ["17px", { lineHeight: "26px" }],
        meta: ["13px", { lineHeight: "18px" }],
        caption: ["12px", { lineHeight: "16px" }],
        "mono-body": ["14px", { lineHeight: "22px" }],
        "mono-inline": ["14px", { lineHeight: "20px" }],
      },
      borderRadius: {
        block: "8px", // agent block / chip / code-frame radius (Design Doc § 4.2)
      },
    },
  },
  plugins: [],
};
