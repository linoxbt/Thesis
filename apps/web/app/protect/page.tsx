"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { checkStrike, openingPriceBps } from "@thesis/chain";
import { useEffect, useMemo, useState } from "react";
import { MAX_COVER_IMPACT_BPS } from "@/components/TradeBox";
import { createMarketInstructions, quoteTrade, toTx, tradeInstructions } from "@/lib/client/actions";
import { explorerTx, IS_DEVNET, USDC } from "@/lib/client/config";
import { pct, pythToNumber, usd, usdc, when } from "@/lib/client/format";
import { useTx } from "@/lib/client/tx";
import { useConfig, useSpot } from "@/lib/client/useConfig";
import { useActiveWallet, useBurner } from "@/lib/client/wallet";

const WINDOWS = [
  ...(IS_DEVNET ? [{ label: "10 min (demo)", secs: 600 }] : []),
  { label: "24h", secs: 86_400 },
  { label: "48h", secs: 172_800 },
  { label: "7d", secs: 604_800 },
];

/**
 * Protect only (spec 8, screen 4): for traders who don't want to post a call.
 * Creates a protection market at the liquidation price (seeded by the trader)
 * and buys cover on it in a second transaction.
 */
export default function ProtectPage() {
  const { connection } = useConnection();
  const wallet = useActiveWallet();
  const { createBurner } = useBurner();
  const { config, usdcMint } = useConfig();
  const { data: spot } = useSpot();
  const { run } = useTx();
  const [side, setSide] = useState<"long" | "short">("long");
  const [liq, setLiq] = useState("");
  const [window, setWindow] = useState(WINDOWS[IS_DEVNET ? 2 : 1].secs);
  const [spend, setSpend] = useState("2");
  const [seed, setSeed] = useState("25");
  const [log, setLog] = useState<{ label: string; sig?: string; err?: string; note?: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const spotUsd = spot ? pythToNumber(spot.price, spot.expo) : null;
  const expo = spot?.expo ?? -8;
  const direction = side === "long" ? "below" : "above";
  useEffect(() => {
    if (spotUsd && !liq) setLiq((spotUsd * (side === "long" ? 0.95 : 1.05)).toFixed(2));
  }, [spotUsd, side, liq]);

  const strike = (() => {
    const n = Number(liq);
    return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n / 10 ** expo)) : 0n;
  })();
  const spendMicro = BigInt(Math.round((Number(spend) || 0) * USDC));
  const seedMicro = BigInt(Math.round((Number(seed) || 0) * USDC));
  const view = useMemo(() => {
    if (!spot || !config) return null;
    const open = openingPriceBps(Number(spot.price), Number(strike), config.solVolBps, window);
    const err = checkStrike(direction, BigInt(spot.price), strike, open, {
      minStrikeDistanceBps: config.minStrikeDistanceBps,
      maxStrikeDistanceBps: config.maxStrikeDistanceBps,
      minOpenBps: config.minOpenBps,
      maxOpenBps: config.maxOpenBps,
    });
    return { open, err };
  }, [spot, config, strike, window, direction]);
  const approxPayout = view?.open ? Number(spendMicro) / (view.open / 10_000) : 0;
  const endLabel = when(Math.floor(Date.now() / 1000) + window);

  const go = async () => {
    if (!wallet || !usdcMint || !view || view.err) return;
    setBusy(true);
    setLog([]);
    try {
      const m = await createMarketInstructions(connection, {
        creator: wallet.publicKey,
        usdcMint,
        direction,
        strike,
        endTs: Math.floor(Date.now() / 1000) + window,
        seed: seedMicro,
        name: `SOL ${direction} ${liq} cover`,
      });
      const sig1 = await run("Create protection market", wallet, async () => toTx(m.ixs));
      setLog((l) => [...l, { label: "Protection market created", sig: sig1 }]);
      const args = {
        trader: wallet.publicKey,
        usdcMint,
        thesis: null,
        touchMarket: m.touchMarket,
        pmMarket: m.pmMarket,
        side: "buy_yes" as const,
        amountIn: spendMicro,
        minOutput: 0n,
      };
      const q = await quoteTrade(connection, args);
      const impact = q.priceAfter !== null && q.priceBefore !== null ? Math.abs(q.priceAfter - q.priceBefore) : 0;
      if (q.error || impact > MAX_COVER_IMPACT_BPS) {
        setLog((l) => [...l, { label: "Cover not bought", err: q.error ?? `would move the pool ${(impact / 100).toFixed(0)} points; try a smaller amount or a bigger seed` }]);
        return;
      }
      const sig2 = await run(`Buy ${usdc(spendMicro)} of cover`, wallet, async () =>
        toTx(await tradeInstructions(connection, { ...args, minOutput: (q.output * 99n) / 100n })),
      );
      setLog((l) => [...l, { label: "Cover bought", sig: sig2, note: `Pays ${usdc(q.output)} if SOL touches ${usd(Number(liq))} before ${endLabel}.` }]);
    } catch (e) {
      setLog((l) => [...l, { label: "Failed", err: (e as Error).message.split("\n")[0] }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Protect a position</h1>
        <p className="text-sm text-muted">No public call needed. Cover pays if SOL touches your liquidation price.</p>
      </div>
      <section className="space-y-3 rounded-xl bg-panel p-4 ring-1 ring-guard/30">
        <div className="num text-xs text-muted">
          SOL now: <span className="text-ink">{spotUsd ? usd(spotUsd) : "…"}</span> (Pyth)
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-md bg-bg p-1">
          {(["long", "short"] as const).map((s) => (
            <button
              key={s}
              onClick={() => (setSide(s), setLiq(""))}
              className={"rounded py-1.5 text-sm font-semibold " + (side === s ? "bg-guard text-guard-ink" : "text-muted")}
            >
              I'm {s} SOL
            </button>
          ))}
        </div>
        <label className="block text-sm">
          <span className="text-muted">Liquidation price</span>
          <input
            value={liq}
            onChange={(e) => setLiq(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            className="num mt-1 w-full rounded-md bg-bg px-3 py-2 ring-1 ring-line outline-none focus:ring-muted"
          />
        </label>
        <div className="flex flex-wrap gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.secs}
              onClick={() => setWindow(w.secs)}
              className={"rounded-md px-3 py-1.5 text-sm ring-1 " + (window === w.secs ? "bg-panel-2 ring-muted" : "ring-line text-muted")}
            >
              {w.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">
            <span className="text-muted">Spend on cover</span>
            <input value={spend} onChange={(e) => setSpend(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="num mt-1 w-full rounded-md bg-bg px-3 py-2 ring-1 ring-line outline-none" />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Seed the pool</span>
            <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="num mt-1 w-full rounded-md bg-bg px-3 py-2 ring-1 ring-line outline-none" />
          </label>
        </div>
        <div className="num rounded-md bg-panel-2 p-3 text-sm" data-testid="protect-summary">
          {view?.err ? (
            <span className="text-bad">{view.err}</span>
          ) : view?.open ? (
            <>
              Pays about <strong>{usdc(approxPayout)}</strong> if SOL touches <strong>{usd(Number(liq))}</strong> before {endLabel}, costs{" "}
              <strong>{usdc(spendMicro)}</strong> (+ {usdc(seedMicro)} seed). Opening odds {pct(view.open, 2)}; the exact payout is quoted before you buy.
            </>
          ) : (
            "…"
          )}
        </div>
        <p className="text-[11px] text-faint">Price-touch protection, paid at window end. Not a liquidation guarantee.</p>
        {!wallet ? (
          IS_DEVNET ? (
            <button onClick={() => void createBurner()} className="w-full rounded-md bg-guard py-2.5 font-semibold text-guard-ink">
              Get an instant wallet (free test USDC)
            </button>
          ) : (
            <p className="text-sm text-muted">Connect a wallet.</p>
          )
        ) : (
          <button
            onClick={() => void go()}
            disabled={busy || !view || !!view.err || !usdcMint}
            className="w-full rounded-md bg-guard py-2.5 font-semibold text-guard-ink disabled:opacity-40"
          >
            {busy ? "Working…" : "Protect me"}
          </button>
        )}
        {log.map((l, i) => (
          <div key={i} className="text-sm">
            <span className={l.err ? "text-bad" : "text-ink"}>{l.err ? "✕ " : "✓ "}{l.label}</span>
            {l.sig && (
              <a href={explorerTx(l.sig)} target="_blank" rel="noreferrer" className="ml-2 text-xs underline text-muted">
                tx
              </a>
            )}
            {(l.note || l.err) && <div className="text-xs text-muted">{l.note ?? l.err}</div>}
          </div>
        ))}
      </section>
    </div>
  );
}
