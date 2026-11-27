"use client";

import { useEffect, useState } from "react";
import { THESIS_CALLS_ABI } from "@/lib/abi";
import { publicClient } from "@/lib/chain";
import { CALLS_ADDRESS, explorerAddress, explorerTx, NETWORK } from "@/lib/config";
import { isRefunded, useData, useNow } from "@/lib/data";
import { callLine, pct, price, when } from "@/lib/format";
import { perToken } from "@/lib/tokens";
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

/** Below this (about 20 actions at ~0.0005 QIE each) the keeper may soon stop settling promptly. */
const KEEPER_LOW_QIE = 0.01;

/**
 * The keeper's wallet and its gas, read live: anyone can see when it needs a
 * top-up. (Outcomes never depend on it: anyone can settle from a call page.)
 */
function KeeperStatus() {
  const [k, setK] = useState<{ address: `0x${string}`; gas: number } | null>(null);
  useEffect(() => {
    let live = true;
    const load = async () => {
      const address = await publicClient.readContract({ address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI, functionName: "keeper" });
      const gas = Number(await publicClient.getBalance({ address })) / 1e18;
      if (live) setK({ address, gas });
    };
    void load().catch(() => {});
    const t = setInterval(() => document.visibilityState === "visible" && void load().catch(() => {}), 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  if (!k) return null;
  const low = k.gas < KEEPER_LOW_QIE;
  return (
    <p className={"num text-xs " + (low ? "text-bad" : "text-faint")} data-testid="keeper-status">
      Keeper{" "}
      <a href={explorerAddress(k.address)} target="_blank" rel="noreferrer" className="underline hover:text-ink">
        {k.address.slice(0, 6)}…{k.address.slice(-4)}
      </a>{" "}
      · {k.gas.toFixed(4)} QIE for gas
      {low ? " · low: it may stop settling promptly until topped up (anyone can still settle from a call page)" : ""}
    </p>
  );
}

/** Public traction, straight from the contract and its events. */
export default function StatsPage() {
  const { ready, historyReady, historyError, calls, events, feedOf, stakeTokens, creatorShareBps } = useData();
  const now = useNow(60_000);
  if (!ready || !historyReady) return <p className="text-sm text-muted">{historyError ?? "Reading from QIE…"}</p>;
  const wallets = new Set([...events.trades.map((t) => t.user.toLowerCase()), ...calls.map((c) => c.creator.toLowerCase())]);
  const creators = new Set(calls.map((c) => c.creator.toLowerCase()));
  // Amounts per stake token: a call is in QIE or in QUSDC.
  // Events of a call not loaded yet are left out rather than guessed.
  const callOf = new Map(calls.map((c) => [c.id, c]));
  const volume = perToken(calls.map((c) => ({ token: c.token, value: c.volume })), stakeTokens);
  // Fees earned: refunded bets' fees (round before a touch, or pending at a void) were given back.
  const fees = perToken(
    events.trades.flatMap((t) => {
      const c = callOf.get(t.id);
      return c && !isRefunded(t, c) ? [{ token: c.token, value: t.fee }] : [];
    }),
    stakeTokens,
    2,
  );
  const paid = perToken(events.claims.flatMap((x) => (callOf.has(x.id) ? [{ token: callOf.get(x.id)!.token, value: x.amount }] : [])), stakeTokens);
  const open = perToken(calls.filter((c) => !c.settled && c.end > now).map((c) => ({ token: c.token, value: c.yesPool + c.noPool })), stakeTokens);
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
        <KeeperStatus />
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4" data-testid="stats">
        <Tile label="Trading wallets" value={String(wallets.size)} />
        <Tile label="Trades" value={String(events.trades.length)} />
        <Tile label="Volume" value={volume} sub="bet (seeds not included)" />
        <Tile label="Fees" value={fees} sub={`${pct(creatorShareBps, 0)} to creators; includes fees still held until their next oracle round`} />
        <Tile label="Calls posted" value={String(calls.length)} sub={`by ${creators.size} creator${creators.size === 1 ? "" : "s"}`} />
        <Tile label="In open pots" value={open} />
        <Tile label="Paid out" value={paid} sub="claimed" />
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
