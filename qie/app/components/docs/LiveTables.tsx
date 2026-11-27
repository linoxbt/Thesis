"use client";

import { useData, useNow } from "@/lib/data";
import { explorerAddress } from "@/lib/config";
import { pct } from "@/lib/format";
import { amtSym } from "@/lib/tokens";

const dur = (s: number) => (s % 86_400 === 0 ? `${s / 86_400} days` : s % 3600 === 0 ? `${s / 3600} h` : s % 60 === 0 ? `${s / 60} min` : `${s} s`);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Table({ head, rows, testid }: { head: string[]; rows: (string | React.ReactNode)[][]; testid?: string }) {
  return (
    <div className="my-5 overflow-x-auto rounded-2xl border border-line" data-testid={testid}>
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="bg-panel-2 text-xs uppercase tracking-wide text-faint">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((c, j) => (
                <td key={j} className={"px-4 py-2.5 " + (j === 0 ? "text-ink" : "num text-muted")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The contract's live parameters, read from QIE mainnet. */
export function ParamsTable() {
  const { params, creatorShareBps, paused, ready } = useData();
  if (!ready || !params) return <p className="my-5 text-sm text-muted">Reading the live parameters from QIE…</p>;
  const p = params;
  const rows: [string, string, string][] = [
    ["Fee per bet", `${pct(p.feeBps, 1)}, ${pct(creatorShareBps, 0)} of it to the call's creator`, "feeBps / creatorShareBps"],
    ["Call window", `${dur(p.minWindow)} – ${dur(p.maxWindow)}`, "minWindow / maxWindow"],
    ["Target distance", `${pct(p.minDistanceBps, 0)} – ${pct(p.maxDistanceBps, 0)} from the latest price`, "minDistanceBps / maxDistanceBps"],
    ["Stale-print margin (posting)", `z = ${(p.staleZTenths / 10).toFixed(1)}: target ≥ z·σ·√age away`, "staleZTenths"],
    ["Opening odds", `${pct(p.minOpenBps, 0)} – ${pct(p.maxOpenBps, 0)}`, "minOpenBps / maxOpenBps"],
    ["Betting closes", `in the last ${pct(p.closeBps, 0)} of the window`, "closeBps"],
    ["Betting pauses", `within ${pct(p.betCutoffBps, 2)} of the target`, "betCutoffBps"],
    ["Oracle freshness", `latest print at most ${dur(p.maxOracleAge)} old`, "maxOracleAge"],
    ["Volatility freshness", `posted at most ${dur(p.maxVolAge)} ago`, "maxVolAge"],
    ["Proof grace", `${dur(p.grace)} after the deadline`, "grace"],
    ["Void after", `${dur(p.voidAfter)} past the deadline with no settlement possible`, "voidAfter"],
    ["Paused", paused ? "yes: posting and betting are paused" : "no", "paused"],
  ];
  return <Table head={["Setting", "Live value", "Contract field"]} rows={rows} testid="docs-params" />;
}

/** What calls can be staked in, with each token's live limits. */
export function TokensTable() {
  const { stakeTokens, ready } = useData();
  if (!ready) return <p className="my-5 text-sm text-muted">Reading the stake tokens from QIE…</p>;
  return (
    <Table
      head={["Stake", "Seed", "Minimum bet", "Scores with", "New calls"]}
      testid="docs-tokens"
      rows={stakeTokens.map((t) => [
        t.native ? (
          "QIE (native)"
        ) : (
          <a key="a" href={explorerAddress(t.address)} target="_blank" rel="noreferrer" className="underline decoration-line-2 underline-offset-4 hover:text-ink">
            {t.symbol}
          </a>
        ),
        `${amtSym(t.minSeed, t, 0)} – ${amtSym(t.maxSeed, t, 0)}`,
        amtSym(t.minStake, t),
        `${amtSym(t.minScoredVolume, t, 0)} of outside bets`,
        t.enabled ? "yes" : "no",
      ])}
    />
  );
}

/** The QIE Oracle feeds the contract uses, with live prices and settings. */
export function FeedsTable() {
  const { feeds, ready } = useData();
  const now = useNow(10_000);
  if (!ready) return <p className="my-5 text-sm text-muted">Reading the feeds from QIE…</p>;
  return (
    <Table
      head={["Feed", "Address", "Latest price", "Volatility", "Typical round gap"]}
      testid="docs-feeds"
      rows={feeds.map((f) => [
        `${f.asset} / USDT${f.enabled ? "" : " (disabled)"}`,
        <a key="a" href={explorerAddress(f.address)} target="_blank" rel="noreferrer" className="underline decoration-line-2 underline-offset-4 hover:text-ink">
          {short(f.address)}
        </a>,
        `$${(Number(f.price) / 10 ** f.decimals).toLocaleString("en-US", { maximumFractionDigits: 2 })}${now ? ` · ${Math.max(0, Math.round((now - f.updatedAt) / 60))} min ago` : ""}`,
        pct(f.volBps, 1),
        f.monitorSecs ? `${Math.round(f.monitorSecs / 60)} min` : "—",
      ])}
    />
  );
}
