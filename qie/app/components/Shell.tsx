"use client";

import { LayoutGrid, LogOut, PenLine, Trophy, User, Wallet, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Logo } from "./Brand";
import { readBalances } from "@/lib/chain";
import { DEPLOYED, explorerTx, IS_MAINNET, NETWORK, QIE_WALLET_URL } from "@/lib/config";
import { useData } from "@/lib/data";
import { qusdc, shortAddr } from "@/lib/format";
import { useWallet } from "@/lib/wallet";

const NAV = [
  { href: "/", label: "Calls", icon: LayoutGrid },
  { href: "/new/", label: "Post a call", short: "Post", icon: PenLine },
  { href: "/leaderboard/", label: "Leaderboard", short: "Leaders", icon: Trophy },
  { href: "/profile/", label: "Profile", icon: User },
];

function NetworkBadge() {
  return (
    <span
      className={
        "num whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ring-1 sm:px-2.5 sm:py-1 sm:text-[11px] " +
        (IS_MAINNET ? "bg-yes/10 text-yes ring-yes/30" : "badge-devnet")
      }
      title={IS_MAINNET ? "QIE mainnet: real QUSDC" : `QIE ${NETWORK}: test funds`}
      data-testid="network-badge"
    >
      QIE {NETWORK}
    </span>
  );
}

function WalletButton() {
  const w = useWallet();
  const { stakeToken } = useData();
  const [open, setOpen] = useState(false);
  const [bal, setBal] = useState<{ usd: bigint; gas: bigint } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!w.account || !stakeToken) return setBal(null);
    let live = true;
    const load = () => readBalances(stakeToken, w.account!).then((b) => live && setBal(b)).catch(() => {});
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [w.account, stakeToken]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  if (!w.account) {
    return (
      <div className="flex flex-col items-end">
        {w.available ? (
          <button
            onClick={() => w.connect().catch((e) => setErr((e as Error).message))}
            className="btn btn-primary whitespace-nowrap text-sm"
            data-testid="connect"
          >
            <Wallet size={14} className="mr-1 inline" /> Connect wallet
          </button>
        ) : (
          <a href={QIE_WALLET_URL} target="_blank" rel="noreferrer" className="btn btn-primary whitespace-nowrap text-sm">
            Get QIE Wallet
          </a>
        )}
        {err && <span className="mt-1 max-w-[220px] text-right text-[11px] text-bad">{err}</span>}
      </div>
    );
  }
  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen((o) => !o)} className="btn btn-ghost num text-sm" data-testid="account">
        {shortAddr(w.account)}
        {bal && <span className="ml-2 hidden text-muted sm:inline">{qusdc(bal.usd)} QUSDC</span>}
        {!w.chainOk && <span className="ml-2 text-bad">wrong network</span>}
      </button>
      {open && (
        <div className="panel absolute right-0 z-30 mt-2 w-64 p-2 text-sm shadow-2xl">
          <div className="px-3 py-2 text-xs text-muted">
            {w.walletName}
            {bal && (
              <span className="num mt-1 block text-ink">
                {qusdc(bal.usd)} QUSDC · {(Number(bal.gas) / 1e18).toFixed(3)} QIE
              </span>
            )}
          </div>
          <Link href="/profile/" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 hover:bg-panel-2">
            Profile
          </Link>
          <button onClick={() => (w.disconnect(), setOpen(false))} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-panel-2">
            <LogOut size={13} /> Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function Toasts() {
  const { toasts, dismiss } = useWallet();
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-20 right-4 z-50 w-80 space-y-2 lg:bottom-4">
      {toasts.map((t) => (
        <div key={t.id} className="panel flex items-start gap-3 p-3 text-sm shadow-xl" data-testid={`tx-${t.status}`}>
          <span className={t.status === "failed" ? "text-bad" : t.status === "confirmed" ? "text-yes" : "text-muted"}>
            {t.status === "pending" ? "⏳" : t.status === "confirmed" ? "✓" : "✕"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-ink">{t.label}</div>
            <div className="text-xs text-muted">
              {t.status === "pending" ? "Confirm in your wallet…" : t.status === "confirmed" ? "Confirmed" : t.error}
              {t.hash && (
                <a href={explorerTx(t.hash)} target="_blank" rel="noreferrer" className="ml-2 underline">
                  explorer
                </a>
              )}
            </div>
          </div>
          <button onClick={() => dismiss(t.id)} className="text-faint hover:text-ink" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href.replace(/\/$/, "")));
  const { error } = useData();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <div className="flex items-center gap-6">
            <Logo href="/" size={22} text="text-[19px]" />
            <nav className="hidden items-center gap-1 md:flex">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={"rounded-lg px-3 py-1.5 text-sm " + (active(n.href) ? "bg-panel-2 text-ink" : "text-muted hover:text-ink")}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <NetworkBadge />
            <WalletButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 lg:px-8 md:pb-12">
        {!DEPLOYED && (
          <p className="mb-4 rounded-xl border border-line bg-panel-2 px-4 py-3 text-sm text-muted">
            The contract isn&apos;t deployed on this network yet.
          </p>
        )}
        {error && (
          <p className="mb-4 rounded-xl border border-line bg-panel-2 px-4 py-2 text-xs text-muted" role="status">
            Couldn&apos;t refresh from QIE ({error}); showing the last data.
          </p>
        )}
        {children}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-line bg-bg/95 py-2 backdrop-blur md:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={"flex flex-col items-center gap-0.5 text-[11px] " + (active(n.href) ? "text-ink" : "text-faint")}>
            <n.icon size={18} />
            {n.short ?? n.label}
          </Link>
        ))}
      </nav>
      <Toasts />
    </div>
  );
}
