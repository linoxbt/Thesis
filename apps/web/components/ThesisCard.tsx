"use client";

import Link from "next/link";
import { useState } from "react";
import { useNow } from "@/lib/client/api";
import { callLine, pct, shortAddr, timeLeft, usdc } from "@/lib/client/format";
import { TradeBox } from "./TradeBox";

export interface FeedThesis {
  pda: string;
  creator: string;
  display_name: string | null;
  text: string | null;
  end_ts: string;
  outcome: number;
  volume_usdc: string;
  volume_24h: string;
  has_protection: boolean;
  conviction_market: string;
  pm_market: string;
  direction: "above" | "below";
  strike: string;
  expo: number;
  yes_price_bps: number;
  touched: boolean;
  settled: boolean;
}

export function StateBadge({ touched, settled, outcome, winning }: { touched: boolean; settled: boolean; outcome?: number; winning?: number }) {
  if (settled || (outcome ?? 0) > 0) {
    const hit = outcome === 1 || winning === 1;
    return (
      <span className={"rounded px-1.5 py-0.5 text-[11px] font-semibold " + (hit ? "bg-yes/15 text-yes" : "bg-line text-muted")}>
        {hit ? "Called it" : "Missed"}
      </span>
    );
  }
  if (touched) return <span className="rounded bg-yes/15 px-1.5 py-0.5 text-[11px] font-semibold text-yes">Touched · settles at end</span>;
  return <span className="rounded bg-line px-1.5 py-0.5 text-[11px] text-muted">Open</span>;
}

export function ThesisCard({ t }: { t: FeedThesis }) {
  const now = useNow(1000);
  const [open, setOpen] = useState<null | "buy_yes" | "buy_no">(null);
  const endTs = Number(t.end_ts);
  const live = !t.touched && !t.settled && endTs > now;
  return (
    <article className="min-w-0 rounded-xl bg-panel p-4 ring-1 ring-line" data-testid="thesis-card">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted">
        <Link href={`/u/${t.creator}`} className="hover:text-ink">
          {t.display_name ?? <span className="num">{shortAddr(t.creator)}</span>}
        </Link>
        <div className="flex items-center gap-2">
          {t.has_protection && (
            <span className="rounded bg-guard/15 px-1.5 py-0.5 text-[11px] font-semibold text-guard">Protected</span>
          )}
          <StateBadge touched={t.touched} settled={t.settled} outcome={t.outcome} />
        </div>
      </div>
      <Link href={`/t/${t.pda}`} className="block">
        <h2 className="num text-[17px] font-bold leading-snug">{callLine(t.direction, t.strike, t.expo, endTs)}</h2>
        {t.text && <p className="mt-1 line-clamp-2 text-sm text-muted">{t.text}</p>}
      </Link>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className="num text-3xl font-bold">{pct(t.yes_price_bps, 0)}</div>
          <div className="text-[11px] text-muted">crowd odds it hits (YES)</div>
        </div>
        <div className="num text-right text-xs text-muted">
          <div>
            vol <span className="text-ink">{usdc(t.volume_24h, 0)}</span> 24h
          </div>
          <div>{live ? `${timeLeft(endTs, now)} left` : endTs > now ? "trading closed" : "ended"}</div>
        </div>
      </div>
      {live && (
        <div className="mt-3">
          {open ? (
            <TradeBox
              compact
              kind="conviction"
              initialSide={open}
              market={{ touchMarket: t.conviction_market, pmMarket: t.pm_market, thesis: t.pda, thesisCreator: t.creator }}
              onDone={() => setOpen(null)}
            />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setOpen("buy_yes")} className="rounded-md bg-yes py-2 text-sm font-semibold text-yes-ink">
                Back
              </button>
              <button onClick={() => setOpen("buy_no")} className="rounded-md py-2 text-sm font-semibold ring-1 ring-line hover:bg-panel-2">
                Challenge
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
