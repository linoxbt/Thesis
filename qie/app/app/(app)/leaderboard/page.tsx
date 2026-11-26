"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Address } from "viem";
import { Avatar } from "@/components/ThesisCard";
import { Who } from "@/components/Who";
import { useData, useNow } from "@/lib/data";
import { fmtSkill, pct } from "@/lib/format";

interface Row {
  creator: Address;
  calls: number;
  hits: number;
  score_bps: number;
  avg_open_bps: number | null;
}

/**
 * Creators ranked by skill: hits beyond what the market expected when each
 * call was posted. The odds are computed by the contract at posting, so
 * nobody can pad the record with safe calls. All time is the contract's own
 * tally; this week is summed from its Settled events.
 */
export default function LeaderboardPage() {
  const [period, setPeriod] = useState<"week" | "all">("week");
  const { ready, historyReady, creators, calls, events } = useData();
  const now = useNow(60_000);

  const rows = useMemo<Row[]>(() => {
    const avgOpen = (who: string, ids?: Set<number>) => {
      const cs = calls.filter((c) => c.settled && c.creator.toLowerCase() === who.toLowerCase() && (!ids || ids.has(c.id)));
      return cs.length ? Math.round(cs.reduce((a, c) => a + c.openBps, 0) / cs.length) : null;
    };
    if (period === "all") {
      return creators
        .filter((c) => c.stats.hits + c.stats.misses > 0)
        .map((c) => ({ creator: c.creator, calls: c.stats.hits + c.stats.misses, hits: c.stats.hits, score_bps: c.stats.skillBps, avg_open_bps: avgOpen(c.creator) }))
        .sort((a, b) => b.score_bps - a.score_bps);
    }
    const since = now - 7 * 86_400;
    const by = new Map<string, Row & { ids: Set<number> }>();
    for (const s of events.settlements) {
      if (s.ts < since) continue;
      const k = s.creator.toLowerCase();
      if (!by.has(k)) by.set(k, { creator: s.creator, calls: 0, hits: 0, score_bps: 0, avg_open_bps: null, ids: new Set() });
      const r = by.get(k)!;
      r.calls++;
      if (s.yesWon) r.hits++;
      r.score_bps += s.skillDeltaBps;
      r.ids.add(s.id);
    }
    return [...by.values()].map((r) => ({ ...r, avg_open_bps: avgOpen(r.creator, r.ids) })).sort((a, b) => b.score_bps - a.score_bps);
  }, [period, creators, calls, events.settlements, now]);

  const loaded = period === "all" ? ready : historyReady;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="label">Proof of skill</span>
          <h1 className="display mt-2 text-4xl">Leaderboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Every call is scored against the odds the contract gave it when it was posted: a 20% call that hits earns
            <span className="num text-yes"> +0.80</span>, a 90% call that misses costs
            <span className="num text-bad"> −0.90</span>. Safe calls earn almost nothing; only real edge climbs.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-full border border-line bg-bg p-1 text-sm" role="tablist" aria-label="Period">
          {(["week", "all"] as const).map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={period === p}
              onClick={() => setPeriod(p)}
              className={"rounded-full px-4 py-1.5 " + (period === p ? "bg-ink text-bg" : "text-muted hover:text-ink")}
              data-testid={`leaderboard-${p}`}
            >
              {p === "week" ? "This week" : "All time"}
            </button>
          ))}
        </div>
      </div>

      {!loaded ? (
        <p className="text-sm text-muted">Reading from QIE…</p>
      ) : (
        <section className="panel overflow-x-auto p-0" data-testid="leaderboard">
          {rows.length === 0 ? (
            <div className="p-6 text-sm text-muted">
              <p>No settled calls {period === "week" ? "this week" : "yet"}. Calls are scored when they settle.</p>
              <Link href="/new/" className="btn btn-primary mt-4 inline-flex text-sm">
                Post a call
              </Link>
            </div>
          ) : (
            <table className="num w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-5 py-3 font-normal">#</th>
                  <th className="py-3 font-normal">Creator</th>
                  <th className="py-3 text-right font-normal">Skill</th>
                  <th className="py-3 text-right font-normal">Per call</th>
                  <th className="py-3 text-right font-normal">Hits</th>
                  <th className="px-5 py-3 text-right font-normal">Avg odds</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.creator} className="border-b border-line last:border-0" data-testid="leaderboard-row">
                    <td className="px-5 py-3 text-muted">{i + 1}</td>
                    <td className="py-3">
                      <Link href={`/u/?a=${r.creator}`} className="flex items-center gap-2 hover:text-ink">
                        <Avatar addr={r.creator} size={26} />
                        <Who addr={r.creator} className="text-ink" />
                      </Link>
                    </td>
                    <td className={"py-3 text-right text-base " + (r.score_bps >= 0 ? "text-yes" : "text-bad")}>{fmtSkill(r.score_bps)}</td>
                    <td className="py-3 text-right text-muted">{fmtSkill(Math.round(r.score_bps / r.calls))}</td>
                    <td className="py-3 text-right">
                      {r.hits}/{r.calls}
                    </td>
                    <td className="px-5 py-3 text-right text-muted">{r.avg_open_bps !== null ? pct(r.avg_open_bps, 0) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      <p className="text-[11px] leading-relaxed text-faint">
        A call can&apos;t open with the oracle price already past its target (the contract refuses it), so no one can post a
        call they know has won. Scores are stored onchain by the contract. Raw numbers:{" "}
        <Link href="/stats/" className="underline">
          Stats
        </Link>
        .
      </p>
    </div>
  );
}
