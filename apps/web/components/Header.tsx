"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Activity, BarChart3, LayoutGrid, PenLine, Shield, User, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { IS_DEVNET } from "@/lib/client/config";
import { ago, pythToNumber, shortAddr, usd } from "@/lib/client/format";
import { useSpot } from "@/lib/client/useConfig";
import { useActiveWallet, useBurner } from "@/lib/client/wallet";

const NAV = [
  { href: "/", label: "Feed", icon: LayoutGrid },
  { href: "/new", label: "Post a call", icon: PenLine },
  { href: "/protect", label: "Protect", icon: Shield },
  { href: "/stats", label: "Stats", icon: BarChart3 },
];

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-yes text-yes-ink">
        <Activity size={16} strokeWidth={2.5} />
      </span>
      <span className="display text-xl text-ink">Thesis</span>
    </Link>
  );
}

/** Devnet/mainnet is always visible and clearly coloured (spec 8). */
function ClusterBadge() {
  return (
    <span
      className={
        "num whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] uppercase tracking-wide " +
        (IS_DEVNET ? "bg-guard/10 text-guard ring-1 ring-guard/30" : "bg-bad/10 text-bad ring-1 ring-bad/40")
      }
      title={IS_DEVNET ? "Devnet: test money, nothing has real value" : "Mainnet: real USDC"}
    >
      {IS_DEVNET ? "devnet" : "mainnet"}
    </span>
  );
}

function SpotTicker() {
  const { data } = useSpot();
  if (!data) return <span className="num text-xs text-faint">SOL …</span>;
  return (
    <span className="num flex items-center gap-2 text-xs text-muted" title="Latest Pyth SOL/USD print onchain">
      <span className="h-1.5 w-1.5 rounded-full bg-yes shadow-[0_0_8px_var(--color-yes)]" />
      SOL <span className="text-ink">{usd(pythToNumber(data.price, data.expo))}</span>
      <span className="hidden text-faint md:inline">· Pyth · {ago(data.publishTime)}</span>
    </span>
  );
}

export function WalletButton() {
  const active = useActiveWallet();
  const adapter = useWallet();
  const { setVisible } = useWalletModal();
  const { funding, fundError, createBurner, forget, refund } = useBurner();
  const [open, setOpen] = useState(false);

  if (!active) {
    return (
      <div className="flex items-center gap-2">
        {IS_DEVNET && (
          <button onClick={() => void createBurner()} className="btn btn-yes whitespace-nowrap text-sm" data-testid="burner-start">
            <Zap size={14} className="-mt-0.5 mr-1 inline" />
            Try it<span className="hidden sm:inline"> free</span>
          </button>
        )}
        <button onClick={() => setVisible(true)} className="btn btn-ghost whitespace-nowrap text-sm">
          Connect
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="btn btn-ghost num text-sm" data-testid="wallet-chip">
        {active.kind === "burner" ? "⚡ " : ""}
        {shortAddr(active.publicKey.toBase58())}
        {active.kind === "burner" && funding === "funding" ? " · funding…" : ""}
        {active.kind === "burner" && funding === "error" ? <span className="text-bad"> · funding failed</span> : ""}
      </button>
      {open && (
        <div className="panel absolute right-0 z-30 mt-2 w-64 p-2 text-sm shadow-2xl">
          <Link
            href={`/u/${active.publicKey.toBase58()}`}
            className="block rounded-lg px-3 py-2 hover:bg-panel-2"
            onClick={() => setOpen(false)}
          >
            My profile
          </Link>
          {active.kind === "burner" ? (
            <>
              <p className="px-3 py-1 text-xs text-faint">
                Instant wallet: a devnet key stored in this browser only. Never send real funds to it.
              </p>
              {funding === "error" && <p className="px-3 py-1 text-xs text-bad">Funding failed: {fundError}</p>}
              <button className="block w-full rounded-lg px-3 py-2 text-left hover:bg-panel-2" onClick={() => void refund()}>
                Top up test funds
              </button>
              <button className="block w-full rounded-lg px-3 py-2 text-left hover:bg-panel-2" onClick={() => setVisible(true)}>
                Use a real wallet instead
              </button>
              <button className="block w-full rounded-lg px-3 py-2 text-left text-bad hover:bg-panel-2" onClick={() => (forget(), setOpen(false))}>
                Forget this wallet
              </button>
            </>
          ) : (
            <button
              className="block w-full rounded-lg px-3 py-2 text-left text-bad hover:bg-panel-2"
              onClick={() => (void adapter.disconnect(), setOpen(false))}
            >
              Disconnect
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NavLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: typeof LayoutGrid; active: boolean }) {
  return (
    <Link
      href={href}
      className={
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors " +
        (active ? "bg-panel-2 text-ink" : "text-muted hover:bg-panel-2/60 hover:text-ink")
      }
    >
      <Icon size={16} className={active ? "text-yes" : ""} />
      {label}
    </Link>
  );
}

/** Dashboard shell: sidebar on desktop, top bar + bottom tabs on phones. */
const TITLES: [RegExp, string][] = [
  [/^\/$/, "Live calls"],
  [/^\/new/, "Post a call"],
  [/^\/protect/, "Protect a position"],
  [/^\/stats/, "Traction"],
  [/^\/t\//, "Thesis"],
  [/^\/u\//, "Profile"],
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const title = TITLES.find(([r]) => r.test(path))?.[1];
  const active = useActiveWallet();
  const { createBurner } = useBurner();
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <div className="hidden border-r border-line lg:block">
      <aside className="sticky top-0 flex h-screen flex-col px-4 py-5">
        <Logo />
        <nav className="mt-8 space-y-1">
          {NAV.map((n) => (
            <NavLink key={n.href} {...n} active={isActive(n.href)} />
          ))}
          {active && (
            <NavLink
              href={`/u/${active.publicKey.toBase58()}`}
              label="My profile"
              icon={User}
              active={path.startsWith("/u/")}
            />
          )}
        </nav>
        <div className="mt-auto">
          {IS_DEVNET && (
            <div className="rounded-xl border border-line bg-panel p-3">
              <div className="flex items-center gap-2 text-sm text-ink">
                <Zap size={14} className="text-yes" /> Test money
              </div>
              <p className="mt-1 text-xs text-faint">Devnet: an instant wallet with free USDC. Nothing here has real value.</p>
              {!active && (
                <button onClick={() => void createBurner()} className="btn btn-yes mt-3 w-full text-xs">
                  Get an instant wallet
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
      </div>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 lg:px-8">
            <div className="flex items-center gap-4">
              <span className="lg:hidden">
                <Logo />
              </span>
              <span className="hidden text-sm text-ink lg:inline">{title}</span>
              <span className="hidden sm:inline">
                <SpotTicker />
              </span>
            </div>
            <div className="flex items-center gap-2">
              <ClusterBadge />
              <WalletButton />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 lg:px-8">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-line bg-bg/95 py-2 backdrop-blur lg:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={"flex flex-col items-center gap-0.5 text-[11px] " + (isActive(n.href) ? "text-yes" : "text-muted")}>
            <n.icon size={18} />
            {n.label.replace(" a call", "")}
          </Link>
        ))}
      </nav>
    </div>
  );
}
