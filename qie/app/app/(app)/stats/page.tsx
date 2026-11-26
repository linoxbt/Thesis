"use client";

import { CALLS_ADDRESS, explorerAddress, explorerTx, NETWORK } from "@/lib/config";
import { useData, useNow } from "@/lib/data";
import { callLine, pct, price, qusdc, when } from "@/lib/format";
import { usdPx } from "@/components/Position";

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-panel px-5 py-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-1 text-2xl text-ink">{value}</div>
      {sub && <div className="text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

/** Public traction, straight from the contract and its events. */
export default function StatsPage() {
  const { ready, historyReady, calls, events, feedOf, creatorShareBps } = useData();
  const now = useNow(60_000);
  if (!ready || !historyReady) return <p className="text-sm text-muted">Reading from QIE…</p>;
  const wallets = new Set([...events.trades.map((t) => t.user.toLowerCase()), ...calls.map((c) => c.creator.toLowerCase())]);
  const creators = new Set(calls.map((c) => c.creator.toLowerCase()));
  const volume = calls.reduce((s, c) => s + c.volume, 0n);
  const fees = events.trades.reduce((s, t) => s + t.fee, 0n);
  const paid = events.claims.reduce((s, c) => s + c.amount, 0n);
  const open = calls.filter((c) => !c.settled && c.end > now).reduce((s, c) => s + c.yesPool + c.noPool, 0n);
  const voided = calls.filter((c) => c.voided).length;
  const touched = calls.filter((c) => c.touched && !c.voided);
  const txOf = new Map(events.touches.map((t) => [t.id, t]));
  return (
    <div className="space-y-4">
      <div>
        <span className="label">Onchain traction</span>
        <h1 className="display mt-2 text-4xl">Traction</h1>
        <p className="text-sm text-muted">
          Live from the{" "}
          <a href={explorerAddress(CALLS_ADDRESS)} target="_blank" rel="noreferrer" className="underline hover:text-ink">
            Thesis contract
          </a>{" "}
          on QIE {NETWORK}. Every number is read from the chain in your browser.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4" data-testid="stats">
        <Tile label="Trading wallets" value={String(wallets.size)} />
        <Tile label="Trades" value={String(events.trades.length)} />
        <Tile label="Volume" value={qusdc(volume, 0)} sub="QUSDC bet (seeds not included)" />
        <Tile label="Fees" value={qusdc(fees)} sub={`QUSDC, ${pct(creatorShareBps, 0)} to creators`} />
        <Tile label="Calls posted" value={String(calls.length)} sub={`by ${creators.size} creator${creators.size === 1 ? "" : "s"}`} />
        <Tile label="In open pots" value={qusdc(open, 0)} sub="QUSDC" />
        <Tile label="Paid out" value={qusdc(paid, 0)} sub="QUSDC claimed" />
        <Tile label="Touches proven" value={String(touched.length)} sub={voided ? `${voided} void (refunded)` : undefined} />
      </div>
      <section className="panel p-5">
        <span className="label">Proofs</span>
        <h2 className="display mb-3 mt-2 text-xl">Touches proven onchain</h2>
        {touched.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <table className="num w-full text-sm">
            <tbody>
              {[...touched].reverse().map((c) => {
                const f = feedOf(c.feed);
                const t = txOf.get(c.id);
                return (
                  <tr key={c.id} className="border-t border-line text-xs">
                    <td className="py-1.5">{callLine(f?.asset ?? "…", c.above, c.strike, f?.decimals ?? 8)}</td>
                    <td className="text-muted">
                      at {usdPx(price(c.touchPrice, f?.decimals ?? 8))}, round {c.touchRound.toString().slice(-6)}
                      {t ? `, ${when(t.updatedAt)}` : ""}
                    </td>
                    <td className="text-right">
                      {t ? (
                        <a href={explorerTx(t.tx)} target="_blank" rel="noreferrer" className="text-ink underline decoration-brand underline-offset-4">
                          proof tx
                        </a>
                      ) : (
                        <span className="text-muted">…</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
