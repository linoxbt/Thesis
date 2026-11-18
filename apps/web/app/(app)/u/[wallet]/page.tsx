"use client";

import Link from "next/link";
import { use } from "react";
import { usePoll } from "@/lib/client/api";
import { explorerAccount } from "@/lib/client/config";
import { callLine, pct, shortAddr, usdc } from "@/lib/client/format";

interface Profile {
  wallet: string;
  profile: { display_name: string | null; x_handle: string | null } | null;
  stats: {
    posted: string;
    hit: string;
    missed: string;
    volume_usdc: string;
    self_volume_usdc: string;
    avg_opening_bps: number;
  } | null;
  fees_earned: string;
  protection_bought_usdc: string;
  protection_paid_out_usdc: string;
  history: {
    pda: string;
    text: string | null;
    end_ts: string;
    outcome: number;
    volume_usdc: string;
    direction: string;
    strike: string;
    expo: number;
    initial_price_bps: number;
    fees_earned: string;
  }[];
}

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
 * Profile (spec 8, screen 5): raw numbers, no accuracy score. Each thesis
 * shows its opening odds beside its outcome, so a hit on a 90% call doesn't
 * read like a hit on a 20% call.
 */
export default function ProfilePage({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = use(params);
  const { data, error } = usePoll<Profile>(`/api/profiles/${wallet}`, 30_000);
  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const s = data.stats;
  return (
    <div className="space-y-4">
      <div>
        <span className="label">Trader</span>
        <h1 className="display mt-2 text-4xl">{data.profile?.display_name ?? shortAddr(wallet)}</h1>
        <a href={explorerAccount(wallet)} target="_blank" rel="noreferrer" className="num text-xs text-muted underline">
          {wallet}
        </a>
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
        <Tile label="Theses posted" value={s?.posted ?? "0"} />
        <Tile label="Hit / missed" value={`${s?.hit ?? 0} / ${s?.missed ?? 0}`} sub={s ? `avg opening odds ${pct(s.avg_opening_bps, 0)}` : undefined} />
        <Tile label="Volume generated" value={usdc(s?.volume_usdc ?? 0, 0)} sub={s && Number(s.self_volume_usdc) > 0 ? `${usdc(s.self_volume_usdc, 0)} own trades` : undefined} />
        <Tile label="Fees earned" value={usdc(data.fees_earned)} />
        <Tile label="Protection bought" value={usdc(data.protection_bought_usdc)} />
        <Tile label="Protection paid out" value={usdc(data.protection_paid_out_usdc)} />
      </div>
      <section className="panel p-5">
        <span className="label">History</span>
        <h2 className="display mb-3 mt-2 text-xl">Thesis history</h2>
        {data.history.length === 0 ? (
          <p className="text-sm text-muted">No theses yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 font-normal">Call</th>
                <th className="font-normal">Opened at</th>
                <th className="font-normal">Outcome</th>
                <th className="text-right font-normal">Volume</th>
              </tr>
            </thead>
            <tbody className="num">
              {data.history.map((h) => (
                <tr key={h.pda} className="border-t border-line">
                  <td className="py-1.5">
                    <Link href={`/t/${h.pda}`} className="hover:underline decoration-brand underline-offset-4">
                      {callLine(h.direction, h.strike, h.expo, Number(h.end_ts))}
                    </Link>
                  </td>
                  <td className="text-muted">{pct(h.initial_price_bps, 0)}</td>
                  <td>{h.outcome === 1 ? <span className="text-yes">hit</span> : h.outcome === 2 ? "missed" : <span className="text-muted">open</span>}</td>
                  <td className="text-right">{usdc(h.volume_usdc, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
