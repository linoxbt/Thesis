"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Address } from "viem";
import { useData, useNow } from "@/lib/data";
import { fmtSkill, pct, qusdc, shortAddr } from "@/lib/format";

interface Row {
  creator: Address;
  scored: number;
  hits: number;
  skillBps: number;
  avgOpenBps: number | null;
  volume: bigint;
}

/**
 * Creators ranked by skill: each settled call scores (1 if hit, else 0) minus
 * the odds the contract gave it when posted. All-time comes straight from the
 * contract's stats; This week from calls that ended in the last 7 days.
 */
export default function Leaderboard() {
  const { ready, calls, creators } = useData();
  const now = useNow(60_000);
  const [period, setPeriod] = useState<"week" | "all">("all");

  const rows = useMemo<Row[]>(() => {
    const since = period === "week" ? now - 7 * 86_400 : 0;
    const by = new Map<Address, Row>();
    for (const c of calls) {
      if (!c.settled || c.end < since) continue;
      const r = by.get(c.creator) ?? { creator: c.creator, scored: 0, hits: 0, skillBps: 0, avgOpenBps: 0, volume: 0n };
      r.avgOpenBps = ((r.avgOpenBps ?? 0) * r.scored + c.openBps) / (r.scored + 1);
      r.scored += 1;
      r.hits += c.yesWon ? 1 : 0;
      r.skillBps += (c.yesWon ? 10_000 : 0) - c.openBps;
      r.volume += c.volume;
      by.set(c.creator, r);
    }
    if (period === "all") {
      // The contract's own running totals are authoritative for all-time.
      for (const { creator, stats } of creators) {
        const r = by.get(creator);
        if (r) r.skillBps = stats.skillBps;
      }
    }
    return [...by.values()].sort((a, b) => b.skillBps - a.skillBps || b.scored - a.scored);
  }, [calls, creators, period, now]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="label">Proof of skill</span>
          <h1 className="display mt-2 text-4xl">Leaderboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Every call is scored against the odds the contract gave it when it was posted: a 20% call that hits earns
            <span className="num text-yes"> +0.80</span>, a 90% call that misses costs <span className="num text-bad">−0.90</span>. Safe calls earn
            almost nothing; only real edge climbs. Scores are stored onchain.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-full border border-line bg-bg p-1 text-sm">
          {(["week", "all"] as const).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={"rounded-full px-4 py-1.5 " + (period === p ? "bg-ink text-bg" : "text-muted hover:text-ink")}>
              {p === "week" ? "This week" : "All time"}
            </button>
          ))}
        </div>
      </div>
      <section className="panel overflow-x-auto p-0" data-testid="leaderboard">
        {!ready ? (
          <p className="p-6 text-sm text-muted">Reading from QIE…</p>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-muted">
            No settled calls {period === "week" ? "this week" : "yet"}. Calls are scored when they settle.{" "}
            <Link href="/new/" className="text-ink underline decoration-brand underline-offset-4">
              Post one
            </Link>
            .
          </div>
        ) : (
          <table className="num w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-3 font-normal">#</th>
                <th className="py-3 font-normal">Caller</th>
                <th className="py-3 text-right font-normal">Skill</th>
                <th className="py-3 text-right font-normal">Per call</th>
                <th className="py-3 text-right font-normal">Hits</th>
                <th className="py-3 text-right font-normal">Avg odds</th>
                <th className="px-5 py-3 text-right font-normal">Volume</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.creator} className="border-b border-line last:border-0" data-testid="leaderboard-row">
                  <td className="px-5 py-3 text-muted">{i + 1}</td>
                  <td className="py-3">
                    <Link href={`/profile/?a=${r.creator}`} className="text-ink hover:underline">
                      {shortAddr(r.creator)}
                    </Link>
                  </td>
                  <td className={"py-3 text-right text-base " + (r.skillBps >= 0 ? "text-yes" : "text-bad")}>{fmtSkill(r.skillBps)}</td>
                  <td className="py-3 text-right text-muted">{fmtSkill(Math.round(r.skillBps / Math.max(1, r.scored)))}</td>
                  <td className="py-3 text-right">
                    {r.hits}/{r.scored}
                  </td>
                  <td className="py-3 text-right text-muted">{r.avgOpenBps !== null ? pct(r.avgOpenBps, 0) : "—"}</td>
                  <td className="px-5 py-3 text-right text-muted">{qusdc(r.volume, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
