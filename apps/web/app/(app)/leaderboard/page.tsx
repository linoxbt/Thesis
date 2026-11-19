"use client";

import Link from "next/link";
import { useState } from "react";
import { LoadState, StaleNote } from "@/components/LoadState";
import { Avatar } from "@/components/ThesisCard";
import { usePoll } from "@/lib/client/api";
import { fmtSkill, pct, shortAddr } from "@/lib/client/format";

interface Row {
  creator: string;
  display_name: string | null;
  x_handle: string | null;
  calls: number;
  hits: number;
  score_bps: number;
  avg_open_bps: number | null;
  excluded: number;
}

/**
 * Creators ranked by skill: hits beyond what the market expected when each
 * call was posted. The odds were computed onchain at posting, so nobody can
 * pad the record with safe calls.
 */
export default function LeaderboardPage() {
  const [period, setPeriod] = useState<"week" | "all">("week");
  const { data, error, status } = usePoll<{ rows: Row[]; indexer?: boolean }>(`/api/leaderboard?period=${period}`, 30_000);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="label">Proof of skill</span>
          <h1 className="display mt-2 text-4xl">Leaderboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Every call is scored against the odds the market gave it when it was posted: a 20% call that hits earns
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

      {!data ? (
        <LoadState error={error} status={status} what="leaderboard" />
      ) : (
        <section className="panel overflow-x-auto p-0" data-testid="leaderboard">
          {error && (
            <div className="p-3">
              <StaleNote error={error} />
            </div>
          )}
          {data.rows.length === 0 ? (
            <div className="p-6 text-sm text-muted">
              <p>No settled calls {period === "week" ? "this week" : "yet"}. Calls are scored when they settle.</p>
              <Link href="/new" className="btn btn-primary mt-4 inline-flex text-sm">
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
                {data.rows.map((r, i) => (
                  <tr key={r.creator} className="border-b border-line last:border-0" data-testid="leaderboard-row">
                    <td className="px-5 py-3 text-muted">{i + 1}</td>
                    <td className="py-3">
                      <Link href={`/u/${r.creator}`} className="flex items-center gap-2 hover:text-ink">
                        <Avatar addr={r.creator} size={26} />
                        <span className="font-sans">
                          <span className="text-ink">{r.display_name ?? shortAddr(r.creator)}</span>
                          {r.x_handle && <span className="ml-1.5 text-xs text-faint">@{r.x_handle}</span>}
                        </span>
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
        Calls opened while Pyth&apos;s latest price was already past the target don&apos;t count (they could be posted
        knowing they had won). Team wallets are left out. Raw numbers: <Link href="/stats" className="underline">Stats</Link>.
      </p>
    </div>
  );
}
