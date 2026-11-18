"use client";

import { usePoll } from "@/lib/client/api";
import { explorerTx } from "@/lib/client/config";
import { pythToNumber, usd, usdc, when } from "@/lib/client/format";

interface Stats {
  cluster: string;
  wallets: string;
  trades: string;
  volume_usdc: string;
  volume_via_thesis_usdc: string;
  fees_to_treasury_usdc: string;
  theses: string;
  creators: string;
  cover_bought_usdc: string;
  payouts_usdc: string;
  touches_proven: number;
  touches: { touch_market: string; direction: string; strike: string; expo: number; touch_price: string; touch_publish_time: string; proof_tx: string | null }[];
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-panel p-3 ring-1 ring-line">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

/** Public traction (spec 8, screen 6; spec 11). Team wallets and the treasury are excluded. */
export default function StatsPage() {
  const { data, error } = usePoll<Stats>("/api/stats", 30_000);
  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Traction</h1>
        <p className="text-sm text-muted">
          Live from the chain ({data.cluster}). Team wallets and the treasury's own trades are excluded.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Trading wallets" value={data.wallets} />
        <Tile label="Trades" value={data.trades} />
        <Tile label="Volume" value={usdc(data.volume_usdc, 0)} sub={`${usdc(data.volume_via_thesis_usdc, 0)} through Thesis`} />
        <Tile label="Fees to treasury" value={usdc(data.fees_to_treasury_usdc)} />
        <Tile label="Theses posted" value={data.theses} sub={`by ${data.creators} creators`} />
        <Tile label="Cover bought" value={usdc(data.cover_bought_usdc, 0)} />
        <Tile label="Paid out" value={usdc(data.payouts_usdc, 0)} />
        <Tile label="Touches proven" value={String(data.touches_proven)} />
      </div>
      <section className="rounded-xl bg-panel p-4 ring-1 ring-line">
        <h2 className="mb-2 text-sm font-semibold">Touches proven onchain</h2>
        {data.touches.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <table className="num w-full text-sm">
            <tbody>
              {data.touches.map((t) => (
                <tr key={t.touch_market} className="border-t border-line">
                  <td className="py-1.5">
                    SOL {t.direction === "below" ? "≤" : "≥"} {usd(pythToNumber(t.strike, t.expo))}
                  </td>
                  <td className="text-muted">
                    at {usd(pythToNumber(t.touch_price, t.expo))}, {when(Number(t.touch_publish_time))}
                  </td>
                  <td className="text-right">
                    {t.proof_tx ? (
                      <a href={explorerTx(t.proof_tx)} target="_blank" rel="noreferrer" className="underline">
                        proof tx
                      </a>
                    ) : (
                      <span className="text-muted">indexing…</span>
                    )}
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
