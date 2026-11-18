"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { use } from "react";
import { LineChart } from "@/components/LineChart";
import { MarketPanel, type MarketRow } from "@/components/MarketPanel";
import { Avatar, StateBadge } from "@/components/ThesisCard";
import { claimCreatorFeesInstructions, toTx } from "@/lib/client/actions";
import { usePoll } from "@/lib/client/api";
import { explorerTx } from "@/lib/client/config";
import { ago, callLine, pythToNumber, shortAddr, usd, usdc, when } from "@/lib/client/format";
import { useTx } from "@/lib/client/tx";
import { useConfig, useSpot } from "@/lib/client/useConfig";
import { useActiveWallet } from "@/lib/client/wallet";

interface Detail {
  thesis: {
    pda: string;
    creator: string;
    text: string | null;
    end_ts: string;
    outcome: number;
    volume_usdc: string;
    self_volume_usdc: string;
    fees_attributed: string;
    fees_claimed: string;
  };
  conviction: MarketRow;
  protection: MarketRow | null;
  trades: { signature: string; touch_market: string; wallet: string; side: string; usdc_amount: string; ts: string; via_thesis: boolean; is_creator: boolean }[];
  prices: { touch_market: string; ts: string; yes_price_bps: number }[];
  spot: { publish_time: string; price: string; expo: number }[];
  creator: {
    wallet: string;
    profile: { display_name: string | null; x_handle: string | null } | null;
    stats: { posted: string; hit: string; missed: string; volume_usdc: string; avg_opening_bps: number } | null;
  };
}

const SIDE: Record<string, string> = { buy_yes: "bought YES", buy_no: "bought NO", sell_yes: "sold YES", sell_no: "sold NO" };

/** Thesis page (spec 8, screen 2). */
export default function ThesisPage({ params }: { params: Promise<{ pda: string }> }) {
  const { pda } = use(params);
  const { data, error, reload } = usePoll<Detail>(`/api/theses/${pda}`, 10_000);
  const { data: spot } = useSpot();
  const { config, usdcMint } = useConfig();
  const wallet = useActiveWallet();
  const { connection } = useConnection();
  const { run } = useTx();

  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const { thesis: t, conviction: c, protection: p, creator } = data;
  const endTs = Number(t.end_ts);
  const name = creator.profile?.display_name ?? shortAddr(t.creator);
  const s = creator.stats;
  const share = config?.creatorShareBps ?? 5000;
  const claimable = (BigInt(t.fees_attributed) * BigInt(share)) / 10_000n - BigInt(t.fees_claimed);
  const isCreator = wallet?.publicKey.toBase58() === t.creator;

  const spotPts = [
    ...data.spot.map((x) => ({ t: Number(x.publish_time), v: pythToNumber(x.price, x.expo) })),
    ...(spot ? [{ t: spot.publishTime, v: pythToNumber(spot.price, spot.expo) }] : []),
  ].filter((x, i, a) => a.findIndex((y) => y.t === x.t) === i);
  const refs = [
    { v: pythToNumber(c.strike, c.expo), label: `target ${usd(pythToNumber(c.strike, c.expo))}` },
    ...(p ? [{ v: pythToNumber(p.strike, p.expo), label: `cover ${usd(pythToNumber(p.strike, p.expo))}` }] : []),
  ];
  const url = typeof window !== "undefined" ? window.location.href : "";
  const tweet = `${callLine(c.direction, c.strike, c.expo, endTs)}${t.text ? ` — ${t.text}` : ""}\nBack it or challenge it:`;

  const claimFees = async () => {
    if (!wallet || !usdcMint) return;
    try {
      await run(`Claim ${usdc(claimable)} creator fees`, wallet, async () =>
        toTx(await claimCreatorFeesInstructions(connection, { creator: wallet.publicKey, usdcMint, thesis: new PublicKey(t.pda) })),
      );
      reload();
    } catch {
      /* toast */
    }
  };

  return (
    <div className="space-y-5">
      <section className="glow relative overflow-hidden rounded-3xl border border-line px-6 py-7 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={`/u/${t.creator}`} className="flex items-center gap-2 text-sm text-muted hover:text-ink">
            <Avatar addr={t.creator} size={32} />
            <span>
              <span className="text-ink">{name}</span>
              {s && (
                <span className="num block text-[11px] text-faint">
                  {s.posted} posted · {s.hit} hit · {s.missed} missed
                </span>
              )}
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <StateBadge touched={c.touched} settled={c.settled} outcome={t.outcome} winning={c.winning_side} />
            {p && (
              <span className="num rounded-full bg-guard/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-guard ring-1 ring-guard/30">
                Protected
              </span>
            )}
          </div>
        </div>
        <span className="label mt-6">The call</span>
        <h1 className="display mt-2 text-3xl leading-tight sm:text-4xl">
          SOL {c.direction === "above" ? "rises to" : "falls to"} <span className="num tracking-normal">{usd(pythToNumber(c.strike, c.expo))}</span>{" "}
          <span className="text-muted">by {when(endTs)}</span>
        </h1>
        {t.text && <p className="mt-3 max-w-2xl text-muted">{t.text}</p>}
        <div className="num mt-5 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-line px-3 py-1.5 text-faint">
            volume <span className="text-ink">{usdc(t.volume_usdc)}</span>
          </span>
          {Number(t.self_volume_usdc) > 0 && (
            <span className="rounded-full border border-line px-3 py-1.5 text-faint">creator's own trades {usdc(t.self_volume_usdc)}</span>
          )}
          <a
            className="btn btn-ghost px-3 py-1.5 text-xs"
            href={`https://x.com/intent/post?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent(url)}`}
            target="_blank"
            rel="noreferrer"
          >
            Share on X ↗
          </a>
          {isCreator && claimable > 0n && (
            <button onClick={() => void claimFees()} className="btn btn-yes px-3 py-1.5 text-xs">
              Claim {usdc(claimable)} creator fees
            </button>
          )}
        </div>
        <div className="glow-line absolute inset-x-0 bottom-0" />
      </section>

      <MarketPanel
        kind="conviction"
        m={c}
        prices={data.prices.filter((x) => x.touch_market === c.touch_market)}
        thesis={t.pda}
        creator={t.creator}
        onChange={reload}
      />
      {p && (
        <MarketPanel
          kind="protection"
          m={p}
          prices={data.prices.filter((x) => x.touch_market === p.touch_market)}
          thesis={t.pda}
          creator={t.creator}
          onChange={reload}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="panel min-w-0 p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <span className="label">Price feed</span>
              <h2 className="display mt-2 text-xl">SOL / USD · Pyth</h2>
            </div>
            {spot && (
              <span className="num text-right text-xs text-faint">
                <span className="block text-lg text-ink">{usd(pythToNumber(spot.price, spot.expo))}</span>
                read {ago(spot.publishTime)}
              </span>
            )}
          </div>
          <LineChart label="SOL price" color="var(--color-ink)" points={spotPts} refs={refs} yFormat={(v) => usd(v)} height={170} />
        </section>

        <section className="panel min-w-0 p-5">
          <span className="label">Activity</span>
          <h2 className="display mb-3 mt-2 text-xl">Recent trades</h2>
          {data.trades.length === 0 ? (
            <p className="text-sm text-muted">No trades yet. Be the first to back or challenge it.</p>
          ) : (
            <table className="num w-full text-xs">
              <thead className="text-left text-faint">
                <tr>
                  <th className="pb-2 font-normal">Trader</th>
                  <th className="pb-2 font-normal">Side</th>
                  <th className="pb-2 text-right font-normal">Amount</th>
                  <th className="pb-2 text-right font-normal">When</th>
                </tr>
              </thead>
              <tbody>
                {data.trades.slice(0, 12).map((tr) => (
                  <tr key={tr.signature + tr.touch_market} className="border-t border-line">
                    <td className="py-2">
                      <Link href={`/u/${tr.wallet}`} className="text-muted hover:text-ink">
                        {shortAddr(tr.wallet)}
                      </Link>
                      {tr.is_creator && <span className="ml-1 text-guard">creator</span>}
                    </td>
                    <td className={tr.side.endsWith("yes") ? (tr.touch_market === p?.touch_market ? "text-guard" : "text-yes") : "text-ink"}>
                      {SIDE[tr.side] ?? tr.side}
                      {tr.touch_market === p?.touch_market ? " · cover" : ""}
                      {!tr.via_thesis ? <span className="text-faint"> · direct</span> : ""}
                    </td>
                    <td className="text-right">{usdc(tr.usdc_amount)}</td>
                    <td className="text-right">
                      <a href={explorerTx(tr.signature)} target="_blank" rel="noreferrer" className="text-faint hover:text-ink">
                        {ago(Number(tr.ts))}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
