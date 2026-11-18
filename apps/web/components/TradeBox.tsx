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
  onDone?: () => void;
}

/** Protection buys that move the pool more than this are refused (Phase 0 depth finding). */
export const MAX_COVER_IMPACT_BPS = 1_000;

export function TradeBox({ market, kind, initialSide = "buy_yes", compact, onDone }: Props) {
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

  const micro = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * USDC)) : 0n;
  }, [amount]);

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
  const tooThin = kind === "protection" && impact !== null && impact > MAX_COVER_IMPACT_BPS;

  const submit = async () => {
    if (!wallet || !args || !quote || quote.error) return;
    setBusy(true);
    try {
      const minOutput = (quote.output * 99n) / 100n; // 1% slippage
      const label =
        kind === "protection" ? `Protect ${usdc(micro)}` : `${side === "buy_yes" ? "Back" : "Challenge"} ${usdc(micro)}`;
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
          <button onClick={() => void createBurner()} className="btn btn-yes w-full">
            Get an instant wallet to trade (free test USDC)
          </button>
        ) : (
          <p className="text-muted">Connect a wallet to trade.</p>
        )}
      </div>
    );
  }

  const tokenLabel = side.endsWith("yes") ? "YES" : "NO";
  const btnClass = kind === "protection" ? "btn-guard" : side === "buy_yes" ? "btn-yes" : "bg-ink text-bg";
  return (
    <div className={"rounded-2xl border border-line bg-panel-2 text-sm " + (compact ? "p-2.5" : "p-3")}>
      {kind === "conviction" && (
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
          aria-label="Amount in USDC"
        />
        <span className="num flex items-center gap-1.5 rounded-full bg-panel-3 px-2 py-1 text-xs text-ink">
          <span className="h-3 w-3 rounded-full bg-[#2775ca]" /> USDC
        </span>
      </label>
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
            (kind === "protection" ? "bg-guard/15 text-guard" : tokenLabel === "YES" ? "bg-yes/15 text-yes" : "bg-panel-3 text-ink")
          }
        >
          {tokenLabel}
        </span>
      </div>
      <div className="num mt-2 min-h-[2.25rem] space-y-0.5 px-1 text-[11px] text-faint">
        {!quoting && quote?.error && <div className="text-bad">{quote.error}</div>}
        {!quoting && quote && !quote.error && (
          <>
            <div>
              pays <span className="text-muted">{usdc(quote.output)}</span>{" "}
              {kind === "protection" ? "if touched" : side === "buy_yes" ? "if it hits" : "if it misses"}
              {quote.avgPriceBps !== null && <> · avg {pct(quote.avgPriceBps)}</>}
            </div>
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
        {busy ? "Sending…" : kind === "protection" ? "Protect" : side === "buy_yes" ? "Back it" : "Challenge it"}
      </button>
      {kind === "protection" && (
        <p className="mt-2 px-1 text-[11px] leading-snug text-faint">Price-touch protection, paid at window end. Not a liquidation guarantee.</p>
      )}
    </div>
  );
}
