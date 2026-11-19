"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { checkStrike, openingPriceBps } from "@thesis/chain";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MAX_COVER_IMPACT_BPS, parseAmount, TradeBox } from "@/components/TradeBox";
import { usePoll } from "@/lib/client/api";
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
 * Buys into an open cover market near the liquidation price when there is
 * one; otherwise creates one (seeded by the trader) and buys cover on it in a
 * second transaction. A created market is remembered, so a failed cover buy
 * is retried on it rather than paying for another market.
 */

interface NearMarket {
  touch_market: string;
  pm_market: string;
  strike: string;
  expo: number;
  end_ts: string;
  yes_price_bps: number | null;
  initial_price_bps: number;
  thesis: string | null;
  thesis_creator: string | null;
}
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
  const [log, setLog] = useState<{ label: string; sig?: string; err?: string; note?: string; href?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  /** The market this page created, if its cover buy hasn't happened yet. */
  const [created, setCreated] = useState<{ key: string; touchMarket: PublicKey; pmMarket: PublicKey } | null>(null);
  const [pick, setPick] = useState<NearMarket | null>(null);

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
  const spendMicro = parseAmount(spend) ?? 0n;
  const seedMicro = parseAmount(seed) ?? 0n;
  const inputError = (() => {
    if (!config) return null;
    if (spendMicro === 0n) return "Enter how much to spend on cover.";
    if (spendMicro > BigInt(config.maxCoverUsdc)) return `Cover is capped at ${usdc(config.maxCoverUsdc)} per wallet.`;
    if (seedMicro < BigInt(config.minSeedUsdc) || seedMicro > BigInt(config.maxSeedUsdc))
      return `Seed between ${usdc(config.minSeedUsdc)} and ${usdc(config.maxSeedUsdc)}.`;
    return null;
  })();
  // Inputs the created market was made for: change any, and it no longer applies.
  const shapeKey = `${direction}:${strike}:${window}:${seedMicro}`;
  const pending = created && created.key === shapeKey ? created : null;

  // Open cover markets within 0.5% of the level, ending no earlier than half the chosen window.
  const [nearKey, setNearKey] = useState<string | null>(null);
  useEffect(() => {
    if (strike <= 0n) return setNearKey(null);
    const t = setTimeout(
      () => setNearKey(`direction=${direction}&strike=${strike}&end_after=${Math.floor(Date.now() / 1000) + Math.floor(window / 2)}`),
      500,
    );
    return () => clearTimeout(t);
  }, [direction, strike, window]);
  const { data: near } = usePoll<{ markets: NearMarket[] }>(nearKey ? `/api/markets?${nearKey}` : null, 30_000);
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
    if (!wallet || !usdcMint || !view || view.err || inputError) return;
    setBusy(true);
    setLog([]);
    try {
      let m = pending;
      if (!m) {
        const ixs = await createMarketInstructions(connection, {
          creator: wallet.publicKey,
          usdcMint,
          direction,
          strike,
          endTs: Math.floor(Date.now() / 1000) + window,
          seed: seedMicro,
          name: `SOL ${direction} ${liq} cover`,
        });
        const sig1 = await run("Create protection market", wallet, async () => toTx(ixs.ixs));
        m = { key: shapeKey, touchMarket: ixs.touchMarket, pmMarket: ixs.pmMarket };
        setCreated(m);
        setLog((l) => [...l, { label: "Protection market created", sig: sig1 }]);
      }
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
      setCreated(null);
      const page = m.touchMarket.toBase58();
      setLog((l) => [...l, { label: "Cover bought", sig: sig2, note: `Pays ${usdc(q.output)} if SOL touches ${usd(Number(liq))} before ${endLabel}.`, href: `/m/${page}` }]);
    } catch (e) {
      setLog((l) => [...l, { label: "Failed", err: (e as Error).message.split("\n")[0] }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <span className="label label-guard">Protection</span>
        <h1 className="display mt-2 text-4xl">Protect a position</h1>
        <p className="text-sm text-muted">No public call needed. Cover pays if SOL touches your liquidation price.</p>
      </div>
      <section className="space-y-3 panel border-guard/25 p-5">
        <div className="num text-xs text-muted">
          SOL now: <span className="text-ink">{spotUsd ? usd(spotUsd) : "…"}</span> (Pyth)
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-full border border-line bg-bg p-1">
          {(["long", "short"] as const).map((s) => (
            <button
              key={s}
              onClick={() => (setSide(s), setLiq(""), setPick(null))}
              disabled={busy}
              className={"rounded-full py-1.5 text-sm font-medium " + (side === s ? "bg-ink text-bg" : "text-muted hover:text-ink")}
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
            disabled={busy}
            className="num field mt-1 w-full px-3 py-2.5 outline-none"
          />
        </label>
        <div className="flex flex-wrap gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.secs}
              onClick={() => setWindow(w.secs)}
              disabled={busy}
              className={"num rounded-full px-3 py-1 text-xs " + (window === w.secs ? "bg-ink text-bg" : "border border-line text-muted hover:text-ink")}
            >
              {w.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">
            <span className="text-muted">Spend on cover</span>
            <input value={spend} disabled={busy} onChange={(e) => setSpend(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="num field mt-1 w-full px-3 py-2.5 outline-none" />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Seed the pool</span>
            <input value={seed} disabled={busy} onChange={(e) => setSeed(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="num field mt-1 w-full px-3 py-2.5 outline-none" />
          </label>
        </div>
        <div className="num rounded-xl border border-line bg-panel-2 p-3 text-sm" data-testid="protect-summary">
          {view?.err || inputError ? (
            <span className="text-bad">{view?.err ?? inputError}</span>
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
            <button onClick={() => void createBurner()} className="btn btn-primary w-full py-2.5">
              Get an instant wallet (free test USDC)
            </button>
          ) : (
            <p className="text-sm text-muted">Connect a wallet.</p>
          )
        ) : (
          <button
            onClick={() => void go()}
            disabled={busy || !view || !!view.err || !!inputError || !usdcMint}
            className="btn btn-primary w-full py-2.5 disabled:opacity-40"
            data-testid="protect-go"
          >
            {busy ? "Working…" : pending ? "Buy cover on the market you created" : "Create a cover market and protect me"}
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
            {l.href && (
              <Link href={l.href} className="text-xs text-ink underline decoration-brand underline-offset-4">
                Open your cover
              </Link>
            )}
          </div>
        ))}
      </section>
      {!!near?.markets.length && (
        <section className="panel space-y-3 p-5" data-testid="protect-nearby">
          <div>
            <span className="label label-guard">Already open</span>
            <p className="mt-1 text-sm text-muted">Cover near this level already exists. Buying in costs no market rent.</p>
          </div>
          <ul className="space-y-1.5">
            {near.markets.map((m) => (
              <li key={m.touch_market}>
                <button
                  onClick={() => setPick(pick?.touch_market === m.touch_market ? null : m)}
                  className={"num flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm " + (pick?.touch_market === m.touch_market ? "border-guard/50 bg-guard/5" : "border-line hover:border-line-2")}
                >
                  <span>Touches {usd(pythToNumber(m.strike, m.expo))}</span>
                  <span className="text-xs text-muted">
                    by {when(Number(m.end_ts))} · YES {pct(m.yes_price_bps ?? m.initial_price_bps)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {pick && (
            <TradeBox
              kind="protection"
              market={{ touchMarket: pick.touch_market, pmMarket: pick.pm_market, thesis: pick.thesis, thesisCreator: pick.thesis_creator }}
              onDone={() => setLog([{ label: "Cover bought", note: `On the existing market at ${usd(pythToNumber(pick.strike, pick.expo))}.`, href: `/m/${pick.touch_market}` }])}
            />
          )}
        </section>
      )}
    </div>
  );
}
