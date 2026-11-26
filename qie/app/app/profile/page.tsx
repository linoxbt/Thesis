"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { isAddress, type Abi, type Address } from "viem";
import { CallCard } from "@/components/CallCard";
import { ThemeSetting } from "@/components/ThemeToggle";
import { THESIS_CALLS_ABI } from "@/lib/abi";
import { publicClient, readPosition } from "@/lib/chain";
import { CALLS_ADDRESS, explorerAddress } from "@/lib/config";
import { useData, useNow } from "@/lib/data";
import { fmtSkill, qusdc, shortAddr } from "@/lib/format";
import { explain, useWallet } from "@/lib/wallet";

export default function ProfilePage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <ProfileView />
    </Suspense>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-panel px-5 py-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-1 text-2xl text-ink">{value}</div>
      {sub && <div className="text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

function ProfileView() {
  const q = useSearchParams().get("a");
  const w = useWallet();
  const who = (q && isAddress(q) ? q : w.account) as Address | null;
  const { ready, calls, creators, params, feedOf, refresh } = useData();
  const now = useNow(1000);
  const [owed, setOwed] = useState<bigint>(0n);
  const [pendingOwner, setPendingOwner] = useState<string | null>(null);
  const [positions, setPositions] = useState<{ id: number; yes: bigint; no: bigint; claimable: bigint }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const mine = !!w.account && !!who && w.account.toLowerCase() === who.toLowerCase();

  const load = useCallback(async () => {
    if (!who) return;
    const fees = await publicClient.readContract({ address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI, functionName: "creatorFeesOwed", args: [who] });
    setOwed(fees);
    setPendingOwner(await publicClient.readContract({ address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI, functionName: "pendingOwner" }));
    // Positions across the latest 100 calls.
    const recent = calls.slice(-100);
    const ps = await Promise.all(recent.map((c) => readPosition(c.id, who).then((p) => ({ c, p }))));
    setPositions(
      ps
        .filter(({ p }) => p.yes > 0n || p.no > 0n)
        .map(({ c, p }) => ({ id: c.id, yes: p.yes, no: p.no, claimable: c.settled && !p.hasClaimed ? (c.yesWon ? p.payoutIfYes : p.payoutIfNo) : 0n }))
        .reverse(),
    );
  }, [who, calls]);
  useEffect(() => void load().catch(() => {}), [load]);

  if (!who) {
    return (
      <div className="space-y-4">
        <div className="panel p-6 text-sm text-muted">Connect your wallet to see your calls, positions and skill.</div>
        <section className="panel p-6">
          <div className="text-sm">Appearance</div>
          <div className="mt-2">
            <ThemeSetting />
          </div>
        </section>
      </div>
    );
  }
  const stats = creators.find((x) => x.creator.toLowerCase() === who.toLowerCase())?.stats;
  const theirCalls = calls.filter((c) => c.creator.toLowerCase() === who.toLowerCase()).reverse();
  const scored = (stats?.hits ?? 0) + (stats?.misses ?? 0);
  const claim = (id: number, amount: bigint) =>
    w
      .write(`Claim ${qusdc(amount)} QUSDC`, { address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI as Abi, functionName: "claim", args: [BigInt(id)] })
      .then(() => Promise.all([load(), refresh()]))
      .catch((e) => setErr(explain(e)));

  return (
    <div className="space-y-6">
      <header className="panel flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <span className="label">{mine ? "Your profile" : "Caller"}</span>
          <h1 className="display num mt-1 text-2xl sm:text-3xl">{shortAddr(who)}</h1>
          <a href={explorerAddress(who)} target="_blank" rel="noreferrer" className="num text-xs text-muted underline">
            {who}
          </a>
        </div>
        {mine && owed > 0n && (
          <button
            onClick={() =>
              w
                .write(`Claim ${qusdc(owed)} QUSDC creator fees`, { address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI as Abi, functionName: "claimCreatorFees" })
                .then(load)
                .catch((e) => setErr(explain(e)))
            }
            className="btn btn-yes"
            data-testid="claim-fees"
          >
            Claim {qusdc(owed)} QUSDC in fees
          </button>
        )}
      </header>
      {err && <p className="text-xs text-bad">{err}</p>}
      {mine && pendingOwner && pendingOwner.toLowerCase() === who.toLowerCase() && (
        <section className="panel flex flex-wrap items-center justify-between gap-3 p-5" data-testid="accept-ownership">
          <div className="text-sm">
            <div className="text-ink">You&apos;ve been offered ownership of the Thesis contract.</div>
            <div className="text-xs text-muted">Accepting makes this wallet the owner (limits, pause, treasury). The current owner keeps control until you accept.</div>
          </div>
          <button
            onClick={() =>
              w
                .write("Accept contract ownership", { address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI as Abi, functionName: "acceptOwnership" })
                .then(load)
                .catch((e) => setErr(explain(e)))
            }
            className="btn btn-primary"
          >
            Accept ownership
          </button>
        </section>
      )}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
        <Tile label="Skill score" value={scored > 0 ? fmtSkill(stats!.skillBps) : "—"} sub={scored > 0 ? `${scored} scored call${scored === 1 ? "" : "s"}` : "scored once a call settles"} />
        <Tile label="Calls posted" value={String(stats?.posted ?? 0)} />
        <Tile label="Hit / missed" value={`${stats?.hits ?? 0} / ${stats?.misses ?? 0}`} />
        <Tile label="Volume on their calls" value={`${qusdc(stats?.volume ?? 0n, 0)}`} sub="QUSDC" />
      </div>

      {positions && positions.length > 0 && (
        <section className="panel p-5" data-testid="positions">
          <span className="label">Positions</span>
          <ul className="mt-3 divide-y divide-line text-sm">
            {positions.map((p) => {
              const c = calls.find((x) => x.id === p.id)!;
              const f = feedOf(c.feed);
              return (
                <li key={p.id} className="num flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <a href={`/call/?id=${p.id}`} className="hover:underline">
                    #{p.id} {f?.asset} {c.above ? "≥" : "≤"} target
                    <span className="ml-2 text-xs text-muted">
                      {p.yes > 0n && `YES ${qusdc(p.yes)} `}
                      {p.no > 0n && `NO ${qusdc(p.no)}`}
                    </span>
                  </a>
                  {mine && p.claimable > 0n ? (
                    <button onClick={() => void claim(p.id, p.claimable)} className="btn btn-yes px-3 py-1 text-xs">
                      Claim {qusdc(p.claimable)}
                    </button>
                  ) : (
                    <span className="text-xs text-faint">{c.settled ? (p.claimable > 0n ? `${qusdc(p.claimable)} to claim` : "settled") : "open"}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section>
        <h2 className="display mb-3 text-xl">Calls</h2>
        {!ready ? (
          <p className="text-sm text-muted">Reading from QIE…</p>
        ) : theirCalls.length === 0 ? (
          <p className="text-sm text-muted">No calls yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {theirCalls.map((c) => (
              <CallCard key={c.id} c={c} feed={feedOf(c.feed)} now={now} grace={params?.grace ?? 300} />
            ))}
          </div>
        )}
      </section>

      {mine && (
        <section className="panel p-6">
          <div className="text-sm">Appearance</div>
          <div className="mt-2">
            <ThemeSetting />
          </div>
        </section>
      )}
    </div>
  );
}
