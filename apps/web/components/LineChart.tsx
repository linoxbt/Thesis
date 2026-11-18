"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface Point {
  t: number; // unix seconds
  v: number;
}

interface Props {
  points: Point[];
  /** CSS colour of the single series (a validated chart-mark token). */
  color: string;
  /** Accessible name; the visible title lives outside the chart. */
  label: string;
  yDomain?: [number, number];
  yFormat: (v: number) => string;
  /** Horizontal reference lines, e.g. the strike. */
  refs?: { v: number; label: string }[];
  /** A vertical event marker, e.g. the touch. */
  marker?: { t: number; label: string };
  height?: number;
}

const PAD = { top: 12, right: 56, bottom: 22, left: 8 };
const timeFmt = (t: number) => new Date(t * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

/**
 * One series, one axis. 2px line + 10% wash, hairline grid, reference lines
 * for strikes, crosshair + tooltip on hover/focus, and a data table so no
 * value is hover-only (dataviz marks-and-anatomy / interaction specs).
 */
export function LineChart({ points, color, label, yDomain, yFormat, refs = [], marker, height = 160 }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(300);
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, "");

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = useMemo(() => [...points].sort((a, b) => a.t - b.t), [points]);
  const geo = useMemo(() => {
    if (pts.length === 0) return null;
    const t0 = pts[0].t;
    const t1 = Math.max(pts[pts.length - 1].t, marker?.t ?? 0, t0 + 1);
    const vals = [...pts.map((p) => p.v), ...refs.map((r) => r.v)];
    let [y0, y1] = yDomain ?? [Math.min(...vals), Math.max(...vals)];
    if (!yDomain) {
      const pad = (y1 - y0) * 0.1 || Math.abs(y1) * 0.002 || 1;
      y0 -= pad;
      y1 += pad;
    }
    const w = width - PAD.left - PAD.right;
    const h = height - PAD.top - PAD.bottom;
    const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * w;
    const y = (v: number) => PAD.top + (1 - (v - y0) / (y1 - y0)) * h;
    const ticks = [0, 0.5, 1].map((f) => y0 + f * (y1 - y0));
    return { x, y, ticks, t0, t1, y0, base: PAD.top + h };
  }, [pts, refs, marker, yDomain, width, height]);

  if (!geo || pts.length === 0) {
    return (
      <div ref={wrap} className="flex items-center justify-center rounded-xl border border-dashed border-line text-xs text-faint" style={{ height }}>
        No data yet
      </div>
    );
  }

  const path = pts.map((p, i) => `${i ? "L" : "M"}${geo.x(p.t).toFixed(1)},${geo.y(p.v).toFixed(1)}`).join("");
  const area = `${path}L${geo.x(pts[pts.length - 1].t).toFixed(1)},${geo.base}L${geo.x(pts[0].t).toFixed(1)},${geo.base}Z`;
  const last = pts[pts.length - 1];
  const h = hover !== null ? pts[hover] : null;

  const onMove = (clientX: number) => {
    const rect = wrap.current!.getBoundingClientRect();
    const px = clientX - rect.left;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(geo.x(pts[i].t) - px) < Math.abs(geo.x(pts[best].t) - px)) best = i;
    setHover(best);
  };

  return (
    <div className="min-w-0">
      <div ref={wrap} className="relative w-full min-w-0 overflow-hidden" style={{ height }}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label}: latest ${yFormat(last.v)}`}
          tabIndex={0}
          onPointerMove={(e) => onMove(e.clientX)}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(pts.length - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setHover((i) => Math.max(0, (i ?? pts.length - 1) - 1));
            if (e.key === "ArrowRight") setHover((i) => Math.min(pts.length - 1, (i ?? 0) + 1));
          }}
          className="outline-none"
        >
          {geo.ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={width - PAD.right} y1={geo.y(v)} y2={geo.y(v)} stroke="var(--color-line)" strokeWidth={1} />
              <text x={width - PAD.right + 6} y={geo.y(v) + 4} fontSize={10} fill="var(--color-muted)" className="num">
                {yFormat(v)}
              </text>
            </g>
          ))}
          {refs.map((r) => (
            <g key={r.label}>
              <line x1={PAD.left} x2={width - PAD.right} y1={geo.y(r.v)} y2={geo.y(r.v)} stroke="var(--color-muted)" strokeWidth={1} />
              <text x={PAD.left + 4} y={geo.y(r.v) - 4} fontSize={10} fill="var(--color-ink)" className="num">
                {r.label}
              </text>
            </g>
          ))}
          {marker && (
            <g>
              <line x1={geo.x(marker.t)} x2={geo.x(marker.t)} y1={PAD.top} y2={geo.base} stroke="var(--color-ink)" strokeWidth={1} />
              <text x={geo.x(marker.t) + 4} y={PAD.top + 10} fontSize={10} fill="var(--color-ink)">
                {marker.label}
              </text>
            </g>
          )}
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.12} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
            <filter id={`${gid}-glow`} x="-5%" y="-30%" width="110%" height="160%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>
          <path d={area} fill={`url(#${gid})`} />
          <path d={path} fill="none" stroke={color} strokeWidth={4} opacity={0.35} filter={`url(#${gid}-glow)`} />
          <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={geo.x(last.t)} cy={geo.y(last.v)} r={4} fill={color} stroke="var(--color-panel)" strokeWidth={2} />
          <text x={geo.x(last.t) + 8} y={geo.y(last.v) + 4} fontSize={11} fill="var(--color-ink)" className="num">
            {geo.x(last.t) + 60 < width ? yFormat(last.v) : ""}
          </text>
          <text x={PAD.left} y={height - 6} fontSize={10} fill="var(--color-muted)" className="num">
            {timeFmt(geo.t0)}
          </text>
          {timeFmt(geo.t1) !== timeFmt(geo.t0) && (
            <text x={width - PAD.right} y={height - 6} fontSize={10} fill="var(--color-muted)" textAnchor="end" className="num">
              {timeFmt(geo.t1)}
            </text>
          )}
          {h && (
            <g pointerEvents="none">
              <line x1={geo.x(h.t)} x2={geo.x(h.t)} y1={PAD.top} y2={geo.base} stroke="var(--color-faint)" strokeWidth={1} />
              <circle cx={geo.x(h.t)} cy={geo.y(h.v)} r={4} fill={color} stroke="var(--color-panel)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {h && (
          <div
            className="pointer-events-none absolute rounded-lg border border-line-2 bg-panel-2 px-2.5 py-1.5 text-xs shadow-xl"
            style={{ left: Math.min(geo.x(h.t) + 8, width - 120), top: 4 }}
          >
            <div className="num font-semibold text-ink">{yFormat(h.v)}</div>
            <div className="flex items-center gap-1 text-muted">
              <span className="inline-block h-0.5 w-3" style={{ background: color }} />
              {timeFmt(h.t)}
            </div>
          </div>
        )}
      </div>
      <details className="mt-1 text-xs text-muted">
        <summary className="cursor-pointer select-none">Show data</summary>
        <table className="num mt-1 w-full">
          <tbody>
            {pts.slice(-20).map((p) => (
              <tr key={p.t}>
                <td>{new Date(p.t * 1000).toLocaleString()}</td>
                <td className="text-right text-ink">{yFormat(p.v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
