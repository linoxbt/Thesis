"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useMemo, useState } from "react";
import { quoteTrade, toTx, tradeInstructions, type Quote, type Side } from "@/lib/client/actions";
import { IS_DEVNET, USDC } from "@/lib/client/config";
import { pct, usdc } from "@/lib/client/format";
import { useTx } from "@/lib/client/tx";
import { useConfig } from "@/lib/client/useConfig";
import { useActiveWallet, useBurner } from "@/lib/client/wallet";

export interface MarketRef {
  touchMarket: string;
  pmMarket: string;
  thesis: string | null;
  thesisCreator: string | null;
}

interface Props {
  market: MarketRef;
  /** conviction: Back (YES) / Challenge (NO). protection: Protect (YES only). */
  kind: "conviction" | "protection";
  initialSide?: "buy_yes" | "buy_no";
  compact?: boolean;
  /** The wallet's YES/NO in this market; enables selling. */
  holdings?: { yes: bigint; no: bigint } | null;
  onDone?: () => void;
}

/** Parses a USDC/token amount: digits with at most 6 decimals, else null. */
export function parseAmount(s: string): bigint | null {
  if (!/^\d*(\.\d{0,6})?$/.test(s) || s === "" || s === ".") return null;
  const [w, f = ""] = s.split(".");
  const v = BigInt(w || "0") * BigInt(USDC) + BigInt((f + "000000").slice(0, 6));
  return v > 0n ? v : null;
}

/** Protection buys that move the pool more than this are refused (Phase 0 depth finding). */
export const MAX_COVER_IMPACT_BPS = 1_000;

export function TradeBox({ market, kind, initialSide = "buy_yes", compact, holdings, onDone }: Props) {
  const { connection } = useConnection();
  const wallet = useActiveWallet();
  const { createBurner } = useBurner();
  const { usdcMint } = useConfig();
  const { run } = useTx();
  const [side, setSide] = useState<Side>(kind === "protection" ? "buy_yes" : initialSide);
  const [amount, setAmount] = useState("5");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);

  const selling = side.startsWith("sell");
  const held = selling ? (side === "sell_yes" ? holdings?.yes : holdings?.no) ?? 0n : null;
  const canSell = !!holdings && (holdings.yes > 0n || (kind === "conviction" && holdings.no > 0n));
  // Back to buying if the position is gone (sold out, or wallet switched).
  useEffect(() => {
    if (selling && !canSell) setSide(kind === "protection" ? "buy_yes" : initialSide);
  }, [selling, canSell, kind, initialSide]);
  const parsed = parseAmount(amount);
  const overHeld = held !== null && parsed !== null && parsed > held;
  const micro = parsed !== null && !overHeld ? parsed : 0n;
  const setMode = (sell: boolean) => {
    if (sell) {
      const s: Side = kind === "conviction" && !(holdings?.yes ?? 0n) ? "sell_no" : "sell_yes";
      setSide(s);
      const h = s === "sell_yes" ? holdings?.yes : holdings?.no;
      setAmount(h ? (Number(h) / USDC).toFixed(2) : "");
    } else {
      setSide(kind === "protection" ? "buy_yes" : initialSide);
      setAmount("5");
    }
  };

  const args = useMemo(() => {
    if (!wallet || !usdcMint || micro === 0n) return null;
    return {
      trader: wallet.publicKey,
      usdcMint,
      thesis: market.thesis ? new PublicKey(market.thesis) : null,
      thesisCreator: market.thesisCreator ? new PublicKey(market.thesisCreator) : undefined,
      touchMarket: new PublicKey(market.touchMarket),
      pmMarket: new PublicKey(market.pmMarket),
      side,
      amountIn: micro,
      minOutput: 0n,
    };
    // Keyed on the market's addresses, not the object: parents re-render every
    // second (countdowns) with a fresh object, which would cancel each quote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, usdcMint, market.touchMarket, market.pmMarket, market.thesis, market.thesisCreator, side, micro]);

  // Exact quote by simulation, debounced.
  useEffect(() => {
    setQuote(null);
    if (!args) return;
    let live = true;
    setQuoting(true);
    const t = setTimeout(() => {
      quoteTrade(connection, args)
        .then((q) => live && setQuote(q))
        .catch((e) => live && setQuote({ output: 0n, priceBefore: null, priceAfter: null, avgPriceBps: null, error: (e as Error).message }))
        .finally(() => live && setQuoting(false));
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [args, connection]);

  const impact = quote && quote.priceAfter !== null && quote.priceBefore !== null ? Math.abs(quote.priceAfter - quote.priceBefore) : null;
  const tooThin = kind === "protection" && !selling && impact !== null && impact > MAX_COVER_IMPACT_BPS;

  const submit = async () => {
    if (!wallet || !args || !quote || quote.error) return;
    setBusy(true);
    try {
      const minOutput = (quote.output * 99n) / 100n; // 1% slippage
      const tokens = (Number(micro) / USDC).toFixed(2);
      const label = selling
        ? `Sell ${tokens} ${side === "sell_yes" ? "YES" : "NO"}`
        : kind === "protection"
          ? `Protect ${usdc(micro)}`
          : `${side === "buy_yes" ? "Back" : "Challenge"} ${usdc(micro)}`;
      await run(label, wallet, async () => toTx(await tradeInstructions(connection, { ...args, minOutput })));
      onDone?.();
    } catch {
      /* shown in the toast */
    } finally {
      setBusy(false);
    }
  };

  if (!wallet) {
    return (
      <div className="rounded-2xl border border-line bg-panel-2 p-3 text-sm">
        {IS_DEVNET ? (
          <button onClick={() => void createBurner()} className="btn btn-primary w-full">
            Get an instant wallet to trade (free test USDC)
          </button>
        ) : (
          <p className="text-muted">Connect a wallet to trade.</p>
        )}
      </div>
    );
  }

  const tokenLabel = side.endsWith("yes") ? "YES" : "NO";
  const btnClass = selling ? "bg-ink text-bg" : kind === "protection" ? "btn-primary" : side === "buy_yes" ? "btn-yes" : "bg-ink text-bg";
  const inLabel = selling ? tokenLabel : "USDC";
  const outLabel = selling ? "USDC" : tokenLabel;
  return (
    <div className={"rounded-2xl border border-line bg-panel-2 text-sm " + (compact ? "p-2.5" : "p-3")}>
      {canSell && (
        <div className="mb-2 flex gap-3 px-1 text-xs" role="tablist" aria-label="Buy or sell">
          {([false, true] as const).map((sell) => (
            <button
              key={String(sell)}
              role="tab"
              aria-selected={selling === sell}
              onClick={() => selling !== sell && setMode(sell)}
              className={selling === sell ? "font-medium text-ink" : "text-faint hover:text-ink"}
              data-testid={sell ? "mode-sell" : "mode-buy"}
            >
              {sell ? "Sell" : "Buy"}
            </button>
          ))}
        </div>
      )}
      {selling && kind === "conviction" && (holdings?.yes ?? 0n) > 0n && (holdings?.no ?? 0n) > 0n && (
        <div className="mb-2 grid grid-cols-2 gap-1 rounded-full border border-line bg-bg p-1">
          {(["sell_yes", "sell_no"] as const).map((s) => (
            <button
              key={s}
              onClick={() => (setSide(s), setAmount((Number((s === "sell_yes" ? holdings!.yes : holdings!.no)) / USDC).toFixed(2)))}
              className={"rounded-full py-1.5 text-xs font-medium " + (side === s ? "bg-ink text-bg" : "text-muted hover:text-ink")}
            >
              {s === "sell_yes" ? "Sell YES" : "Sell NO"}
            </button>
          ))}
        </div>
      )}
      {!selling && kind === "conviction" && (
        <div className="mb-2 grid grid-cols-2 gap-1 rounded-full border border-line bg-bg p-1">
          {(["buy_yes", "buy_no"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={
                "rounded-full py-1.5 text-xs font-medium transition-colors " +
                (side === s ? (s === "buy_yes" ? "bg-yes text-yes-ink" : "bg-ink text-bg") : "text-muted hover:text-ink")
              }
            >
              {s === "buy_yes" ? "Back · YES" : "Challenge · NO"}
            </button>
          ))}
        </div>
      )}
      <label className="field flex items-center gap-2 px-3 py-2.5">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          className="num w-full bg-transparent text-base outline-none"
          aria-label={`Amount in ${inLabel}`}
          aria-invalid={parsed === null || overHeld}
        />
        {held !== null && (
          <button type="button" onClick={() => setAmount((Number(held) / USDC).toFixed(6).replace(/\.?0+$/, ""))} className="text-[11px] text-muted underline hover:text-ink">
            Max
          </button>
        )}
        <span className="num flex items-center gap-1.5 rounded-full bg-panel-3 px-2 py-1 text-xs text-ink">
          {!selling && <span className="h-3 w-3 rounded-full bg-[#2775ca]" />} {inLabel}
        </span>
      </label>
      {amount !== "" && parsed === null && <p className="mt-1 px-1 text-[11px] text-bad">Enter an amount, up to 6 decimals.</p>}
      {overHeld && <p className="mt-1 px-1 text-[11px] text-bad">You hold {(Number(held) / USDC).toFixed(2)} {tokenLabel}.</p>}
      <div className="relative z-10 -my-1.5 flex justify-center">
        <span className="grid h-6 w-6 place-items-center rounded-full border border-line bg-panel-2 text-xs text-muted">↓</span>
      </div>
      <div className="field flex items-center gap-2 px-3 py-2.5" data-testid="quote">
        <span className="num w-full text-base text-ink">
          {quoting ? <span className="text-faint">quoting…</span> : quote && !quote.error ? (Number(quote.output) / USDC).toFixed(2) : <span className="text-faint">0.00</span>}
        </span>
        <span
          className={
            "num rounded-full px-2 py-1 text-xs " +
            (selling ? "bg-panel-3 text-ink" : kind === "protection" ? "bg-guard/15 text-guard" : tokenLabel === "YES" ? "bg-yes/15 text-yes" : "bg-panel-3 text-ink")
          }
        >
          {outLabel}
        </span>
      </div>
      <div className="num mt-2 min-h-[2.25rem] space-y-0.5 px-1 text-[11px] text-faint">
        {!quoting && quote?.error && <div className="text-bad">{quote.error}</div>}
        {!quoting && quote && !quote.error && (
          <>
            {selling ? (
              <div>
                you receive <span className="text-muted">{usdc(quote.output)}</span> now
                {micro > 0n && <> · {pct(Number((quote.output * 10_000n) / micro))} per token</>}
              </div>
            ) : (
              <div>
                pays <span className="text-muted">{usdc(quote.output)}</span>{" "}
                {kind === "protection" ? "if touched" : side === "buy_yes" ? "if it hits" : "if it misses"}
                {quote.avgPriceBps !== null && <> · avg {pct(quote.avgPriceBps)}</>}
              </div>
            )}
            {quote.priceBefore !== null && quote.priceAfter !== null && (
              <div>
                YES {pct(quote.priceBefore)} → <span className="text-muted">{pct(quote.priceAfter)}</span> · 2% fee incl.
              </div>
            )}
          </>
        )}
      </div>
      {tooThin && (
        <p className="mt-1 px-1 text-xs text-guard">
          Pool too thin for that size: it would move the price {(impact! / 100).toFixed(0)} points. Try a smaller amount.
        </p>
      )}
      <button
        onClick={() => void submit()}
        disabled={busy || !quote || !!quote.error || tooThin || quoting}
        className={"btn mt-2 w-full disabled:opacity-40 " + btnClass}
        data-testid="trade-submit"
      >
        {busy ? "Sending…" : selling ? `Sell ${tokenLabel}` : kind === "protection" ? "Protect" : side === "buy_yes" ? "Back it" : "Challenge it"}
      </button>
      {kind === "protection" && (
        <p className="mt-2 px-1 text-[11px] leading-snug text-faint">Price-touch protection, paid at window end. Not a liquidation guarantee.</p>
      )}
    </div>
  );
}
