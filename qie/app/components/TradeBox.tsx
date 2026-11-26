"use client";

import { useCallback, useEffect, useState } from "react";
import type { Abi } from "viem";
import { ERC20_ABI, THESIS_CALLS_ABI } from "@/lib/abi";
import { publicClient, readBalances } from "@/lib/chain";
import { CALLS_ADDRESS, QUSDC_URL } from "@/lib/config";
import { useData } from "@/lib/data";
import { parseAmount, pct, qusdc } from "@/lib/format";
import { explain, useWallet } from "@/lib/wallet";

interface Props {
  id: number;
  initialSide?: "yes" | "no";
  compact?: boolean;
  onDone?: () => void;
}

/**
 * Back (YES) or challenge (NO) a call with QUSDC. The quote is the contract's
 * own `quote`: what the stake pays if that side wins, at the pools as they are
 * now (later bets on either side move it).
 */
export function TradeBox({ id, initialSide = "yes", compact, onDone }: Props) {
  const w = useWallet();
  const { stakeToken, params, calls, refresh } = useData();
  const c = calls.find((x) => x.id === id);
  const [yes, setYes] = useState(initialSide === "yes");
  const [amount, setAmount] = useState("5");
  const [quote, setQuote] = useState<{ net: bigint; pays: bigint } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [bal, setBal] = useState<{ usd: bigint; allowance: bigint } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const micro = parseAmount(amount);

  const loadBal = useCallback(async () => {
    if (!w.account || !stakeToken) return setBal(null);
    const b = await readBalances(stakeToken, w.account);
    setBal({ usd: b.usd, allowance: b.allowance });
  }, [w.account, stakeToken]);
  useEffect(() => void loadBal().catch(() => {}), [loadBal]);

  // The contract's quote, debounced.
  useEffect(() => {
    setQuote(null);
    if (!micro) return;
    let live = true;
    setQuoting(true);
    const t = setTimeout(() => {
      publicClient
        .readContract({ address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI, functionName: "quote", args: [BigInt(id), yes, micro] })
        .then(([net, pays]) => live && setQuote({ net, pays }))
        .catch(() => {})
        .finally(() => live && setQuoting(false));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [id, yes, micro]);

  const minStake = params?.minStake ?? 0n;
  const needsApprove = !!micro && !!bal && bal.allowance < micro;
  const short = !!micro && !!bal && bal.usd < micro;
  const tooSmall = !!micro && micro < minStake;

  // Crowd odds before and after this bet, from the pools.
  const before = c ? (c.yesPool + c.noPool === 0n ? c.openBps : Number((c.yesPool * 10_000n) / (c.yesPool + c.noPool))) : null;
  const after =
    c && quote
      ? Number((((yes ? c.yesPool + quote.net : c.yesPool) * 10_000n) / (c.yesPool + c.noPool + quote.net)))
      : null;
  const avg = quote && quote.pays > 0n && micro ? Number((micro * 10_000n) / quote.pays) : null;

  const submit = async () => {
    if (!micro || !stakeToken) return;
    setBusy(true);
    setErr(null);
    try {
      if (needsApprove) {
        await w.write(`Approve ${qusdc(micro)} QUSDC`, { address: stakeToken, abi: ERC20_ABI as Abi, functionName: "approve", args: [CALLS_ADDRESS, micro] });
      }
      await w.write(`${yes ? "Back" : "Challenge"} ${qusdc(micro)} QUSDC`, {
        address: CALLS_ADDRESS,
        abi: THESIS_CALLS_ABI as Abi,
        functionName: "bet",
        args: [BigInt(id), yes, micro],
      });
      await Promise.all([refresh(), loadBal()]);
      onDone?.();
    } catch (e) {
      setErr(explain(e));
    } finally {
      setBusy(false);
    }
  };

  if (!w.account) {
    return (
      <div className="rounded-2xl border border-line bg-panel-2 p-3 text-sm">
        <button onClick={() => w.connect().catch((e) => setErr(explain(e)))} className="btn btn-primary w-full" data-testid="trade-connect">
          Sign in to trade
        </button>
        {err && <p className="mt-2 text-xs text-bad">{err}</p>}
      </div>
    );
  }

  const tokenLabel = yes ? "YES" : "NO";
  return (
    <div className={"rounded-2xl border border-line bg-panel-2 text-sm " + (compact ? "p-2.5" : "p-3")} data-testid="bet-box">
      <div className="mb-2 grid grid-cols-2 gap-1 rounded-full border border-line bg-bg p-1">
        {[true, false].map((s) => (
          <button
            key={String(s)}
            onClick={() => setYes(s)}
            className={
              "rounded-full py-1.5 text-xs font-medium transition-colors " +
              (yes === s ? (s ? "bg-yes text-yes-ink" : "bg-ink text-bg") : "text-muted hover:text-ink")
            }
            data-testid={s ? "side-yes" : "side-no"}
          >
            {s ? "Back · YES" : "Challenge · NO"}
          </button>
        ))}
      </div>
      <label className="field flex items-center gap-2 px-3 py-2.5">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          className="num w-full bg-transparent text-base outline-none"
          aria-label="Amount in QUSDC"
          aria-invalid={micro === null}
          data-testid="bet-amount"
        />
        <span className="num flex items-center gap-1.5 rounded-full bg-panel-3 px-2 py-1 text-xs text-ink">
          <span className="h-3 w-3 rounded-full bg-[#2775ca]" /> QUSDC
        </span>
      </label>
      {amount !== "" && micro === null && <p className="mt-1 px-1 text-[11px] text-bad">Enter an amount, up to 6 decimals.</p>}
      <div className="relative z-10 -my-1.5 flex justify-center">
        <span className="grid h-6 w-6 place-items-center rounded-full border border-line bg-panel-2 text-xs text-muted">↓</span>
      </div>
      <div className="field flex items-center gap-2 px-3 py-2.5" data-testid="quote">
        <span className="num w-full text-base text-ink">
          {quoting ? <span className="text-faint">quoting…</span> : quote ? qusdc(quote.pays) : <span className="text-faint">0.00</span>}
        </span>
        <span className={"num rounded-full px-2 py-1 text-xs " + (yes ? "bg-yes/15 text-yes" : "bg-panel-3 text-ink")}>{tokenLabel}</span>
      </div>
      <div className="num mt-2 min-h-[2.25rem] space-y-0.5 px-1 text-[11px] text-faint" data-testid="bet-quote">
        {!quoting && quote && micro && (
          <>
            <div>
              pays <span className="text-muted">{qusdc(quote.pays)} QUSDC</span> {yes ? "if it hits" : "if it misses"}
              {avg !== null && <> · avg {pct(avg)}</>}
            </div>
            {before !== null && after !== null && (
              <div>
                YES {pct(before)} → <span className="text-muted">{pct(after)}</span> · {(params?.feeBps ?? 200) / 100}% fee incl.
              </div>
            )}
          </>
        )}
        {bal && (
          <div>
            wallet {qusdc(bal.usd)} QUSDC
            {bal.usd === 0n && (
              <>
                {" · "}
                <a href={QUSDC_URL} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                  get QUSDC
                </a>
              </>
            )}
          </div>
        )}
        {tooSmall && <div className="text-bad">Minimum bet is {qusdc(minStake)} QUSDC.</div>}
        {short && <div className="text-bad">Not enough QUSDC in this wallet.</div>}
      </div>
      <button
        onClick={() => void submit()}
        disabled={busy || !micro || tooSmall || short || quoting}
        className={"btn mt-2 w-full disabled:opacity-40 " + (yes ? "btn-yes" : "bg-ink text-bg")}
        data-testid="bet-submit"
      >
        {busy ? "Confirm in your wallet…" : needsApprove ? `Approve, then ${yes ? "back" : "challenge"} it` : yes ? "Back it" : "Challenge it"}
      </button>
      {err && <p className="mt-2 px-1 text-xs text-bad">{err}</p>}
      {!compact && (
        <p className="mt-2 px-1 text-[11px] leading-snug text-faint">
          Pari-mutuel: winners split the whole pot by stake. The payout shown moves as others bet.
        </p>
      )}
    </div>
  );
}
