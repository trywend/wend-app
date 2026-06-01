/**
 * Wend — StatusDot primitive.
 *
 * The agent-run status glyph used in agent blocks, inbox cards, and the peek
 * bar (Design Doc § 3.3 / § 4.2). Filled glyphs (weight="fill") per the spec:
 *   running            → ◐ CircleHalf, status-running (amber)
 *   done               → ● Circle filled, status-done (sage)
 *   failed             → ✗ X, status-failed (rose)
 *   awaiting_permission→ ⏸ Pause, status-warn (amber)
 *
 * Color comes from the resolved theme tokens (Phosphor takes a `color` string,
 * not a className) — but the mapping is to SEMANTIC status tokens, so it still
 * flips correctly light/dark. The running glyph's rotation animation is added
 * in the polish phase; Phase 1 renders it static.
 */
import {
  CircleHalfIcon,
  CircleIcon,
  XIcon,
  PauseIcon,
} from "phosphor-react-native";

import { useTheme } from "@/theme/ThemeProvider";

export type StatusKind = "running" | "done" | "failed" | "awaiting_permission";

export function StatusDot({
  status,
  size = 16,
}: {
  status: StatusKind;
  size?: number;
}) {
  const { tokens } = useTheme();

  switch (status) {
    case "running":
      return (
        <CircleHalfIcon
          size={size}
          color={tokens["status-running"]}
          weight="fill"
        />
      );
    case "done":
      return (
        <CircleIcon size={size} color={tokens["status-done"]} weight="fill" />
      );
    case "failed":
      return <XIcon size={size} color={tokens["status-failed"]} weight="bold" />;
    case "awaiting_permission":
      return (
        <PauseIcon size={size} color={tokens["status-warn"]} weight="fill" />
      );
  }
}
