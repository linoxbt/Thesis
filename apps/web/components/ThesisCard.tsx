"use client";

import { Clock, Shield } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useNow } from "@/lib/client/api";
import { pct, pythToNumber, shortAddr, timeLeft, usd, usdc, when } from "@/lib/client/format";
import { Sparkline } from "./Sparkline";
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
  initial_price_bps: number;
  yes_price_bps: number;
  touched: boolean;
  settled: boolean;
  spark?: number[];
}

/** Address avatar: two letters on a mint-tinted disc. */
export function Avatar({ addr, size = 28 }: { addr: string; size?: number }) {
  return (
    <span
      className="num grid shrink-0 place-items-center rounded-full bg-panel-3 text-[10px] uppercase text-muted ring-1 ring-line-2"
      style={{ width: size, height: size }}
    >
      {addr.slice(0, 2)}
    </span>
  );
}

export function StateBadge({ touched, settled, outcome, winning }: { touched: boolean; settled: boolean; outcome?: number; winning?: number }) {
  const base = "num rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ";
  if (settled || (outcome ?? 0) > 0) {
    const hit = outcome === 1 || winning === 1;
    return <span className={base + (hit ? "bg-yes/10 text-yes ring-1 ring-yes/30" : "bg-panel-3 text-muted")}>{hit ? "Called it" : "Missed"}</span>;
  }
  if (touched) return <span className={base + "bg-yes/10 text-yes ring-1 ring-yes/30"}>Touched · settles at end</span>;
  return (
    <span className={base + "bg-panel-3 text-muted"}>
      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-brand align-middle" />
      Live
    </span>
  );
}

/** Odds moved since the market opened, in percentage points. */
export function Delta({ now, open }: { now: number; open: number }) {
  const d = (now - open) / 100;
  if (Math.abs(d) < 0.05) return <span className="num whitespace-nowrap text-xs text-faint">±0.0</span>;
  return (
    <span className={"num whitespace-nowrap text-xs " + (d > 0 ? "text-yes" : "text-bad")}>
      {(d > 0 ? "+" : "") + d.toFixed(1)} pts
    </span>
  );
}

export function ThesisCard({ t }: { t: FeedThesis }) {
  const now = useNow(1000);
  const [open, setOpen] = useState<null | "buy_yes" | "buy_no">(null);
  const endTs = Number(t.end_ts);
  const live = !t.touched && !t.settled && endTs > now;
  const strike = pythToNumber(t.strike, t.expo);
  return (
    <article className="panel min-w-0 p-5 transition-colors hover:border-line-2" data-testid="thesis-card">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/u/${t.creator}`} className="flex min-w-0 items-center gap-2 text-sm text-muted hover:text-ink">
          <Avatar addr={t.creator} />
          <span className="truncate">{t.display_name ?? <span className="num">{shortAddr(t.creator)}</span>}</span>
        </Link>
        <div className="flex shrink-0 items-center gap-1.5">
          {t.has_protection && (
            <span className="num flex items-center gap-1 rounded-full bg-guard/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-guard ring-1 ring-guard/30">
              <Shield size={10} /> Protected
            </span>
          )}
          <StateBadge touched={t.touched} settled={t.settled} outcome={t.outcome} />
        </div>
      </div>

      <Link href={`/t/${t.pda}`} className="mt-4 block">
        <h2 className="display text-2xl leading-tight">
          SOL {t.direction === "above" ? "↑" : "↓"} <span className="num tracking-normal">{usd(strike)}</span>
        </h2>
        <div className="num mt-1 text-xs text-faint">by {when(endTs)}</div>
        {t.text && <p className="mt-2 line-clamp-2 text-sm text-muted">{t.text}</p>}
      </Link>

      <div className="mt-5 flex items-end justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="num text-[32px] leading-none text-ink">{pct(t.yes_price_bps, 1)}</span>
            <Delta now={t.yes_price_bps} open={t.initial_price_bps} />
          </div>
          <div className="mt-1 text-[11px] text-faint">YES · crowd odds it hits</div>
        </div>
        <Sparkline values={t.spark ?? []} />
      </div>

      <div className="num mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-faint">
        <span>
          vol 24h <span className="text-muted">{usdc(t.volume_24h, 0)}</span>
        </span>
        <span className="flex items-center gap-1">
          <Clock size={11} />
          {live ? `${timeLeft(endTs, now)} left` : endTs > now ? "trading closed" : "ended"}
        </span>
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
              <button onClick={() => setOpen("buy_yes")} className="btn btn-yes text-sm">
                Back
              </button>
              <button onClick={() => setOpen("buy_no")} className="btn btn-ghost text-sm">
                Challenge
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
