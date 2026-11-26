"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { Abi } from "viem";
import { LineChart } from "@/components/LineChart";
import { LoadState } from "@/components/LoadState";
import { MarketPanel } from "@/components/MarketPanel";
import { PositionLevels, SidePill, usdPx } from "@/components/Position";
import { ShareButton } from "@/components/ShareButton";
import { Avatar, pairOf, positionOfCall, StateBadge } from "@/components/ThesisCard";
import { THESIS_CALLS_ABI } from "@/lib/abi";
import { publicClient, readRounds } from "@/lib/chain";
import { CALLS_ADDRESS, explorerAddress, explorerTx } from "@/lib/config";
import { impliedYesBps, useData, useNow } from "@/lib/data";
import { ago, fmtSkill, pct, price, qusdc, timeLeft, when } from "@/lib/format";
import { explain, useWallet } from "@/lib/wallet";
import { useSkillRank } from "@/components/ProfileStats";
import { Who } from "@/components/Who";

export default function TradePage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Reading from QIE…</p>}>
      <TradeView />
    </Suspense>
  );
}

/** One call: the position behind it, its market, the oracle and the activity. */
function TradeView() {
  const id = Number(useSearchParams().get("id") ?? "-1");
  const { ready, calls, creators, feedOf, tradesOf, events, refresh } = useData();
  const w = useWallet();
  const now = useNow(1000);
  const c = calls.find((x) => x.id === id);
  const feed = c ? feedOf(c.feed) : undefined;
  const [rounds, setRounds] = useState<{ t: number; price: bigint }[]>([]);
  const [owed, setOwed] = useState(0n);
  const [err, setErr] = useState<string | null>(null);
  const rank = useSkillRank(c?.creator ?? null);

  // The oracle's recent rounds, from a little before the call opened.
  useEffect(() => {
    if (!c || !feed) return;
    let live = true;
    readRounds(c.feed, feed.roundId, 80)
      .then((r) => live && setRounds(r.filter((x) => x.t >= c.start - 6 * 3600)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [c?.id, c?.feed, c?.start, feed?.roundId]); // eslint-disable-line react-hooks/exhaustive-deps

  const isCreator = !!c && !!w.account && w.account.toLowerCase() === c.creator.toLowerCase();
  useEffect(() => {
    if (!isCreator || !w.account) return setOwed(0n);
    publicClient
      .readContract({ address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI, functionName: "creatorFeesOwed", args: [w.account] })
      .then(setOwed)
      .catch(() => {});
  }, [isCreator, w.account, c?.volume]);

  if (!c) return <LoadState ready={ready} what="call" />;
  const dec = feed?.decimals ?? 8;
  const asset = feed?.asset ?? "…";
  const pos = positionOfCall(c, feed);
  const mark = feed ? price(feed.price, dec) : null;
  const s = creators.find((x) => x.creator.toLowerCase() === c.creator.toLowerCase())?.stats;
  const scored = (s?.hits ?? 0) + (s?.misses ?? 0);
  const trades = tradesOf(c.id);
  const ownVolume = trades.filter((t) => t.user.toLowerCase() === c.creator.toLowerCase()).reduce((a, t) => a + t.amount, 0n);
  const live = !c.settled && now > 0 && c.end > now;
  const touch = events.touches.find((t) => t.id === c.id);

  const spotPts = [
    ...rounds.map((r) => ({ t: r.t, v: price(r.price, dec) })),
    ...(feed && !rounds.some((r) => r.t === feed.updatedAt) ? [{ t: feed.updatedAt, v: price(feed.price, dec) }] : []),
  ];
  const refs = [
    { v: pos.tp, label: `take profit ${usdPx(pos.tp)}` },
    { v: pos.entry, label: `entry ${usdPx(pos.entry)}` },
  ];

  const claimFees = () =>
    w
      .write(`Claim ${qusdc(owed)} QUSDC creator fees`, { address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI as Abi, functionName: "claimCreatorFees" })
      .then(() => (setOwed(0n), refresh()))
      .catch((e) => setErr(explain(e)));

  const shareText = `${pos.side === "long" ? "Long" : "Short"} ${asset}: take profit ${usdPx(pos.tp)} by ${when(c.end)}. The crowd says ${pct(impliedYesBps(c), 0)}.${c.text ? ` ${c.text}` : ""}\nBack it or challenge it on QIE:`;

  return (
    <div className="space-y-5">
      <section className="glow relative overflow-hidden rounded-3xl border border-line px-6 py-7 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={`/u/?a=${c.creator}`} className="flex items-center gap-2 text-sm text-muted hover:text-ink">
            <Avatar addr={c.creator} size={32} />
            <span>
              <Who addr={c.creator} className="text-ink" />
              {s && (
                <span className="num block text-[11px] text-faint">
                  {s.posted} posted · {s.hits} hit · {s.misses} missed
                  {scored > 0 && (
                    <span className={s.skillBps >= 0 ? "text-yes" : "text-bad"} data-testid="creator-skill">
                      {" "}· skill {fmtSkill(s.skillBps)}
                      {rank ? ` (#${rank})` : ""}
                    </span>
                  )}
                </span>
              )}
            </span>
          </Link>
          <StateBadge touched={c.touched} settled={c.settled} yesWon={c.yesWon} />
        </div>
        <span className="label mt-6">The trade</span>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <SidePill p={pos} size="lg" />
          <h1 className="display text-3xl leading-tight sm:text-4xl" data-testid="call-title">
            {pairOf(feed)}
          </h1>
          <span className="num text-sm text-faint">until {now ? when(c.end) : "…"}</span>
        </div>
        <div className="mt-5 max-w-2xl">
          <PositionLevels
            p={pos}
            mark={mark}
            third={{ k: "Deadline", v: now ? when(c.end).replace(/^\w+, /, "") : "…", sub: live ? `${timeLeft(c.end, now)} left` : c.settled ? "settled" : "window closed" }}
          />
        </div>
        {c.text && <p className="mt-4 max-w-2xl text-muted">{c.text}</p>}
        <div className="num mt-5 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-line px-3 py-1.5 text-faint">
            volume <span className="text-ink">{qusdc(c.volume)} QUSDC</span>
          </span>
          <span className="rounded-full border border-line px-3 py-1.5 text-faint">
            opened at <span className="text-ink">{pct(c.openBps, 1)}</span>
          </span>
          {ownVolume > 0n && <span className="rounded-full border border-line px-3 py-1.5 text-faint">creator&apos;s own bets {qusdc(ownVolume)}</span>}
          <ShareButton id={c.id} text={shareText} />
          {isCreator && owed > 0n && (
            <button onClick={() => void claimFees()} className="btn btn-primary px-3 py-1.5 text-xs" data-testid="claim-fees">
              Claim {qusdc(owed)} QUSDC creator fees
            </button>
          )}
        </div>
        {err && <p className="mt-2 text-xs text-bad">{err}</p>}
        <div className="glow-line absolute inset-x-0 bottom-0" />
      </section>

      <MarketPanel c={c} feed={feed} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="panel min-w-0 p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <span className="label">Price feed</span>
              <h2 className="display mt-2 text-xl">{pairOf(feed)} · QIE Oracle</h2>
            </div>
            {feed && (
              <span className="num text-right text-xs text-faint">
                <span className="block text-lg text-ink">{usdPx(price(feed.price, dec))}</span>
                round {feed.roundId.toString().slice(-6)} · {ago(feed.updatedAt)}
              </span>
            )}
          </div>
          <LineChart
            label={`${asset} price`}
            color="var(--color-ink)"
            points={spotPts}
            refs={refs}
            yFormat={(v) => usdPx(v)}
            marker={touch ? { t: touch.updatedAt, label: "touched" } : undefined}
            height={170}
          />
          <p className="mt-3 text-[11px] text-faint">
            Settles from the{" "}
            <a href={explorerAddress(c.feed)} target="_blank" rel="noreferrer" className="underline hover:text-ink">
              {asset} / USDT QIE Oracle feed
            </a>
            : every round published inside the window counts.
          </p>
        </section>

        <section className="panel min-w-0 p-5">
          <span className="label">Activity</span>
          <h2 className="display mb-3 mt-2 text-xl">Recent trades</h2>
          {trades.length === 0 ? (
            <p className="text-sm text-muted">No trades yet. Be the first to back or challenge it.</p>
          ) : (
            <table className="num w-full text-xs" data-testid="activity">
              <thead className="text-left text-faint">
                <tr>
                  <th className="pb-2 font-normal">Trader</th>
                  <th className="pb-2 font-normal">Side</th>
                  <th className="pb-2 text-right font-normal">Amount</th>
                  <th className="pb-2 text-right font-normal">When</th>
                </tr>
              </thead>
              <tbody>
                {[...trades].reverse().slice(0, 12).map((tr) => (
                  <tr key={tr.tx + tr.user} className="border-t border-line">
                    <td className="py-2">
                      <Link href={`/u/?a=${tr.user}`} className="text-muted hover:text-ink">
                        <Who addr={tr.user} />
                      </Link>
                      {tr.user.toLowerCase() === c.creator.toLowerCase() && <span className="ml-1 text-guard">creator</span>}
                    </td>
                    <td className={tr.yes ? "text-yes" : "text-ink"}>{tr.yes ? "backed · YES" : "challenged · NO"}</td>
                    <td className="text-right">{qusdc(tr.amount)}</td>
                    <td className="text-right">
                      <a href={explorerTx(tr.tx)} target="_blank" rel="noreferrer" className="text-faint hover:text-ink">
                        {now ? ago(tr.ts, now) : "…"}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {events.createdTx[c.id] && (
            <a href={explorerTx(events.createdTx[c.id])} target="_blank" rel="noreferrer" className="mt-3 inline-block text-[11px] text-faint underline hover:text-ink">
              Posted onchain ↗
            </a>
          )}
        </section>
      </div>
    </div>
  );
}
