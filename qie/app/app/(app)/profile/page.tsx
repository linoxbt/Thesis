"use client";

import { Check, Copy, ExternalLink, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Abi, Address } from "viem";
import { ProfileStats } from "@/components/ProfileStats";
import { Avatar } from "@/components/ThesisCard";
import { useQieName } from "@/components/Who";
import { openQieIdWidget } from "@/lib/qieidWidget";
import { ThemeSetting } from "@/components/ThemeToggle";
import { THESIS_CALLS_ABI } from "@/lib/abi";
import { publicClient, readBalances, readPosition } from "@/lib/chain";
import { CALLS_ADDRESS, explorerAddress, QUSDC_URL } from "@/lib/config";
import { useData } from "@/lib/data";
import { pct, price, qusdc, shortAddr } from "@/lib/format";
import { fmtPct, markMove, positionOf } from "@/lib/position";
import { usdPx } from "@/components/Position";
import { explain, useWallet } from "@/lib/wallet";

const CALLS = { address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI as Abi };

/** Your own profile: wallet, positions, earnings and settings. Anyone's public view is at /u/?a=. */
export default function ProfilePage() {
  const w = useWallet();
  if (!w.account) return <SignedOut />;
  return <SignedIn who={w.account} />;
}

function SignedOut() {
  const w = useWallet();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-panel-3 text-ink">
        <Wallet size={22} />
      </div>
      <h1 className="display mt-6 text-4xl">Your profile</h1>
      <p className="mt-3 text-muted">Sign in with QIE Pass, QIE Wallet or any wallet through Reown to see your calls, positions, skill and earnings.</p>
      <div className="mt-7 flex flex-wrap justify-center gap-2">
        <button onClick={() => w.connect().catch((e) => setErr(explain(e)))} className="btn btn-primary" data-testid="profile-signin">
          Sign in
        </button>
      </div>
      {err && <p className="mt-3 text-xs text-bad">{err}</p>}
      <div className="mt-10 text-left">
        <Settings />
      </div>
    </div>
  );
}

function Settings() {
  return (
    <section className="panel p-6" data-testid="settings">
      <h2 className="text-lg font-semibold tracking-[-0.02em]">Settings</h2>
      <div className="mt-4">
        <div className="text-sm">Appearance</div>
        <p className="mb-2 mt-0.5 text-xs text-faint">Light is the default. Saved in this browser.</p>
        <ThemeSetting />
      </div>
    </section>
  );
}

function SignedIn({ who }: { who: Address }) {
  const w = useWallet();
  const name = useQieName(who) ?? w.qieName;
  return (
    <div className="space-y-6">
      <header className="panel flex flex-wrap items-center justify-between gap-5 p-6">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar addr={who} size={60} />
          <div className="min-w-0">
            <span className="label">Profile</span>
            <h1 className={"display mt-1 truncate text-3xl sm:text-4xl " + (name ? "" : "num")} data-testid="profile-name">
              {name ?? shortAddr(who)}
            </h1>
            <div className="num mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              {w.walletName && <span className="rounded-full bg-panel-3 px-2 py-0.5">{w.walletName}</span>}
              {w.session?.qiePass && (
                <span className="inline-flex items-center gap-1 rounded-full bg-yes/10 px-2 py-0.5 text-yes ring-1 ring-yes/30" data-testid="profile-qiepass">
                  <ShieldCheck size={12} /> QIE Pass verified
                </span>
              )}
              <CopyAddress addr={who} />
              {!name && (
                <button onClick={openQieIdWidget} className="underline decoration-line-2 underline-offset-4 hover:text-ink" data-testid="profile-get-qieid">
                  Get a QIE ID
                </button>
              )}
            </div>
          </div>
        </div>
        <Link href={`/u/?a=${who}`} className="btn btn-ghost text-sm">
          Public view <ExternalLink size={13} />
        </Link>
      </header>

      <OwnerPanel who={who} />

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Positions who={who} />
        <WalletPanel who={who} />
      </div>

      <Settings />

      <div>
        <span className="label">Activity</span>
        <div className="mt-3 space-y-4">
          <ProfileStats who={who} />
        </div>
      </div>
    </div>
  );
}

function CopyAddress({ addr }: { addr: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <a href={explorerAddress(addr)} target="_blank" rel="noreferrer" className="underline decoration-line-2 underline-offset-4 hover:text-ink">
        {shortAddr(addr)}
      </a>
      <button
        onClick={() => void navigator.clipboard.writeText(addr).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1200)))}
        className="rounded p-0.5 hover:text-ink"
        aria-label="Copy address"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </span>
  );
}

/** Shown only to the wallet the contract has offered ownership to. */
function OwnerPanel({ who }: { who: Address }) {
  const w = useWallet();
  const [pending, setPending] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, run] = useOnce();
  const load = useCallback(() => {
    publicClient.readContract({ address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI, functionName: "pendingOwner" }).then(setPending).catch(() => {});
  }, []);
  useEffect(load, [load]);
  if (!pending || pending.toLowerCase() !== who.toLowerCase()) return null;
  return (
    <section className="panel flex flex-wrap items-center justify-between gap-3 p-5" data-testid="accept-ownership">
      <div className="text-sm">
        <div className="text-ink">You&apos;ve been offered ownership of the Thesis contract.</div>
        <div className="text-xs text-muted">Accepting makes this wallet the owner (limits, pause, treasury). The current owner keeps control until you accept.</div>
        {err && <div className="mt-1 text-xs text-bad">{err}</div>}
      </div>
      <button
        onClick={() => void run("accept", () => w.write("Accept contract ownership", { ...CALLS, functionName: "acceptOwnership" }).then(load).catch((e) => setErr(explain(e))))}
        disabled={!!busy}
        className="btn btn-primary disabled:opacity-40"
      >
        {busy ? "Accepting…" : "Accept ownership"}
      </button>
    </section>
  );
}

function WalletPanel({ who }: { who: Address }) {
  const w = useWallet();
  const { stakeToken, refresh, params, creatorShareBps } = useData();
  const [bal, setBal] = useState<{ usd: bigint; gas: bigint } | null>(null);
  const [owed, setOwed] = useState(0n);
  const [err, setErr] = useState<string | null>(null);
  const [busy, run] = useOnce();
  const load = useCallback(async () => {
    if (!stakeToken) return;
    const [b, fees] = await Promise.all([
      readBalances(stakeToken, who),
      publicClient.readContract({ address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI, functionName: "creatorFeesOwed", args: [who] }),
    ]);
    setBal(b);
    setOwed(fees);
  }, [who, stakeToken]);
  useEffect(() => void load().catch(() => {}), [load]);
  return (
    <section className="panel p-6" data-testid="wallet-panel">
      <span className="label">Wallet</span>
      <div className="num mt-3 grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-faint">QUSDC</div>
          <div className="text-2xl text-ink">{bal ? qusdc(bal.usd) : "…"}</div>
        </div>
        <div>
          <div className="text-xs text-faint">QIE for gas</div>
          <div className="text-2xl text-ink">{bal ? (Number(bal.gas) / 1e18).toFixed(3) : "…"}</div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <a href={QUSDC_URL} target="_blank" rel="noreferrer" className="btn btn-ghost text-sm">
          Get QUSDC <ExternalLink size={13} />
        </a>
        {owed > 0n && (
          <button
            onClick={() =>
              void run("fees", () =>
                w
                  .write(`Claim ${qusdc(owed)} QUSDC creator fees`, { ...CALLS, functionName: "claimCreatorFees" })
                  .then(() => Promise.all([load(), refresh()]))
                  .catch((e) => setErr(explain(e))),
              )
            }
            disabled={!!busy}
            className="btn btn-yes text-sm disabled:opacity-40"
            data-testid="claim-fees"
          >
            {busy ? "Claiming…" : `Claim ${qusdc(owed)} QUSDC in fees`}
          </button>
        )}
      </div>
      <p className="mt-3 text-xs text-faint">
        You earn {pct(creatorShareBps, 0)} of the {pct(params?.feeBps ?? 200, 0)} fee on every bet on your calls; claim any time.
      </p>
      {err && <p className="mt-2 text-xs text-bad">{err}</p>}
    </section>
  );
}

/** Busy flag that also blocks a second click before React re-renders. */
function useOnce() {
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef(false);
  const run = useCallback(async (key: string, fn: () => Promise<unknown>) => {
    if (ref.current) return;
    ref.current = true;
    setBusy(key);
    try {
      await fn();
    } finally {
      ref.current = false;
      setBusy(null);
    }
  }, []);
  return [busy, run] as const;
}

type Row = { id: number; yes: bigint; no: bigint; claimable: bigint; claimed: boolean; paid: bigint; payoutIfYes: bigint; payoutIfNo: bigint };

function Positions({ who }: { who: Address }) {
  const w = useWallet();
  const { calls, events, feedOf, refresh, historyReady } = useData();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, run] = useOnce();
  const me = who.toLowerCase();
  // Calls this wallet has bet on or posted (a seed is a position on both sides).
  const ids = [...new Set([...events.trades.filter((t) => t.user.toLowerCase() === me).map((t) => t.id), ...calls.filter((c) => c.creator.toLowerCase() === me).map((c) => c.id)])];
  const key = ids.sort((a, b) => b - a).join(",") + "|" + calls.filter((c) => c.settled).length + "|" + events.claims.length;

  const load = useCallback(async () => {
    const got = await Promise.allSettled(ids.map((id) => readPosition(id, who)));
    const out: Row[] = [];
    let bad = 0;
    got.forEach((g, i) => {
      if (g.status === "rejected") return void (bad += 1);
      const p = g.value;
      const paid = events.claims.filter((x) => x.id === ids[i] && x.user.toLowerCase() === me).reduce((s, x) => s + x.amount, 0n);
      if (p.yes > 0n || p.no > 0n) out.push({ id: ids[i], yes: p.yes, no: p.no, claimable: p.claimable, claimed: p.hasClaimed, paid, payoutIfYes: p.payoutIfYes, payoutIfNo: p.payoutIfNo });
    });
    setRows(out);
    setFailed(bad);
  }, [key, who]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (historyReady) void load().catch(() => setFailed(1));
  }, [load, historyReady]);

  const claim = (id: number, amount: bigint) =>
    run(`claim-${id}`, () =>
      w
        .write(`Claim ${qusdc(amount)} QUSDC`, { ...CALLS, functionName: "claim", args: [BigInt(id)] })
        .then(() => Promise.all([load(), refresh()]))
        .catch((e) => setErr(explain(e))),
    );

  return (
    <section className="panel p-6" data-testid="positions">
      <span className="label">Positions</span>
      {!historyReady || rows === null ? (
        <p className="mt-3 text-sm text-muted">Reading from QIE…</p>
      ) : rows.length === 0 && failed === 0 ? (
        <p className="mt-3 text-sm text-muted">
          No positions yet.{" "}
          <Link href="/app/" className="text-ink underline decoration-brand underline-offset-4">
            Find a call to back
          </Link>
          .
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="num w-full min-w-[520px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-faint">
              <tr>
                <th className="py-1.5 font-normal">Call</th>
                <th className="font-normal">Entry → TP</th>
                <th className="font-normal">Mark</th>
                <th className="font-normal">Stake</th>
                <th className="text-right font-normal">Payout / P&amp;L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((p) => {
                const c = calls.find((x) => x.id === p.id);
                const f = c ? feedOf(c.feed) : undefined;
                const dec = f?.decimals ?? 8;
                const pos = c ? positionOf(c.above ? "above" : "below", price(c.spotAtOpen, dec), price(c.strike, dec)) : null;
                const mark = f ? price(f.price, dec) : null;
                // Cost = net stake plus the fees this wallet paid on it (the seed pays none).
                const feesPaid = events.trades.filter((t) => t.id === p.id && t.user.toLowerCase() === me).reduce((a, t) => a + t.fee, 0n);
                const cost = p.yes + p.no + feesPaid;
                const got = p.claimed ? p.paid : p.claimable;
                const pnl = c?.settled ? got - cost : null;
                return (
                  <tr key={p.id} className="align-top">
                    <td className="py-2.5 pr-2">
                      <Link href={`/t/?id=${p.id}`} className="hover:underline">
                        <span className={pos?.side === "long" ? "text-yes" : "text-bad"}>{pos?.side === "long" ? "LONG" : "SHORT"}</span> {f?.asset ?? "…"}
                      </Link>
                      <div className="text-faint">{c ? (c.voided ? "void" : c.settled ? (c.yesWon ? "hit" : "missed") : "open") : "…"}</div>
                    </td>
                    <td className="pr-2">{pos ? `${usdPx(pos.entry)} → ${usdPx(pos.tp)}` : "…"}</td>
                    <td className="pr-2">
                      {mark !== null && pos ? (
                        <>
                          {usdPx(mark)}
                          <div className={markMove(pos, mark) >= 0 ? "text-yes" : "text-bad"}>{fmtPct(markMove(pos, mark), 2)}</div>
                        </>
                      ) : (
                        "…"
                      )}
                    </td>
                    <td className="pr-2">
                      {p.yes > 0n && <div>YES {qusdc(p.yes)}</div>}
                      {p.no > 0n && <div>NO {qusdc(p.no)}</div>}
                    </td>
                    <td className="text-right">
                      {!c?.settled ? (
                        <span className="text-faint">
                          {p.yes > 0n && <div>{qusdc(p.payoutIfYes)} if hit</div>}
                          {p.no > 0n && <div>{qusdc(p.payoutIfNo)} if missed</div>}
                        </span>
                      ) : p.claimable > 0n ? (
                        <button onClick={() => void claim(p.id, p.claimable)} disabled={!!busy} className="btn btn-yes px-3 py-1 text-xs disabled:opacity-40">
                          {busy === `claim-${p.id}` ? "Claiming…" : `Claim ${qusdc(p.claimable)}`}
                        </button>
                      ) : (
                        <span className="text-faint">{p.claimed ? "claimed" : "nothing to claim"}</span>
                      )}
                      {pnl !== null && (
                        <div className={pnl >= 0n ? "text-yes" : "text-bad"}>
                          {pnl >= 0n ? "+" : "−"}
                          {qusdc(pnl >= 0n ? pnl : -pnl)} P&amp;L
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {failed > 0 && <p className="mt-2 text-xs text-muted">{failed} position{failed > 1 ? "s" : ""} couldn&apos;t be read; retrying on the next refresh.</p>}
      {err && <p className="mt-2 text-xs text-bad" role="alert">{err}</p>}
    </section>
  );
}
