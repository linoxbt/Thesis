"use client";

import { usePoll } from "@/lib/client/api";
import { usdc } from "@/lib/client/format";

interface Stats {
  wallets: string;
  volume_usdc: string;
  theses: string;
  touches_proven: number;
}

/** One live line from the indexer, shown only once there is activity. */
export function LiveLine() {
  const { data } = usePoll<Stats>("/api/stats", 30_000);
  if (!data || Number(data.theses) === 0) return null;
  const items: [string, string][] = [
    ["calls", data.theses],
    ["traded", usdc(data.volume_usdc, 0)],
    ["wallets", data.wallets],
    ["touches proven", String(data.touches_proven)],
  ];
  return (
    <div className="num mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted" data-testid="live-stats">
      <span className="flex items-center gap-2 text-ink">
        <span className="h-1.5 w-1.5 rounded-full bg-yes" /> Live activity
      </span>
      {items.map(([k, v]) => (
        <span key={k}>
          <span className="text-ink">{v}</span> {k}
        </span>
      ))}
    </div>
  );
}
