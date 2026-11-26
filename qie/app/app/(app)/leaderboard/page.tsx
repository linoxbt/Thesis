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
  /** Scored calls: settled with enough outside volume to count. */
  calls: number;
  hits: number;
  score_bps: number;
  avg_open_bps: number | null;
}

/** Calls a creator needs (in the period) to be ranked; fewer are listed after. */
const MIN_CALLS = 3;
const perCall = (r: Row) => (r.calls ? r.score_bps / r.calls : 0);
/** Ranked by skill per call (so one lucky call can't top the board), then by total. */
const byRank = (a: Row, b: Row) => {
  const qa = a.calls >= MIN_CALLS, qb = b.calls >= MIN_CALLS;
  if (qa !== qb) return qa ? -1 : 1;
  return perCall(b) - perCall(a) || b.score_bps - a.score_bps;
};

/**
 * Creators ranked by skill: hits beyond what the market expected when each
 * call was posted. The odds are computed by the contract at posting, so
 * nobody can pad the record with safe calls, and only calls others actually
 * traded count. All time is the contract's own tally; this week is summed
 * from its Settled events.
 */
export default function LeaderboardPage() {
  const [period, setPeriod] = useState<"week" | "all">("week");
  const { ready, historyReady, creators, calls, events, params } = useData();
  const now = useNow(60_000);

  const rows = useMemo<Row[]>(() => {
    const scoredIds = new Set(events.settlements.filter((s) => s.scored).map((s) => s.id));
    const avgOpen = (who: string, ids?: Set<number>) => {
      const cs = calls.filter((c) => c.settled && scoredIds.has(c.id) && c.creator.toLowerCase() === who.toLowerCase() && (!ids || ids.has(c.id)));
      return cs.length ? Math.round(cs.reduce((a, c) => a + c.openBps, 0) / cs.length) : null;
    };
    if (period === "all") {
      return creators
        .filter((c) => c.stats.scored > 0)
        .map((c) => {
          const hits = events.settlements.filter((s) => s.scored && s.yesWon && s.creator.toLowerCase() === c.creator.toLowerCase()).length;
          return { creator: c.creator, calls: c.stats.scored, hits, score_bps: c.stats.skillBps, avg_open_bps: avgOpen(c.creator) };
        })
        .sort(byRank);
    }
    const since = now - 7 * 86_400;
    const by = new Map<string, Row & { ids: Set<number> }>();
    for (const s of events.settlements) {
      if (s.ts < since || !s.scored) continue;
      const k = s.creator.toLowerCase();
      if (!by.has(k)) by.set(k, { creator: s.creator, calls: 0, hits: 0, score_bps: 0, avg_open_bps: null, ids: new Set() });
      const r = by.get(k)!;
      r.calls++;
      if (s.yesWon) r.hits++;
      r.score_bps += s.skillDeltaBps;
      r.ids.add(s.id);
    }
    return [...by.values()].map((r) => ({ ...r, avg_open_bps: avgOpen(r.creator, r.ids) })).sort(byRank);
  }, [period, creators, calls, events.settlements, now]);

  const loaded = ready && historyReady;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="label">Proof of skill</span>
          <h1 className="display mt-2 text-4xl">Leaderboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Every call is scored against the odds the contract gave it when it was posted: a 20% call that hits earns
            <span className="num text-yes"> +0.80</span>, a 90% call that misses costs
            <span className="num text-bad"> −0.90</span>. Safe calls earn almost nothing; only real edge climbs. Ranked by skill per
            call once a creator has {MIN_CALLS} scored calls; a call is scored once others have bet{" "}
            {params ? (Number(params.minScoredVolume) / 1e6).toFixed(0) : "5"} QUSDC on it.
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
                  <th className="py-3 text-right font-normal">Per call</th>
                  <th className="py-3 text-right font-normal">Skill</th>
                  <th className="py-3 text-right font-normal">Hits</th>
                  <th className="px-5 py-3 text-right font-normal">Avg odds</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.creator} className={"border-b border-line last:border-0" + (r.calls < MIN_CALLS ? " opacity-60" : "")} data-testid="leaderboard-row">
                    <td className="px-5 py-3 text-muted">{r.calls >= MIN_CALLS ? i + 1 : "–"}</td>
                    <td className="py-3">
                      <Link href={`/u/?a=${r.creator}`} className="flex items-center gap-2 hover:text-ink">
                        <Avatar addr={r.creator} size={26} />
                        <Who addr={r.creator} className="text-ink" />
                      </Link>
                    </td>
                    <td className={"py-3 text-right text-base " + (r.score_bps >= 0 ? "text-yes" : "text-bad")}>{fmtSkill(Math.round(perCall(r)))}</td>
                    <td className="py-3 text-right text-muted">{fmtSkill(r.score_bps)}</td>
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
        A call can&apos;t open with its target inside the move the oracle may not have printed yet (the older the latest oracle
        price, the further away the target must be), and a call touched within a minute of posting is voided. Scores are stored
        onchain by the contract. Rows marked – have fewer than {MIN_CALLS} scored calls. Raw numbers:{" "}
        <Link href="/stats/" className="underline">
          Stats
        </Link>
        .
      </p>
    </div>
  );
}
