"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { use } from "react";
import { LineChart } from "@/components/LineChart";
import { MarketPanel, type MarketRow } from "@/components/MarketPanel";
import { StateBadge } from "@/components/ThesisCard";
import { claimCreatorFeesInstructions, toTx } from "@/lib/client/actions";
import { usePoll } from "@/lib/client/api";
import { explorerTx } from "@/lib/client/config";
import { ago, callLine, pythToNumber, shortAddr, usd, usdc } from "@/lib/client/format";
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
    <div className="space-y-4">
      <section className="rounded-xl bg-panel p-4 ring-1 ring-line">
        <div className="flex items-center justify-between text-xs text-muted">
          <Link href={`/u/${t.creator}`} className="hover:text-ink">
            {name}
            {s && (
              <span className="num">
                {" "}
                · {s.posted} posted · {s.hit} hit · {s.missed} missed
              </span>
            )}
          </Link>
          <StateBadge touched={c.touched} settled={c.settled} outcome={t.outcome} winning={c.winning_side} />
        </div>
        <h1 className="num mt-2 text-xl font-bold">{callLine(c.direction, c.strike, c.expo, endTs)}</h1>
        {t.text && <p className="mt-1 text-muted">{t.text}</p>}
        <div className="num mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>
            volume <span className="text-ink">{usdc(t.volume_usdc)}</span>
          </span>
          {Number(t.self_volume_usdc) > 0 && <span>creator's own trades {usdc(t.self_volume_usdc)}</span>}
          <a
            className="rounded bg-panel-2 px-2 py-1 text-ink ring-1 ring-line hover:bg-line"
            href={`https://x.com/intent/post?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent(url)}`}
            target="_blank"
            rel="noreferrer"
          >
            Share on X
          </a>
        </div>
        {isCreator && claimable > 0n && (
          <button onClick={() => void claimFees()} className="mt-3 rounded-md bg-yes px-3 py-1.5 text-sm font-semibold text-yes-ink">
            Claim {usdc(claimable)} creator fees
          </button>
        )}
      </section>

      <section className="rounded-xl bg-panel p-4 ring-1 ring-line">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">SOL / USD (Pyth)</h2>
          {spot && (
            <span className="num text-xs text-muted">
              <span className="text-ink">{usd(pythToNumber(spot.price, spot.expo))}</span> · read {ago(spot.publishTime)}
            </span>
          )}
        </div>
        <LineChart label="SOL price" color="var(--color-ink)" points={spotPts} refs={refs} yFormat={(v) => usd(v)} height={150} />
      </section>

      <div className="grid gap-4 md:grid-cols-2">
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
      </div>

      <section className="rounded-xl bg-panel p-4 ring-1 ring-line">
        <h2 className="mb-2 text-sm font-semibold">Recent trades</h2>
        {data.trades.length === 0 ? (
          <p className="text-sm text-muted">No trades yet. Be the first to back or challenge it.</p>
        ) : (
          <table className="num w-full text-xs">
            <tbody>
              {data.trades.map((tr) => (
                <tr key={tr.signature + tr.touch_market} className="border-t border-line">
                  <td className="py-1.5">
                    <Link href={`/u/${tr.wallet}`} className="hover:text-ink">
                      {shortAddr(tr.wallet)}
                    </Link>
                    {tr.is_creator && <span className="ml-1 text-guard">creator</span>}
                  </td>
                  <td className="text-muted">
                    {SIDE[tr.side] ?? tr.side}
                    {tr.touch_market === p?.touch_market ? " · cover" : ""}
                    {!tr.via_thesis ? " · direct" : ""}
                  </td>
                  <td className="text-right">{usdc(tr.usdc_amount)}</td>
                  <td className="text-right text-muted">
                    <a href={explorerTx(tr.signature)} target="_blank" rel="noreferrer" className="hover:text-ink">
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
  );
}
