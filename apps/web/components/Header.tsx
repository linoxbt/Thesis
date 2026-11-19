"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { ArrowLeft, ArrowUpRight, BarChart3, PanelLeftClose, PanelLeftOpen, LayoutGrid, PenLine, Shield, Trophy, User, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IS_DEVNET } from "@/lib/client/config";
import { Logo } from "./Brand";
import { StatusBanner } from "./StatusBanner";
import { ago, pythToNumber, shortAddr, usd } from "@/lib/client/format";
import { useSpot } from "@/lib/client/useConfig";
import { useActiveWallet, useBurner } from "@/lib/client/wallet";

const NAV: { href: string; label: string; short?: string; icon: typeof User; mobile?: boolean }[] = [
  { href: "/app", label: "Markets", icon: LayoutGrid },
  { href: "/leaderboard", label: "Leaderboard", short: "Leaders", icon: Trophy },
  { href: "/new", label: "Post a trade", short: "Post", icon: PenLine },
  { href: "/protect", label: "Protect", icon: Shield },
  // Five tabs fit a phone; Stats is linked from the leaderboard there.
  { href: "/stats", label: "Stats", icon: BarChart3, mobile: false },
  { href: "/profile", label: "Profile", icon: User },
];

/** Devnet/mainnet is always visible and clearly coloured (spec 8). */
function ClusterBadge() {
  return (
    <span
      className={
        "num whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide sm:px-2.5 sm:py-1 sm:text-[11px] " +
        (IS_DEVNET ? "badge-devnet ring-1" : "bg-bad/10 text-bad ring-1 ring-bad/40")
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
      <span className="h-1.5 w-1.5 rounded-full bg-brand" />
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
  const menu = useRef<HTMLDivElement>(null);
  // The menu closes on any click outside it, or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => menu.current && !menu.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const confirmForget = () => {
    const ok = window.confirm(
      "Forget this instant wallet? Its key exists only in this browser: its devnet funds and positions can't be recovered afterwards.",
    );
    if (ok) forget();
    setOpen(false);
  };

  if (!active) {
    return (
      <div className="flex items-center gap-2">
        {IS_DEVNET && (
          <button onClick={() => void createBurner()} className="btn btn-primary whitespace-nowrap text-sm" data-testid="burner-start">
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
    <div className="relative" ref={menu}>
      <button onClick={() => setOpen((o) => !o)} className="btn btn-ghost num text-sm" data-testid="wallet-chip">
        {active.kind === "burner" ? "⚡ " : ""}
        {shortAddr(active.publicKey.toBase58())}
        {active.kind === "burner" && funding === "funding" ? " · funding…" : ""}
        {active.kind === "burner" && funding === "error" ? <span className="text-bad"> · funding failed</span> : ""}
      </button>
      {open && (
        <div className="panel absolute right-0 z-30 mt-2 w-64 p-2 text-sm shadow-2xl">
          <Link
            href="/profile"
            className="block rounded-lg px-3 py-2 hover:bg-panel-2"
            onClick={() => setOpen(false)}
            data-testid="wallet-menu-profile"
          >
            Profile
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
              <button className="block w-full rounded-lg px-3 py-2 text-left text-bad hover:bg-panel-2" onClick={confirmForget}>
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

function NavLink({ href, label, icon: Icon, active, collapsed }: { href: string; label: string; icon: typeof LayoutGrid; active: boolean; collapsed: boolean }) {
  return (
    <Link
      href={href}
      aria-label={collapsed ? label : undefined}
      className={
        "group relative flex items-center gap-3 rounded-lg py-2 text-sm transition-colors " +
        (collapsed ? "justify-center px-0 " : "px-3 ") +
        (active ? "bg-panel-2 text-ink" : "text-muted hover:bg-panel-2/60 hover:text-ink")
      }
    >
      <Icon size={16} className={active ? "text-brand" : ""} />
      {!collapsed && label}
      {collapsed && (
        <span className="pointer-events-none absolute left-full z-40 ml-3 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs text-bg opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
          {label}
        </span>
      )}
    </Link>
  );
}

const COLLAPSE_KEY = "thesis-sidebar-collapsed";

/** Dashboard shell: sidebar on desktop, top bar + bottom tabs on phones. */
const TITLES: [RegExp, string][] = [
  [/^\/app$/, "Markets"],
  [/^\/new/, "Post a trade"],
  [/^\/protect/, "Protect a position"],
  [/^\/stats/, "Traction"],
  [/^\/leaderboard/, "Leaderboard"],
  [/^\/t\//, "Trade"],
  [/^\/u\//, "Profile"],
  [/^\/profile/, "Profile"],
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const title = TITLES.find(([r]) => r.test(path))?.[1];
  const active = useActiveWallet();
  const { createBurner } = useBurner();
  const isActive = (href: string) => path === href || path.startsWith(href + "/");
  // Detail pages (a trade, someone's profile) are full-screen on phones: no
  // tab bar, a back button instead.
  const detail = /^\/(t|u|m)\//.test(path);
  const router = useRouter();
  const back = () => (window.history.length > 1 ? router.back() : router.push("/app"));
  // Desktop sidebar: full or an icon rail; remembered per browser.
  // The pre-hydration script sets html.sb-collapsed, which sizes the grid in
  // CSS before React runs; the rail's contents follow once mounted.
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setCollapsed(document.documentElement.classList.contains("sb-collapsed"));
    setMounted(true);
  }, []);
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {}
      document.documentElement.classList.toggle("sb-collapsed", !c);
      return !c;
    });
  return (
    <div
      className={
        "app-shell min-h-screen lg:grid lg:transition-[grid-template-columns] lg:duration-200"
      }
      data-sidebar={collapsed ? "collapsed" : "open"}
    >
      <div className="hidden border-r border-line lg:block">
      <aside className={"sticky top-0 z-30 flex h-screen flex-col py-5 " + (collapsed ? "items-stretch px-2.5" : "px-4") + (mounted ? "" : " invisible")}>
        <div className={"flex items-center " + (collapsed ? "relative h-[26px]" : "justify-between")}>
          {collapsed ? (
            // Same place as when open (16px in, 20px down); the name extends
            // over the top bar, on the page colour so the rail's border doesn't cross it.
            <div className="absolute left-[6px] top-px z-30 flex items-center bg-bg pr-3" data-testid="rail-logo">
              <Logo href="/" />
            </div>
          ) : (
            <Logo href="/" />
          )}
          {!collapsed && (
            <button onClick={toggle} className="rounded-md p-1.5 text-faint hover:bg-panel-2 hover:text-ink" aria-label="Collapse sidebar" title="Collapse sidebar" data-testid="sidebar-toggle">
              <PanelLeftClose size={16} />
            </button>
          )}
        </div>
        <nav className="mt-8 space-y-1">
          {NAV.map((n) => (
            <NavLink key={n.href} {...n} active={isActive(n.href)} collapsed={collapsed} />
          ))}
        </nav>
        {collapsed ? (
          <div className="mt-auto flex flex-col items-center gap-2">
            {IS_DEVNET && !active && (
              <button onClick={() => void createBurner()} className="grid h-9 w-9 place-items-center rounded-lg bg-ink text-bg" title="Get an instant wallet" aria-label="Get an instant wallet">
                <Zap size={15} />
              </button>
            )}
            <button onClick={toggle} className="grid h-9 w-9 place-items-center rounded-lg text-faint hover:bg-panel-2 hover:text-ink" aria-label="Expand sidebar" title="Expand sidebar" data-testid="sidebar-toggle">
              <PanelLeftOpen size={16} />
            </button>
          </div>
        ) : (
        <div className="mt-auto">
          {IS_DEVNET && (
            <div className="rounded-xl border border-line bg-panel p-3">
              <div className="flex items-center gap-2 text-sm text-ink">
                <Zap size={14} className="text-brand" /> Test money
              </div>
              <p className="mt-1 text-xs text-faint">Devnet: an instant wallet with free USDC. Nothing here has real value.</p>
              {!active && (
                <button onClick={() => void createBurner()} className="btn btn-primary mt-3 w-full text-xs">
                  Get an instant wallet
                </button>
              )}
            </div>
          )}
          <Link href="/" className="mt-3 flex items-center gap-1 px-1 text-xs text-faint hover:text-ink">
            About Thesis <ArrowUpRight size={12} />
          </Link>
        </div>
        )}
      </aside>
      </div>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
          <div className={"mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 lg:px-8 " + (collapsed ? "lg:pl-24" : "")}>
            <div className="flex items-center gap-4">
              {detail && (
                <button onClick={back} className="-ml-1 grid h-9 w-9 place-items-center rounded-full text-ink hover:bg-panel-2 lg:hidden" aria-label="Back" data-testid="mobile-back">
                  <ArrowLeft size={18} />
                </button>
              )}
              <span className={detail ? "hidden sm:inline lg:hidden" : "lg:hidden"}>
                <Logo href="/" size={20} text="text-[19px]" />
              </span>
              {detail && <span className="text-sm font-medium text-ink sm:hidden">{title}</span>}
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
        <main className={"mx-auto max-w-6xl px-4 pt-6 lg:px-8 " + (detail ? "pb-12" : "pb-28")}>
          <StatusBanner />
          {children}
        </main>
      </div>

      <nav className={"fixed inset-x-0 bottom-0 z-20 justify-around border-t border-line bg-bg/95 py-2 backdrop-blur lg:hidden " + (detail ? "hidden" : "flex")} data-testid="tab-bar">
        {NAV.filter((n) => n.mobile !== false).map((n) => (
          <Link key={n.href} href={n.href} className={"flex flex-col items-center gap-0.5 text-[11px] " + (isActive(n.href) ? "text-ink" : "text-faint")}>
            <n.icon size={18} />
            {n.short ?? n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
