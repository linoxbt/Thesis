"use client";

import { useId } from "react";

/** Tiny glowing line for feed cards: shape of the YES price, no axes. */
export function Sparkline({ values, color = "var(--color-yes-mark)", width = 120, height = 36 }: { values: number[]; color?: string; width?: number; height?: number }) {
  const gid = useId().replace(/:/g, "");
  if (values.length < 2) {
    return <div style={{ width, height }} className="grid place-items-center text-[10px] text-faint">new</div>;
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 4) + 2, height - 4 - ((v - lo) / span) * (height - 8)]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.12} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${d}L${last[0]},${height}L2,${height}Z`} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} />
    </svg>
  );
}
