"use client";

import Link from "next/link";
import { use } from "react";
import { LoadState, StaleNote } from "@/components/LoadState";
import { MarketPanel, type MarketRow } from "@/components/MarketPanel";
import { usePoll } from "@/lib/client/api";
import { explorerTx } from "@/lib/client/config";
import { ago, shortAddr, usdc } from "@/lib/client/format";

interface Detail {
  market: MarketRow & {
    thesis: string | null;
    thesis_creator: string | null;
    is_conviction: boolean;
    creator: string;
    sponsored: boolean;
  };
  prices: { ts: string; yes_price_bps: number }[];
  trades: { signature: string; wallet: string; side: string; usdc_amount: string; ts: string; via_thesis: boolean }[];
}

const SIDE: Record<string, string> = { buy_yes: "bought YES", buy_no: "bought NO", sell_yes: "sold YES", sell_no: "sold NO" };

/**
 * One market on its own: standalone Protect markets (no thesis page), and a
 * direct link to either market of a trade. Trades inside a thesis are routed
 * through it, so its creator is still credited.
 */
export default function MarketPage({ params }: { params: Promise<{ market: string }> }) {
  const { market } = use(params);
  const { data, error, status, reload } = usePoll<Detail>(`/api/markets/${market}`, 10_000);
  if (!data) return <LoadState error={error} status={status} what="market" />;
  const m = data.market;
  return (
    <div className="space-y-5">
      {error && <StaleNote error={error} />}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted">
          {m.thesis ? (
            <>
              Part of a trade —{" "}
              <Link href={`/t/${m.thesis}`} className="text-ink underline decoration-brand underline-offset-4">
                open the trade
              </Link>
            </>
          ) : (
            <>Standalone cover market · seeded by {m.sponsored ? "the treasury" : shortAddr(m.creator)}</>
          )}
        </span>
      </div>
      <MarketPanel
        kind={m.is_conviction ? "conviction" : "protection"}
        m={m}
        prices={data.prices}
        thesis={m.thesis}
        creator={m.thesis_creator}
        onChange={() => void reload()}
      />
      <section className="panel min-w-0 p-5">
        <span className="label">Activity</span>
        <h2 className="display mb-3 mt-2 text-xl">Recent trades</h2>
        {data.trades.length === 0 ? (
          <p className="text-sm text-muted">No trades yet.</p>
        ) : (
          <table className="num w-full text-xs">
            <tbody>
              {data.trades.slice(0, 20).map((tr) => (
                <tr key={tr.signature} className="border-t border-line">
                  <td className="py-2">
                    <Link href={`/u/${tr.wallet}`} className="text-muted hover:text-ink">
                      {shortAddr(tr.wallet)}
                    </Link>
                  </td>
                  <td>{SIDE[tr.side] ?? tr.side}</td>
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
  );
}
