/**
 * Wend — logo mark (React Native / react-native-svg).
 *
 * Geometry matches the canonical V2 board (final_logo.png): a W from four
 * diagonals with the ember caret as the INTEGRATED tip of the rightmost
 * upstroke — same angle, contained in the letterform (not a separate slash).
 *
 * Coordinates are in the shared 1024 space used by the app icons. The W
 * strokes take `inkColor` (so they theme); the caret stays canonical ember.
 */
import Svg, { Path } from "react-native-svg";

const W_INK = "M240 280 L380 720 L512 280 L644 720 L742 412";
const W_CARET = "M742 412 L784 280";
const EMBER = "#D85A3C";
const STROKE = 90;

export function WendMark({
  height = 48,
  inkColor = "#161412",
}: {
  height?: number;
  inkColor?: string;
}) {
  // viewBox is 660 wide × 590 tall → width tracks height at ~1.119.
  const width = height * (660 / 590);
  return (
    <Svg width={width} height={height} viewBox="180 215 660 590" fill="none">
      <Path
        d={W_INK}
        stroke={inkColor}
        strokeWidth={STROKE}
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <Path d={W_CARET} stroke={EMBER} strokeWidth={STROKE} strokeLinecap="square" />
    </Svg>
  );
}
