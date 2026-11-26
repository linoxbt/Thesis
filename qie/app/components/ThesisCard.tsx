"use client";

import { Clock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { Call, Feed } from "@/lib/chain";
import { impliedYesBps, oddsHistory, useData, useNow, volumeSince } from "@/lib/data";
import { pct, price, qusdc, shortAddr, timeLeft, when } from "@/lib/format";
import { positionOf } from "@/lib/position";
import { PositionLevels, SidePill } from "./Position";
import { Sparkline } from "./Sparkline";
import { TradeBox } from "./TradeBox";

/** Address avatar: two letters on a tinted disc. */
export function Avatar({ addr, size = 28 }: { addr: string; size?: number }) {
  return (
    <span
      className="num grid shrink-0 place-items-center rounded-full bg-panel-3 text-[10px] uppercase text-muted ring-1 ring-line-2"
      style={{ width: size, height: size }}
    >
      {addr.slice(2, 4)}
    </span>
  );
}

export function StateBadge({ touched, settled, yesWon }: { touched: boolean; settled: boolean; yesWon: boolean }) {
  const base = "num rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ";
  if (settled) {
    return <span className={base + (yesWon ? "bg-yes/10 text-yes ring-1 ring-yes/30" : "bg-panel-3 text-muted")}>{yesWon ? "Called it" : "Missed"}</span>;
  }
  if (touched) return <span className={base + "bg-yes/10 text-yes ring-1 ring-yes/30"}>Touched</span>;
  return (
    <span className={base + "bg-panel-3 text-muted"}>
      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-brand align-middle" />
      Live
    </span>
  );
}

/** Odds moved since the call opened, in percentage points. */
export function Delta({ now, open }: { now: number; open: number }) {
  const d = (now - open) / 100;
  if (Math.abs(d) < 0.05) return <span className="num whitespace-nowrap text-xs text-faint">±0.0</span>;
  return (
    <span className={"num whitespace-nowrap text-xs " + (d > 0 ? "text-yes" : "text-bad")}>
      {(d > 0 ? "+" : "") + d.toFixed(1)} pts
    </span>
  );
}

/** A call as the position behind it: long if it must rise to the target, short if it must fall. */
export function positionOfCall(c: Call, feed: Feed | undefined) {
  const dec = feed?.decimals ?? 8;
  return positionOf(c.above ? "above" : "below", price(c.spotAtOpen, dec), price(c.strike, dec), null);
}

export const pairOf = (feed: Feed | undefined) => `${feed?.asset ?? "…"} / USDT`;

export function ThesisCard({ c, feed }: { c: Call; feed: Feed | undefined }) {
  const now = useNow(1000);
  const { tradesOf } = useData();
  const [open, setOpen] = useState<null | "yes" | "no">(null);
  const trades = tradesOf(c.id);
  const live = !c.touched && !c.settled && c.end > now;
  const pos = positionOfCall(c, feed);
  const mark = feed ? price(feed.price, feed.decimals) : null;
  const yes = impliedYesBps(c);
  const spark = oddsHistory(c, trades).map((p) => p.v);
  return (
    <article className="panel min-w-0 p-5 transition-colors hover:border-line-2" data-testid="thesis-card">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/u/?a=${c.creator}`} className="flex min-w-0 items-center gap-2 text-sm text-muted hover:text-ink">
          <Avatar addr={c.creator} />
          <span className="num truncate">{shortAddr(c.creator)}</span>
        </Link>
        <div className="flex shrink-0 items-center gap-1.5">
          <StateBadge touched={c.touched} settled={c.settled} yesWon={c.yesWon} />
        </div>
      </div>

      <Link href={`/t/?id=${c.id}`} className="mt-4 block" data-testid="card-link">
        <div className="flex items-center gap-2">
          <SidePill p={pos} />
          <span className="num whitespace-nowrap text-sm text-ink">{pairOf(feed)}</span>
        </div>
        <div className="mt-3">
          <PositionLevels p={pos} mark={mark} dense third={{ k: "Deadline", v: now ? when(c.end).replace(/^\w+, /, "") : "…", sub: live && now ? `${timeLeft(c.end, now)} left` : undefined }} />
        </div>
        {c.text && <p className="mt-3 line-clamp-2 text-sm text-muted">{c.text}</p>}
      </Link>

      <div className="mt-4 flex items-end justify-between gap-3 rounded-xl bg-panel-2 px-3 py-2.5">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="num text-[26px] leading-none text-ink">{pct(yes, 1)}</span>
            <Delta now={yes} open={c.openBps} />
          </div>
          <div className="mt-1 text-[11px] text-faint">crowd odds the target is hit in time</div>
        </div>
        <Sparkline values={spark} />
      </div>

      <div className="num mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-faint">
        <span>
          vol 24h <span className="text-muted">{qusdc(volumeSince(trades, now - 86_400), 0)} QUSDC</span>
        </span>
        <span className="flex items-center gap-1">
          <Clock size={11} />
          {!now ? "…" : live ? `${timeLeft(c.end, now)} left` : c.end > now ? "trading closed" : "ended"}
        </span>
      </div>

      {live && (
        <div className="mt-3">
          {open ? (
            <TradeBox compact id={c.id} initialSide={open} onDone={() => setOpen(null)} />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setOpen("yes")} className="btn btn-yes text-sm" data-testid="card-back">
                Back
              </button>
              <button onClick={() => setOpen("no")} className="btn btn-ghost text-sm" data-testid="card-challenge">
                Challenge
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
