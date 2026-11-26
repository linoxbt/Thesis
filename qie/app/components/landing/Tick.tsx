"use client";

import { useEffect, useState } from "react";

/**
 * A price that drifts by a few cents every couple of seconds, flashing green
 * or red, so the example terminal reads as live. Purely illustrative.
 */
export function Tick({ base, spread = 0.12, className = "" }: { base: number; spread?: number; className?: string }) {
  const [v, setV] = useState(base);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => {
      setV((prev) => {
        const next = Math.min(base + spread, Math.max(base - spread, prev + (Math.random() - 0.5) * spread));
        setDir(next >= prev ? "up" : "down");
        return next;
      });
    }, 1800);
    return () => clearInterval(t);
  }, [base, spread]);
  return (
    <span key={v} className={(dir === "up" ? "tick-up " : dir === "down" ? "tick-down " : "") + className}>
      ${v.toFixed(2)}
    </span>
  );
}
