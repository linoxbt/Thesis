"use client";

import { Check, Copy, ExternalLink, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
import { callLine, qusdc, shortAddr } from "@/lib/format";
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
      <button onClick={() => w.write("Accept contract ownership", { ...CALLS, functionName: "acceptOwnership" }).then(load).catch((e) => setErr(explain(e)))} className="btn btn-primary">
        Accept ownership
      </button>
    </section>
  );
}

function WalletPanel({ who }: { who: Address }) {
  const w = useWallet();
  const { stakeToken, refresh } = useData();
  const [bal, setBal] = useState<{ usd: bigint; gas: bigint } | null>(null);
  const [owed, setOwed] = useState(0n);
  const [err, setErr] = useState<string | null>(null);
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
              w
                .write(`Claim ${qusdc(owed)} QUSDC creator fees`, { ...CALLS, functionName: "claimCreatorFees" })
                .then(() => Promise.all([load(), refresh()]))
                .catch((e) => setErr(explain(e)))
            }
            className="btn btn-yes text-sm"
            data-testid="claim-fees"
          >
            Claim {qusdc(owed)} QUSDC in fees
          </button>
        )}
      </div>
      <p className="mt-3 text-xs text-faint">You earn half of the 2% fee on every bet on your calls; claim any time.</p>
      {err && <p className="mt-2 text-xs text-bad">{err}</p>}
    </section>
  );
}

function Positions({ who }: { who: Address }) {
  const w = useWallet();
  const { calls, events, feedOf, refresh } = useData();
  const [rows, setRows] = useState<{ id: number; yes: bigint; no: bigint; claimable: bigint; claimed: boolean }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Calls this wallet has bet on or posted (a seed is a position on both sides).
  const ids = [...new Set([...events.trades.filter((t) => t.user.toLowerCase() === who.toLowerCase()).map((t) => t.id), ...calls.filter((c) => c.creator.toLowerCase() === who.toLowerCase()).map((c) => c.id)])];
  const key = ids.sort((a, b) => b - a).join(",") + "|" + calls.filter((c) => c.settled).length;

  const load = useCallback(async () => {
    const out = await Promise.all(
      ids.map(async (id) => {
        const p = await readPosition(id, who);
        const c = calls.find((x) => x.id === id);
        const claimable = c?.settled && !p.hasClaimed ? (c.yesWon ? p.payoutIfYes : p.payoutIfNo) : 0n;
        return { id, yes: p.yes, no: p.no, claimable, claimed: p.hasClaimed };
      }),
    );
    setRows(out.filter((r) => r.yes > 0n || r.no > 0n));
  }, [key, who]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => void load().catch(() => {}), [load]);

  const claim = (id: number, amount: bigint) =>
    w
      .write(`Claim ${qusdc(amount)} QUSDC`, { ...CALLS, functionName: "claim", args: [BigInt(id)] })
      .then(() => Promise.all([load(), refresh()]))
      .catch((e) => setErr(explain(e)));

  return (
    <section className="panel p-6" data-testid="positions">
      <span className="label">Positions</span>
      {rows === null ? (
        <p className="mt-3 text-sm text-muted">Reading from QIE…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          No positions yet.{" "}
          <Link href="/app/" className="text-ink underline decoration-brand underline-offset-4">
            Find a call to back
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line text-sm">
          {rows.map((p) => {
            const c = calls.find((x) => x.id === p.id);
            const f = c ? feedOf(c.feed) : undefined;
            return (
              <li key={p.id} className="num flex flex-wrap items-center justify-between gap-2 py-2.5">
                <Link href={`/t/?id=${p.id}`} className="hover:underline">
                  {c ? callLine(f?.asset ?? "…", c.above, c.strike, f?.decimals ?? 8) : `#${p.id}`}
                  <span className="ml-2 text-xs text-muted">
                    {p.yes > 0n && `YES ${qusdc(p.yes)} `}
                    {p.no > 0n && `NO ${qusdc(p.no)}`}
                  </span>
                </Link>
                {p.claimable > 0n ? (
                  <button onClick={() => void claim(p.id, p.claimable)} className="btn btn-yes px-3 py-1 text-xs">
                    Claim {qusdc(p.claimable)}
                  </button>
                ) : (
                  <span className="text-xs text-faint">{c?.settled ? (p.claimed ? "claimed" : "settled") : "open"}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {err && <p className="mt-2 text-xs text-bad">{err}</p>}
    </section>
  );
}
