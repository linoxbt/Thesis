"use client";

import Link from "next/link";
import type { Call, Feed } from "@/lib/chain";
import { impliedYesBps, statusOf } from "@/lib/data";
import { callLine, pct, qusdc, shortAddr, timeLeft, when } from "@/lib/format";

export function StatusPill({ label, tone }: { label: string; tone: "open" | "yes" | "no" | "wait" }) {
  const cls =
    tone === "open"
      ? "bg-brand/10 text-brand ring-brand/30"
      : tone === "yes"
        ? "bg-yes/10 text-yes ring-yes/30"
        : tone === "no"
          ? "bg-panel-3 text-muted ring-line-2"
          : "bg-panel-3 text-ink ring-line-2";
  return <span className={"num rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ring-1 " + cls}>{label}</span>;
}

/** One call in the feed: the claim, the crowd's odds, the pot, the clock. */
export function CallCard({ c, feed, now, grace }: { c: Call; feed?: Feed; now: number; grace: number }) {
  const yes = impliedYesBps(c);
  const s = statusOf(c, now, grace);
  const asset = feed?.asset ?? "?";
  const move = feed ? ((Number(c.strike) - Number(c.spotAtOpen)) / Number(c.spotAtOpen)) * 100 : 0;
  return (
    <Link href={`/call/?id=${c.id}`} className="panel glow block p-5 transition-colors hover:border-line-2" data-testid="call-card">
      <div className="flex items-center justify-between gap-2">
        <span className={"num rounded-full px-2 py-0.5 text-[11px] font-medium " + (c.above ? "bg-yes/10 text-yes" : "bg-bad/10 text-bad")}>
          {c.above ? "Long" : "Short"} {asset}
        </span>
        <StatusPill {...s} />
      </div>
      <div className="display mt-3 text-xl">{callLine(asset, c.above, c.strike, feed?.decimals)}</div>
      <div className="num mt-1 text-xs text-muted">
        {move >= 0 ? "+" : ""}
        {move.toFixed(1)}% from {when(c.start)} · by {when(c.end)}
      </div>
      {c.text && <p className="mt-3 line-clamp-2 text-sm text-muted">“{c.text}”</p>}
      <div className="mt-4">
        <div className="flex h-1.5 overflow-hidden rounded-full bg-panel-3" aria-hidden>
          <div className="bg-yes" style={{ width: `${yes / 100}%` }} />
        </div>
        <div className="num mt-1.5 flex justify-between text-[11px] text-muted">
          <span>YES {pct(yes, 0)} · opened {pct(c.openBps, 0)}</span>
          <span>{qusdc(c.yesPool + c.noPool, 0)} QUSDC pot</span>
        </div>
      </div>
      <div className="num mt-3 flex justify-between text-[11px] text-faint">
        <span>by {shortAddr(c.creator)}</span>
        <span>{s.tone === "open" ? `${timeLeft(c.end, now)} left` : ""}</span>
      </div>
    </Link>
  );
}
