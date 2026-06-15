import { Rectangle } from "recharts";

interface CandlestickShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: {
    open: number;
    high: number;
    low: number;
    close: number;
    isGreen: boolean;
  };
  background?: { x: number; y: number; width: number; height: number };
  yAxisMin: number;
  yAxisMax: number;
}

export function CandlestickShape({
  x = 0,
  width = 6,
  payload,
  background,
  yAxisMin,
  yAxisMax,
}: CandlestickShapeProps) {
  if (!payload || !background) return null;

  const { open, high, low, close } = payload;
  const isGreen = close >= open;

  const totalHeight = background.height;
  const yTop = background.y;
  const range = yAxisMax - yAxisMin;
  if (range === 0) return null;

  const yForValue = (val: number) =>
    yTop + (1 - (val - yAxisMin) / range) * totalHeight;

  const yOpen = yForValue(open);
  const yClose = yForValue(close);
  const yHigh = yForValue(high);
  const yLow = yForValue(low);

  const bodyTop = Math.min(yOpen, yClose);
  const bodyHeight = Math.max(Math.abs(yOpen - yClose), 1.5);
  const wickX = x + width / 2;

  // Colors
  const bullColor = "hsl(152, 69%, 53%)";
  const bearColor = "hsl(0, 84%, 60%)";
  const bullWick = "hsl(152, 69%, 65%)";
  const bearWick = "hsl(0, 84%, 72%)";

  const bodyColor = isGreen ? bullColor : bearColor;
  const wickColor = isGreen ? bullWick : bearWick;

  // Wider candle bodies, min 4px
  const bodyWidth = Math.max(width * 0.85, 4);
  const bodyX = x + (width - bodyWidth) / 2;

  return (
    <g>
      {/* Upper wick */}
      <line
        x1={wickX}
        y1={yHigh}
        x2={wickX}
        y2={bodyTop}
        stroke={wickColor}
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      {/* Lower wick */}
      <line
        x1={wickX}
        y1={bodyTop + bodyHeight}
        x2={wickX}
        y2={yLow}
        stroke={wickColor}
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      {/* Body */}
      <rect
        x={bodyX}
        y={bodyTop}
        width={bodyWidth}
        height={bodyHeight}
        rx={1}
        fill={isGreen ? bodyColor : "transparent"}
        stroke={bodyColor}
        strokeWidth={isGreen ? 0 : 1.5}
      />
      {/* Subtle glow for large moves */}
      {Math.abs(close - open) / open > 0.015 && (
        <rect
          x={bodyX - 1}
          y={bodyTop - 1}
          width={bodyWidth + 2}
          height={bodyHeight + 2}
          rx={2}
          fill="none"
          stroke={bodyColor}
          strokeWidth={0.5}
          opacity={0.3}
        />
      )}
    </g>
  );
}

// Volume bar shape for sub-chart
export function VolumeBar({
  x = 0,
  y = 0,
  width = 6,
  height = 0,
  payload,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: { isGreen: boolean };
}) {
  if (!payload) return null;
  const color = payload.isGreen
    ? "hsl(152, 69%, 53%)"
    : "hsl(0, 84%, 60%)";
  const barWidth = Math.max(width * 0.7, 2);
  const barX = x + (width - barWidth) / 2;

  return (
    <rect
      x={barX}
      y={y}
      width={barWidth}
      height={Math.max(height, 0)}
      rx={0.5}
      fill={color}
      fillOpacity={0.35}
    />
  );
}
