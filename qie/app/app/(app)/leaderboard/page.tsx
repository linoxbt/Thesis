"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { Avatar } from "@/components/ThesisCard";
import { Who } from "@/components/Who";
import { MIN_SCORED, perCallBps, rankScore } from "@/lib/rank";
import { amtSym } from "@/lib/tokens";
import { useData, useNow } from "@/lib/data";
import { fmtSkill, pct } from "@/lib/format";
import { QIE_PASS_URL } from "@/lib/wallet";

const VERIFIED_KEY = "thesis-qiepass-verified";
const VERIFIED_TTL = 3600_000;

/**
 * QIE Pass (identity) verification for creators, via our server function,
 * cached in this browser for an hour. Null while unknown or unavailable.
 */
function useVerified(addresses: string[]): Record<string, boolean> | null {
  const [map, setMap] = useState<Record<string, boolean> | null>(null);
  const key = addresses.map((a) => a.toLowerCase()).sort().join(",");
  useEffect(() => {
    if (!key) return setMap({});
    let on = true;
    let cache: Record<string, [boolean, number]> = {};
    try {
      cache = JSON.parse(localStorage.getItem(VERIFIED_KEY) ?? "{}");
    } catch {}
    const now = Date.now();
    const known: Record<string, boolean> = {};
    const todo: string[] = [];
    for (const a of key.split(",")) {
      const hit = cache[a];
      if (hit && now - hit[1] < VERIFIED_TTL) known[a] = hit[0];
      else todo.push(a);
    }
    if (!todo.length) return setMap(known);
    (async () => {
      for (let i = 0; i < todo.length; i += 10) {
        // The function takes 10 addresses per request.
        const r = await fetch(`${QIE_PASS_URL}?action=verified&addresses=${todo.slice(i, i + 10).join(",")}`);
        if (!r.ok) throw new Error(String(r.status));
        const got = (await r.json()) as Record<string, boolean>;
        for (const [a, v] of Object.entries(got)) {
          known[a.toLowerCase()] = v;
          cache[a.toLowerCase()] = [v, now];
        }
      }
      try {
        localStorage.setItem(VERIFIED_KEY, JSON.stringify(cache));
      } catch {}
      if (on) setMap({ ...known });
    })().catch(() => on && setMap(Object.keys(known).length ? known : null));
    return () => {
      on = false;
    };
  }, [key]);
  return map;
}

interface Row {
  creator: Address;
  /** Scored calls: settled calls seeded at least the scoring size (decided at posting). */
  calls: number;
  hits: number;
  score_bps: number;
  avg_open_bps: number | null;
}

/** Scored calls a creator needs (in the period) to be ranked; fewer are listed after. */
const MIN_CALLS = MIN_SCORED;
const perCall = (r: Row) => perCallBps(r.score_bps, r.calls);
/** Ranked by skill per call shrunk toward zero for short records (lib/rank.ts), then by total. */
const byRank = (a: Row, b: Row) => {
  const qa = a.calls >= MIN_CALLS, qb = b.calls >= MIN_CALLS;
  if (qa !== qb) return qa ? -1 : 1;
  return rankScore(b.score_bps, b.calls) - rankScore(a.score_bps, a.calls) || b.score_bps - a.score_bps;
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
  const { ready, historyReady, historyError, creators, calls, events, stakeTokens } = useData();
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

  const verified = useVerified(rows.map((r) => r.creator));
  const ranked = rows.filter((r) => r.calls >= MIN_CALLS);
  const verifiedRanked = verified ? ranked.filter((r) => verified[r.creator.toLowerCase()]) : [];
  // Throwaway wallets can't be identity-verified: once there are enough
  // verified creators, the board shows them by default.
  const [only, setOnly] = useState<boolean | null>(null);
  const verifiedOnly = only ?? verifiedRanked.length >= 3;
  const shown = verifiedOnly && verified ? rows.filter((r) => verified[r.creator.toLowerCase()]) : rows;
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
            call once a creator has {MIN_CALLS} scored calls, weighted toward zero for short records so a few lucky long shots
            can&apos;t top the board. A call counts if its creator seeded at least{" "}
            {stakeTokens.length ? stakeTokens.map((t) => amtSym(t.minScoredSeed, t, 0)).join(" or ") : "the scoring size"}, decided when it&apos;s posted.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {verified && (
          <button
            onClick={() => setOnly(!verifiedOnly)}
            aria-pressed={verifiedOnly}
            className={"inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm " + (verifiedOnly ? "border-yes/40 bg-yes/10 text-yes" : "border-line text-muted hover:text-ink")}
            data-testid="leaderboard-verified"
          >
            <ShieldCheck size={14} /> Verified only
          </button>
        )}
        <div className="grid grid-cols-2 gap-1 rounded-full border border-line bg-bg p-1 text-sm" role="group" aria-label="Period">
          {(["week", "all"] as const).map((p) => (
            <button
              key={p}
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
              className={"rounded-full px-4 py-1.5 " + (period === p ? "bg-ink text-bg" : "text-muted hover:text-ink")}
              data-testid={`leaderboard-${p}`}
            >
              {p === "week" ? "This week" : "All time"}
            </button>
          ))}
        </div>
        </div>
      </div>

      {!loaded ? (
        <p className="text-sm text-muted">{historyError ?? "Reading from QIE…"}</p>
      ) : (
        <section className="panel overflow-x-auto p-0" data-testid="leaderboard">
          {shown.length === 0 ? (
            <div className="p-6 text-sm text-muted">
              <p>
                {verifiedOnly && rows.length > 0
                  ? "No QIE Pass verified creators here yet."
                  : `No settled calls ${period === "week" ? "this week" : "yet"}. Calls are scored when they settle.`}
              </p>
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
                  <th className="py-3 text-right font-normal" title="What the board is ranked by: skill ÷ (scored calls + 10)">Score</th>
                  <th className="py-3 text-right font-normal">Skill</th>
                  <th className="py-3 text-right font-normal">Hits</th>
                  <th className="px-5 py-3 text-right font-normal">Avg odds</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.creator} className={"border-b border-line last:border-0" + (r.calls < MIN_CALLS ? " opacity-60" : "")} data-testid="leaderboard-row">
                    <td className="px-5 py-3 text-muted">{r.calls >= MIN_CALLS ? i + 1 : "–"}</td>
                    <td className="py-3">
                      <Link href={`/u/?a=${r.creator}`} className="flex items-center gap-2 hover:text-ink">
                        <Avatar addr={r.creator} size={26} />
                        <Who addr={r.creator} className="text-ink" />
                        {verified?.[r.creator.toLowerCase()] && <ShieldCheck size={13} className="text-yes" aria-label="QIE Pass verified" />}
                      </Link>
                    </td>
                    <td className={"py-3 text-right text-base " + (r.score_bps >= 0 ? "text-yes" : "text-bad")}>
                      {fmtSkill(Math.round(rankScore(r.score_bps, r.calls)))}
                      <span className="block text-[11px] text-faint">{fmtSkill(Math.round(perCall(r)))} per call</span>
                    </td>
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
        price, the further away the target must be), and a call that touches in the first oracle round after it's posted is voided. Scores are stored
        onchain by the contract. Rows marked – have fewer than {MIN_CALLS} scored calls. The shield marks creators whose identity is
        verified with QIE Pass: throwaway wallets can&apos;t be, so &quot;Verified only&quot; can&apos;t be gamed with them. Raw numbers:{" "}
        <Link href="/stats/" className="underline">
          Stats
        </Link>
        .
      </p>
    </div>
  );
}
