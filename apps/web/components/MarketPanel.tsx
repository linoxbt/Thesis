"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";
import { claimWinningsInstructions, positions, proveTransaction, toTx } from "@/lib/client/actions";
import { useNow } from "@/lib/client/api";
import { explorerTx, USDC } from "@/lib/client/config";
import { pct, pythToNumber, timeLeft, usd, usdc, when } from "@/lib/client/format";
import { useTx } from "@/lib/client/tx";
import { useConfig } from "@/lib/client/useConfig";
import { useActiveWallet } from "@/lib/client/wallet";
import { LineChart } from "./LineChart";
import { Delta } from "./ThesisCard";
import { TradeBox } from "./TradeBox";

export interface MarketRow {
  touch_market: string;
  pm_market: string;
  direction: "above" | "below";
  strike: string;
  expo: number;
  start_ts: string;
  end_ts: string;
  initial_price_bps: number;
  yes_price_bps: number | null;
  touched: boolean;
  touch_price: string | null;
  touch_publish_time: string | null;
  proof_tx: string | null;
  settled: boolean;
  winning_side: number;
}

const REASONS: Record<string, string> = {
  NoTouch: "Pyth's latest SOL price hasn't crossed the strike.",
  OutsideWindow: "Pyth's latest SOL price is from outside this market's window.",
  ConfTooWide: "Pyth's latest print is too noisy (wide confidence) to count.",
  NotFullyVerified: "Pyth's latest print isn't fully verified.",
  AlreadyFinal: "Already proven or settled.",
  FuturePrice: "That price is ahead of the chain clock; try again in a few seconds.",
};

export function MarketPanel({
  kind,
  m,
  prices,
  thesis,
  creator,
  onChange,
}: {
  kind: "conviction" | "protection";
  m: MarketRow;
  prices: { ts: string; yes_price_bps: number }[];
  thesis: string;
  creator: string;
  onChange: () => void;
}) {
  const { connection } = useConnection();
  const wallet = useActiveWallet();
  const { usdcMint, config } = useConfig();
  const { run } = useTx();
  const now = useNow(1000);
  const [pos, setPos] = useState<{ yes: bigint; no: bigint } | null>(null);
  const [proveMsg, setProveMsg] = useState<string | null>(null);
  const endTs = Number(m.end_ts);
  const settleAt = endTs + (config?.graceSecs ?? 120);
  const strike = pythToNumber(m.strike, m.expo);
  const yes = m.yes_price_bps ?? m.initial_price_bps;
  const markColor = kind === "protection" ? "var(--color-guard-mark)" : "var(--color-yes-mark)";

  const loadPos = useCallback(async () => {
    if (!wallet || !usdcMint) return setPos(null);
    const p = await positions(connection, wallet.publicKey, new PublicKey(m.pm_market), usdcMint);
    setPos({ yes: p.yes, no: p.no });
  }, [wallet, usdcMint, connection, m.pm_market]);

  useEffect(() => {
    void loadPos();
    const t = setInterval(() => document.visibilityState === "visible" && void loadPos(), 15_000);
    return () => clearInterval(t);
  }, [loadPos]);

  const prove = async () => {
    if (!wallet) return;
    setProveMsg(null);
    try {
      const r = await proveTransaction(new PublicKey(m.touch_market), wallet.publicKey);
      if (!r.tx) {
        const seen = r.price ? ` (latest: ${usd(pythToNumber(r.price, m.expo))} at ${when(r.publishTime!)})` : "";
        setProveMsg((REASONS[r.reason ?? ""] ?? r.reason ?? "Not provable yet.") + seen);
        return;
      }
      await run("Prove the touch", wallet, async () => r.tx!);
      onChange();
    } catch (e) {
      setProveMsg((e as Error).message);
    }
  };

  const claim = async () => {
    if (!wallet || !usdcMint) return;
    try {
      await run("Claim winnings", wallet, async () =>
        toTx(await claimWinningsInstructions(connection, { owner: wallet.publicKey, usdcMint, pmMarket: new PublicKey(m.pm_market) })),
      );
      await loadPos();
    } catch {
      /* toast */
    }
  };

  const winning = m.settled ? (m.winning_side === 1 ? pos?.yes : pos?.no) ?? 0n : 0n;
  const open = !m.touched && !m.settled && endTs > now;
  const title =
    kind === "protection"
      ? `Pays if SOL ${m.direction === "below" ? "falls to" : "rises to"} ${usd(strike)}`
      : `SOL ${m.direction === "below" ? "falls to" : "rises to"} ${usd(strike)}`;

  return (
    <section className={"panel glow min-w-0 p-5 " + (kind === "protection" ? "border-guard/25" : "")} data-testid={`panel-${kind}`}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className={"label " + (kind === "protection" ? "label-guard" : "")}>
                {kind === "protection" ? "Protection" : "Conviction"}
              </span>
              <h3 className="display mt-2 text-xl">{title}</h3>
            </div>
            <div className="text-right">
              <div className="flex items-baseline justify-end gap-2">
                <span className="num text-4xl leading-none">{pct(yes, 1)}</span>
                <Delta now={yes} open={m.initial_price_bps} />
              </div>
              <div className="num mt-1 text-[11px] text-faint">YES · opened {pct(m.initial_price_bps, 1)}</div>
            </div>
          </div>
          <div className="mt-4">
            <LineChart
              label={`${title}, YES price`}
              color={markColor}
              points={prices.map((p) => ({ t: Number(p.ts), v: p.yes_price_bps / 100 }))}
              yDomain={[0, 100]}
              yFormat={(v) => `${v.toFixed(0)}%`}
              marker={m.touched && m.touch_publish_time ? { t: Number(m.touch_publish_time), label: "touched" } : undefined}
              height={200}
            />
          </div>
        </div>

        <div className="min-w-0 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-ink">{kind === "protection" ? "Buy cover" : "Quick trade"}</span>
            <span className="num text-xs text-faint">{open ? `${timeLeft(endTs, now)} left` : ""}</span>
          </div>
          {m.settled ? (
            <div className="rounded-2xl border border-line bg-panel-2 p-4">
              <div className="text-muted">
                Settled: <span className="text-ink">{m.winning_side === 1 ? "YES — touched" : "NO — not touched"}</span>
              </div>
              {wallet && winning > 0n ? (
                <button onClick={() => void claim()} className="btn btn-primary mt-3 w-full">
                  Claim {usdc(winning)}
                </button>
              ) : (
                wallet && <div className="mt-1 text-xs text-faint">Nothing to claim in this wallet.</div>
              )}
            </div>
          ) : m.touched ? (
            <div className="rounded-2xl border border-yes/25 bg-yes/5 p-4">
              <div>
                Touched at <span className="num">{usd(pythToNumber(m.touch_price!, m.expo))}</span>
                <span className="text-muted"> · {when(Number(m.touch_publish_time))}</span>
              </div>
              <div className="mt-1 text-xs text-muted">
                Settles {settleAt > now ? `in ${timeLeft(settleAt, now)}` : "any moment now"}. YES pays $1 per token at
                settlement, never at the moment of the touch.
              </div>
              {m.proof_tx && (
                <a href={explorerTx(m.proof_tx)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-ink underline decoration-brand underline-offset-4">
                  Proof transaction ↗
                </a>
              )}
            </div>
          ) : open ? (
            <>
              <TradeBox
                kind={kind}
                market={{ touchMarket: m.touch_market, pmMarket: m.pm_market, thesis, thesisCreator: creator }}
                onDone={() => (onChange(), void loadPos())}
              />
              <div className="mt-2 flex items-center justify-between px-1 text-xs text-faint">
                <span>Saw the touch?</span>
                <button onClick={() => void prove()} className="text-muted underline hover:text-ink" disabled={!wallet}>
                  Prove it
                </button>
              </div>
              {proveMsg && <p className="mt-1 px-1 text-xs text-muted">{proveMsg}</p>}
            </>
          ) : (
            <div className="rounded-2xl border border-line bg-panel-2 p-4 text-muted">
              Window closed. Settles {settleAt > now ? `in ${timeLeft(settleAt, now)}` : "any moment now"} (NO unless a
              touch inside the window is proven first).
            </div>
          )}
          {pos && (pos.yes > 0n || pos.no > 0n) && (
            <div className="num mt-3 flex justify-between rounded-xl border border-line px-3 py-2 text-xs">
              <span className="text-faint">Your position</span>
              <span>
                {(Number(pos.yes) / USDC).toFixed(2)} YES · {(Number(pos.no) / USDC).toFixed(2)} NO
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
