"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { CLUSTER, IS_DEVNET } from "@/lib/client/config";
import { shortAddr } from "@/lib/client/format";
import { useActiveWallet, useBurner } from "@/lib/client/wallet";

const NAV = [
  { href: "/", label: "Feed" },
  { href: "/new", label: "Post" },
  { href: "/protect", label: "Protect" },
  { href: "/stats", label: "Stats" },
];

/** Devnet/mainnet is always visible and clearly coloured (spec 8). */
function ClusterBadge() {
  return (
    <span
      className={
        "num whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide " +
        (IS_DEVNET ? "bg-guard/15 text-guard ring-1 ring-guard/40" : "bg-bad/15 text-bad ring-1 ring-bad/50")
      }
      title={IS_DEVNET ? "Devnet: test money, nothing has real value" : "Mainnet: real USDC"}
    >
      {IS_DEVNET ? "devnet" : "mainnet"}
      <span className="hidden sm:inline">{IS_DEVNET ? " · test money" : " · real USDC"}</span>
    </span>
  );
}

export function WalletButton() {
  const active = useActiveWallet();
  const adapter = useWallet();
  const { setVisible } = useWalletModal();
  const { burner, funding, createBurner, forget, refund } = useBurner();
  const [open, setOpen] = useState(false);

  if (!active) {
    return (
      <div className="flex items-center gap-2">
        {IS_DEVNET && (
          <button
            onClick={() => void createBurner()}
            className="whitespace-nowrap rounded-md bg-yes px-3 py-1.5 text-sm font-semibold text-yes-ink"
            data-testid="burner-start"
          >
            Try it<span className="hidden sm:inline"> — instant wallet</span>
          </button>
        )}
        <button onClick={() => setVisible(true)} className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm ring-1 ring-line hover:bg-panel-2">
          Connect
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="num rounded-md px-3 py-1.5 text-sm ring-1 ring-line hover:bg-panel-2"
        data-testid="wallet-chip"
      >
        {active.kind === "burner" ? "⚡ " : ""}
        {shortAddr(active.publicKey.toBase58())}
        {active.kind === "burner" && funding === "funding" ? " · funding…" : ""}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-lg bg-panel p-3 text-sm ring-1 ring-line">
          <Link href={`/u/${active.publicKey.toBase58()}`} className="block py-1 hover:text-yes" onClick={() => setOpen(false)}>
            My profile
          </Link>
          {active.kind === "burner" ? (
            <>
              <p className="py-1 text-xs text-muted">
                Instant wallet: a devnet key stored in this browser only. Never send real funds to it.
              </p>
              <button className="block py-1 hover:text-yes" onClick={() => void refund()}>
                Top up test funds
              </button>
              <button className="block py-1 hover:text-yes" onClick={() => setVisible(true)}>
                Use a real wallet instead
              </button>
              <button className="block py-1 text-bad" onClick={() => (forget(), setOpen(false))}>
                Forget this wallet
              </button>
            </>
          ) : (
            <button className="block py-1 text-bad" onClick={() => (void adapter.disconnect(), setOpen(false))}>
              Disconnect
            </button>
          )}
          {burner && active.kind === "adapter" && <p className="pt-1 text-xs text-faint">Instant wallet kept for later.</p>}
        </div>
      )}
    </div>
  );
}

export function Header() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-4">
          <Link href="/" className="num text-lg font-bold tracking-tight">
            thesis<span className="text-yes">_</span>
          </Link>
          <nav className="hidden gap-3 text-sm sm:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={path === n.href ? "text-ink" : "text-muted hover:text-ink"}>
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <ClusterBadge />
          <WalletButton />
        </div>
      </div>
      <nav className="flex justify-around border-t border-line py-2 text-sm sm:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={path === n.href ? "text-ink" : "text-muted"}>
            {n.label}
          </Link>
        ))}
      </nav>
      <span className="sr-only">{CLUSTER}</span>
    </header>
  );
}
