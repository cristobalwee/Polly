import { useMemo } from 'react';
import Svg, { Polyline } from 'react-native-svg';
import { useTheme, View } from 'tamagui';

/**
 * Minimal cross-platform sparkline.
 *
 * Renders a polyline through `points` inside an SVG. The path is computed in a
 * fixed 100×40 view-box and then the SVG scales to whatever `width × height`
 * the caller asks for — so the same component works at 120×32 in a card and at
 * 100% × 120 on the detail screen without per-call layout maths.
 *
 * With fewer than two points it draws a flat baseline rather than collapsing,
 * which keeps card heights identical whether or not price history has
 * accumulated for a market.
 */

const VIEW_W = 100;
const VIEW_H = 40;

export interface SparklineProps {
  /** Recent YES-mid prices in cents, oldest → newest. */
  points: number[];
  width?: number | string;
  height?: number;
  strokeWidth?: number;
  /** Override stroke colour; defaults to the Tamagui `$accent` theme token. */
  color?: string;
}

export function Sparkline({
  points,
  width = 120,
  height = 32,
  strokeWidth = 1.5,
  color,
}: SparklineProps) {
  const theme = useTheme();
  const stroke = color ?? theme.accent?.val ?? '#4f46e5';

  const path = useMemo(() => {
    if (points.length < 2) return null;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const stepX = VIEW_W / (points.length - 1);
    return points
      .map((p, i) => {
        const x = i * stepX;
        // Invert y so higher prices render upward in screen space.
        const y = VIEW_H - ((p - min) / range) * VIEW_H;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }, [points]);

  return (
    <View
      width={width as number}
      height={height}
      bg="$backgroundHover"
      br="$2"
      overflow="hidden"
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none">
        {path ? (
          <Polyline points={path} fill="none" stroke={stroke} strokeWidth={strokeWidth} />
        ) : (
          // Centred baseline — same footprint, just visually muted.
          <Polyline
            points={`0,${VIEW_H / 2} ${VIEW_W},${VIEW_H / 2}`}
            fill="none"
            stroke={stroke}
            strokeOpacity={0.25}
            strokeWidth={strokeWidth}
          />
        )}
      </Svg>
    </View>
  );
}
