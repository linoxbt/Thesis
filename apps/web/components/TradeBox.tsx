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
  }, [wallet, usdcMint, market, side, micro]);

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
      <div className="rounded-lg bg-panel-2 p-3 text-sm">
        {IS_DEVNET ? (
          <button onClick={() => void createBurner()} className="w-full rounded-md bg-yes py-2 font-semibold text-yes-ink">
            Get an instant wallet to trade (free test USDC)
          </button>
        ) : (
          <p className="text-muted">Connect a wallet to trade.</p>
        )}
      </div>
    );
  }

  const accent = kind === "protection" ? "guard" : side === "buy_yes" ? "yes" : "ink";
  return (
    <div className={"rounded-lg bg-panel-2 text-sm " + (compact ? "p-2" : "p-3")}>
      {kind === "conviction" && (
        <div className="mb-2 grid grid-cols-2 gap-1 rounded-md bg-bg p-1">
          {(["buy_yes", "buy_no"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={
                "rounded py-1.5 font-semibold " +
                (side === s ? (s === "buy_yes" ? "bg-yes text-yes-ink" : "bg-ink text-bg") : "text-muted hover:text-ink")
              }
            >
              {s === "buy_yes" ? "Back · YES" : "Challenge · NO"}
            </button>
          ))}
        </div>
      )}
      <label className="flex items-center gap-2 rounded-md bg-bg px-2 py-1.5 ring-1 ring-line focus-within:ring-muted">
        <span className="text-muted">Spend</span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          className="num w-full bg-transparent text-right outline-none"
          aria-label="Amount in USDC"
        />
        <span className="num text-muted">USDC</span>
      </label>
      <div className="num mt-2 min-h-[2.5rem] text-xs text-muted" data-testid="quote">
        {quoting && "Quoting…"}
        {!quoting && quote?.error && <span className="text-bad">{quote.error}</span>}
        {!quoting && quote && !quote.error && (
          <>
            <div>
              You get <span className="text-ink">{(Number(quote.output) / USDC).toFixed(2)}</span>{" "}
              {side.endsWith("yes") ? "YES" : "NO"} ·{" "}
              {kind === "protection" ? (
                <>
                  pays <span className="text-ink">{usdc(quote.output)}</span> if touched
                </>
              ) : (
                <>
                  pays <span className="text-ink">{usdc(quote.output)}</span> if {side === "buy_yes" ? "it hits" : "it misses"}
                </>
              )}
            </div>
            {quote.priceBefore !== null && quote.priceAfter !== null && (
              <div>
                YES {pct(quote.priceBefore)} → {pct(quote.priceAfter)}
                {quote.avgPriceBps !== null && <> · avg price {pct(quote.avgPriceBps)} per $1</>}
              </div>
            )}
          </>
        )}
      </div>
      {tooThin && (
        <p className="mt-1 text-xs text-guard">
          This pool is too thin for that size: it would move the price {(impact! / 100).toFixed(0)} points. Try a smaller amount.
        </p>
      )}
      <button
        onClick={() => void submit()}
        disabled={busy || !quote || !!quote.error || tooThin || quoting}
        className={
          "mt-2 w-full rounded-md py-2 font-semibold disabled:opacity-40 " +
          (accent === "guard" ? "bg-guard text-guard-ink" : accent === "yes" ? "bg-yes text-yes-ink" : "bg-ink text-bg")
        }
        data-testid="trade-submit"
      >
        {busy ? "Sending…" : kind === "protection" ? "Protect" : side === "buy_yes" ? "Back it" : "Challenge it"}
      </button>
      {kind === "protection" && (
        <p className="mt-2 text-[11px] leading-snug text-faint">
          Price-touch protection, paid at window end. Not a liquidation guarantee.
        </p>
      )}
    </div>
  );
}
