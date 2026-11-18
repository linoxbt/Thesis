"use client";

import { usePoll } from "@/lib/client/api";
import { usdc } from "@/lib/client/format";

interface Stats {
  wallets: string;
  volume_usdc: string;
  theses: string;
  touches_proven: number;
}

/** Protocol constants, shown until there is live activity worth showing. */
const FACTS: [string, string][] = [
  ["Fee per trade", "2%"],
  ["Max proof confidence", "0.5%"],
  ["Settlement grace", "120 s"],
  ["Admin overrides", "0"],
];

/** Live numbers from the indexer once calls exist; protocol facts before that. */
export function LiveStats() {
  const { data } = usePoll<Stats>("/api/stats", 30_000);
  const live = data && Number(data.theses) > 0;
  const cells: [string, string][] = live
    ? [
        ["Volume traded", usdc(data.volume_usdc, 0)],
        ["Trading wallets", data.wallets],
        ["Calls posted", data.theses],
        ["Touches proven", String(data.touches_proven)],
      ]
    : FACTS;
  return (
    <div className="border-y border-line" data-testid="live-stats">
      <div className="mx-auto grid max-w-6xl grid-cols-2 md:grid-cols-4">
        {cells.map(([k, v], i) => (
          <div
            key={k}
            className={
              "px-5 py-8 lg:px-8 " +
              (i % 2 ? "border-l border-line " : "") +
              (i === 2 ? "md:border-l " : "") +
              (i > 1 ? "border-t border-line md:border-t-0" : "")
            }
          >
            <div className="num text-3xl tracking-tight text-ink sm:text-4xl">{v}</div>
            <div className="mt-2 flex items-center gap-2 text-sm text-faint">
              {k}
              {live && i === 0 && <span className="num rounded-full bg-panel-3 px-1.5 text-[10px] uppercase">live</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
