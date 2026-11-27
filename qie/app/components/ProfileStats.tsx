"use client";

import Link from "next/link";
import type { Address } from "viem";
import { useData } from "@/lib/data";
import { callLine, fmtSkill, pct } from "@/lib/format";
import { amtSym, NATIVE, perToken } from "@/lib/tokens";

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-panel px-5 py-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-1 text-xl text-ink">{value}</div>
      {sub && <div className="text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

/**
 * Skill rank (all time, onchain), the leaderboard's way: by skill per scored
 * call among creators with at least 3 scored calls. Null if not ranked.
 */
export function useSkillRank(who: Address | null): number | null {
  const { creators } = useData();
  if (!who) return null;
  const per = (s: { skillBps: number; scored: number }) => s.skillBps / s.scored;
  const ranked = creators.filter((c) => c.stats.scored >= 3).sort((a, b) => per(b.stats) - per(a.stats) || b.stats.skillBps - a.stats.skillBps);
  const i = ranked.findIndex((c) => c.creator.toLowerCase() === who.toLowerCase());
  return i < 0 ? null : i + 1;
}

/**
 * Skill score, raw numbers and call history for one wallet, all from the
 * contract and its events. Each call shows its opening odds beside its
 * outcome, so a hit on a 90% call doesn't read like a hit on a 20% call.
 */
export function ProfileStats({ who }: { who: Address }) {
  const { calls, creators, feedOf, tokenOf, stakeTokens, events, creatorShareBps, ready } = useData();
  const me = who.toLowerCase();
  const s = creators.find((x) => x.creator.toLowerCase() === me)?.stats;
  const rank = useSkillRank(who);
  const mine = calls.filter((c) => c.creator.toLowerCase() === me);
  const ids = new Set(mine.map((c) => c.id));
  const scored = s?.scored ?? 0;
  const avgOpen = mine.length ? Math.round(mine.reduce((a, c) => a + c.openBps, 0) / mine.length) : null;
  // Amounts are kept per stake token (a call is in QIE or in QUSDC, never both).
  const tokenOfCall = new Map(calls.map((c) => [c.id, c.token]));
  const tk = (id: number) => tokenOfCall.get(id) ?? NATIVE;
  const volume = perToken(mine.map((c) => ({ token: c.token, value: c.volume })), stakeTokens);
  const feesEarned = perToken(events.trades.filter((t) => ids.has(t.id)).map((t) => ({ token: tk(t.id), value: (t.fee * BigInt(creatorShareBps)) / 10_000n })), stakeTokens, 2);
  const won = perToken(events.claims.filter((c) => c.user.toLowerCase() === me).map((c) => ({ token: tk(c.id), value: c.amount })), stakeTokens, 2);
  const staked = perToken(events.trades.filter((t) => t.user.toLowerCase() === me).map((t) => ({ token: tk(t.id), value: t.amount })), stakeTokens);
  const skillOf = new Map(events.settlements.map((x) => [x.id, x.skillDeltaBps]));
  const history = [...mine].reverse();
  return (
    <>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-4" data-testid="profile-stats">
        <Tile
          label="Skill score"
          value={scored > 0 ? fmtSkill(s!.skillBps) : "—"}
          sub={scored > 0 ? `${rank ? `#${rank} · ` : ""}${scored} scored call${scored === 1 ? "" : "s"}` : "scored once a traded call settles"}
        />
        <Tile label="Calls posted" value={String(s?.posted ?? 0)} />
        <Tile label="Hit / missed" value={`${s?.hits ?? 0} / ${s?.misses ?? 0}`} sub={avgOpen !== null ? `avg opening odds ${pct(avgOpen, 0)}` : undefined} />
        <Tile label="Volume generated" value={volume} sub="bet on their calls" />
        <Tile label="Fees earned" value={feesEarned} sub={`${pct(creatorShareBps, 0)} of every fee on their calls`} />
        <Tile label="Staked" value={staked} sub="backed or challenged" />
        <Tile label="Winnings claimed" value={won} />
      </div>
      <section className="panel p-5">
        <span className="label">History</span>
        <h2 className="display mb-3 mt-2 text-xl">Call history</h2>
        {!ready ? (
          <p className="text-sm text-muted">Reading from QIE…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted">No calls yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm" data-testid="call-history">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1 font-normal">Call</th>
                  <th className="font-normal">Opened at</th>
                  <th className="font-normal">Outcome</th>
                  <th className="font-normal">Skill</th>
                  <th className="text-right font-normal">Volume</th>
                </tr>
              </thead>
              <tbody className="num">
                {history.map((c) => {
                  const f = feedOf(c.feed);
                  const k = skillOf.get(c.id);
                  return (
                    <tr key={c.id} className="border-t border-line">
                      <td className="py-1.5">
                        <Link href={`/t/?id=${c.id}`} className="decoration-brand underline-offset-4 hover:underline">
                          {callLine(f?.asset ?? "…", c.above, c.strike, f?.decimals ?? 8)}
                        </Link>
                      </td>
                      <td className="text-muted">{pct(c.openBps, 0)}</td>
                      <td>{c.voided ? <span className="text-muted">void</span> : c.settled ? c.yesWon ? <span className="text-yes">hit</span> : "missed" : <span className="text-muted">open</span>}</td>
                      <td>{k === undefined ? <span className="text-faint">—</span> : <span className={k >= 0 ? "text-yes" : "text-bad"}>{fmtSkill(k)}</span>}</td>
                      <td className="text-right">{amtSym(c.volume, tokenOf(c.token), 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
