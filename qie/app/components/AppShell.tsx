"use client";

import { ArrowLeft, ArrowUpRight, BarChart3, Coins, LayoutGrid, LogOut, PanelLeftClose, PanelLeftOpen, PenLine, Trophy, User } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { readBalances } from "@/lib/chain";
import { IS_MAINNET, NETWORK, QIE_WALLET_URL, QUSDC_URL } from "@/lib/config";
import { useData } from "@/lib/data";
import { ago, qusdc, shortAddr } from "@/lib/format";
import { explain, useWallet } from "@/lib/wallet";
import { Logo } from "./Brand";
import { usdPx } from "./Position";
import { StatusBanner } from "./StatusBanner";

const NAV: { href: string; label: string; short?: string; icon: typeof User; mobile?: boolean }[] = [
  { href: "/app/", label: "Markets", icon: LayoutGrid },
  { href: "/leaderboard/", label: "Leaderboard", short: "Leaders", icon: Trophy },
  { href: "/new/", label: "Post a trade", short: "Post", icon: PenLine },
  { href: "/stats/", label: "Stats", icon: BarChart3 },
  { href: "/profile/", label: "Profile", icon: User },
];

/** Which QIE network, always visible: mainnet means real QUSDC. */
function ClusterBadge() {
  return (
    <span
      className={
        "num whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide sm:px-2.5 sm:py-1 sm:text-[11px] " +
        (IS_MAINNET ? "bg-bad/10 text-bad ring-1 ring-bad/40" : "badge-devnet ring-1")
      }
      title={IS_MAINNET ? "QIE mainnet: real QUSDC" : `QIE ${NETWORK}: test funds, nothing has real value`}
      data-testid="network-badge"
    >
      QIE {NETWORK}
    </span>
  );
}

/** Latest QIE Oracle prints: SOL always, BTC and ETH on wider screens. */
function SpotTicker() {
  const { feeds } = useData();
  if (!feeds.length) return <span className="num text-xs text-faint">QIE Oracle …</span>;
  const order = ["SOL", "BTC", "ETH"];
  const sorted = [...feeds].sort((a, b) => order.indexOf(a.asset) - order.indexOf(b.asset));
  const latest = Math.max(...feeds.map((f) => f.updatedAt));
  return (
    <span className="num flex items-center gap-2 text-xs text-muted" title="Latest QIE Oracle prices onchain" data-testid="oracle-prices">
      <span className="h-1.5 w-1.5 rounded-full bg-brand" />
      {sorted.map((f, i) => (
        <span key={f.address} className={i === 0 ? "" : "hidden xl:inline"}>
          {f.asset} <span className="text-ink">{usdPx(Number(f.price) / 10 ** f.decimals)}</span>
        </span>
      ))}
      <span className="hidden text-faint md:inline">· QIE Oracle · {ago(latest)}</span>
    </span>
  );
}

export function WalletButton() {
  const w = useWallet();
  const { stakeToken } = useData();
  const [open, setOpen] = useState(false);
  const [bal, setBal] = useState<{ usd: bigint; gas: bigint } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const menu = useRef<HTMLDivElement>(null);

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

  if (!w.account) {
    return (
      <div className="relative flex items-center gap-2">
        {w.available ? (
          <button onClick={() => w.connect().catch((e) => setErr(explain(e)))} className="btn btn-ghost whitespace-nowrap text-sm" data-testid="connect">
            Connect
          </button>
        ) : (
          <a href={QIE_WALLET_URL} target="_blank" rel="noreferrer" className="btn btn-primary whitespace-nowrap text-sm">
            Get QIE Wallet
          </a>
        )}
        {err && <span className="absolute right-0 top-full mt-1 w-56 text-right text-[11px] text-bad">{err}</span>}
      </div>
    );
  }
  return (
    <div className="relative" ref={menu}>
      <button onClick={() => setOpen((o) => !o)} className="btn btn-ghost num text-sm" data-testid="account">
        {shortAddr(w.account)}
        {!w.chainOk && <span className="text-bad"> · wrong network</span>}
      </button>
      {open && (
        <div className="panel absolute right-0 z-30 mt-2 w-64 p-2 text-sm shadow-2xl">
          <div className="px-3 py-2 text-xs text-faint">
            {w.walletName}
            {bal && (
              <span className="num mt-1 block text-ink">
                {qusdc(bal.usd)} QUSDC · {(Number(bal.gas) / 1e18).toFixed(3)} QIE
              </span>
            )}
          </div>
          <Link href="/profile/" className="block rounded-lg px-3 py-2 hover:bg-panel-2" onClick={() => setOpen(false)} data-testid="wallet-menu-profile">
            Profile
          </Link>
          <a href={QUSDC_URL} target="_blank" rel="noreferrer" className="block rounded-lg px-3 py-2 hover:bg-panel-2">
            Get QUSDC
          </a>
          <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-bad hover:bg-panel-2" onClick={() => (w.disconnect(), setOpen(false))}>
            <LogOut size={13} /> Disconnect
          </button>
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

const TITLES: [RegExp, string][] = [
  [/^\/app\/?$/, "Markets"],
  [/^\/new/, "Post a trade"],
  [/^\/stats/, "Traction"],
  [/^\/leaderboard/, "Leaderboard"],
  [/^\/t(\/|$)/, "Trade"],
  [/^\/u(\/|$)/, "Profile"],
  [/^\/profile/, "Profile"],
];

const strip = (p: string) => (p.length > 1 ? p.replace(/\/$/, "") : p);

/** Dashboard shell: sidebar on desktop, top bar + bottom tabs on phones. */
export function AppShell({ children }: { children: ReactNode }) {
  const path = strip(usePathname());
  const title = TITLES.find(([r]) => r.test(path))?.[1];
  const isActive = (href: string) => path === strip(href) || path.startsWith(strip(href) + "/");
  // Detail pages (a trade, someone's profile) are full-screen on phones: no
  // tab bar, a back button instead.
  const detail = /^\/(t|u)$/.test(path);
  const router = useRouter();
  const back = () => (window.history.length > 1 ? router.back() : router.push("/app/"));
  // Desktop sidebar: full or an icon rail; remembered per browser. The
  // pre-hydration script sets html.sb-collapsed, which sizes the grid in CSS
  // before React runs; the rail's contents follow once mounted.
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
    <div className="app-shell min-h-screen lg:grid lg:transition-[grid-template-columns] lg:duration-200" data-sidebar={collapsed ? "collapsed" : "open"}>
      <div className="hidden border-r border-line lg:block">
        <aside className={"sticky top-0 z-30 flex h-screen flex-col py-5 " + (collapsed ? "items-stretch px-2.5" : "px-4") + (mounted ? "" : " invisible")}>
          <div className={"flex items-center " + (collapsed ? "relative h-[26px]" : "justify-between")}>
            {collapsed ? (
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
              <button onClick={toggle} className="grid h-9 w-9 place-items-center rounded-lg text-faint hover:bg-panel-2 hover:text-ink" aria-label="Expand sidebar" title="Expand sidebar" data-testid="sidebar-toggle">
                <PanelLeftOpen size={16} />
              </button>
            </div>
          ) : (
            <div className="mt-auto">
              <div className="rounded-xl border border-line bg-panel p-3">
                <div className="flex items-center gap-2 text-sm text-ink">
                  <Coins size={14} className="text-brand" /> {IS_MAINNET ? "Real QUSDC" : "Test QUSDC"}
                </div>
                <p className="mt-1 text-xs text-faint">
                  {IS_MAINNET
                    ? "QIE mainnet: seeds, bets and payouts are in QUSDC. Gas is paid in QIE."
                    : `QIE ${NETWORK}: test tokens only. Nothing here has real value.`}
                </p>
                <a href={QUSDC_URL} target="_blank" rel="noreferrer" className="btn btn-primary mt-3 w-full text-xs">
                  Get QUSDC
                </a>
              </div>
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
