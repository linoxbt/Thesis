"use client";

import { NETWORK } from "@/lib/config";
import { useData } from "@/lib/data";
import { qusdc } from "@/lib/format";

/** One live line from the contract, shown only once there is activity. */
export function LiveLine() {
  const { calls, events } = useData();
  if (calls.length === 0) return null;
  const wallets = new Set([...events.trades.map((t) => t.user.toLowerCase()), ...calls.map((c) => c.creator.toLowerCase())]).size;
  const items: [string, string][] = [
    ["calls", String(calls.length)],
    ["traded", `${qusdc(calls.reduce((s, c) => s + c.volume, 0n), 0)} QUSDC`],
    ["wallets", String(wallets)],
    ["touches proven", String(calls.filter((c) => c.touched).length)],
  ];
  return (
    <div className="num mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted" data-testid="live-stats">
      <span className="flex items-center gap-2 text-ink">
        <span className="h-1.5 w-1.5 rounded-full bg-yes" /> Live on QIE {NETWORK}
      </span>
      {items.map(([k, v]) => (
        <span key={k}>
          <span className="text-ink">{v}</span> {k}
        </span>
      ))}
    </div>
  );
}
