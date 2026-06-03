/**
 * Wend — logo mark (React Native / react-native-svg).
 *
 * Geometry matches the canonical V2 export (landing/public/brand/wend_mark.svg):
 * a W built from four diagonals with the ember caret integrated into the right
 * valley. The viewBox carries top headroom (y starts at -44) so the caret tip
 * (drawn up to y=-20) is never clipped.
 *
 * The W strokes take `inkColor` (so they theme), the caret stays canonical
 * ember #D85A3C.
 */
import Svg, { Path } from "react-native-svg";

const W_PATH = "M20 30 L60 140 L100 30 L140 140 L180 30";
const CARET_PATH = "M180 30 L220 -20";
const EMBER = "#D85A3C";

export function WendMark({
  height = 48,
  inkColor = "#161412",
}: {
  height?: number;
  inkColor?: string;
}) {
  // viewBox is 240 wide × 200 tall → width tracks height at a 1.2 ratio.
  const width = height * 1.2;
  return (
    <Svg width={width} height={height} viewBox="0 -44 240 200" fill="none">
      <Path
        d={W_PATH}
        stroke={inkColor}
        strokeWidth={22}
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <Path d={CARET_PATH} stroke={EMBER} strokeWidth={22} strokeLinecap="square" />
    </Svg>
  );
}
