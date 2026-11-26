"use client";

import { useCallback, useEffect, useState } from "react";
import type { Abi } from "viem";
import { THESIS_CALLS_ABI } from "@/lib/abi";
import { readPosition, type Call, type Feed } from "@/lib/chain";
import { CALLS_ADDRESS, explorerTx } from "@/lib/config";
import { impliedYesBps, oddsHistory, useData, useNow } from "@/lib/data";
import { pct, price, qusdc, timeLeft, when } from "@/lib/format";
import { explain, useWallet } from "@/lib/wallet";
import { LineChart } from "./LineChart";
import { usdPx } from "./Position";
import { Delta } from "./ThesisCard";
import { TradeBox } from "./TradeBox";

const CALLS = { address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI as Abi };

/** The call's market: crowd odds over time on the left, the trade ticket or the outcome on the right. */
export function MarketPanel({ c, feed }: { c: Call; feed: Feed | undefined }) {
  const w = useWallet();
  const { params, tradesOf, events, refresh } = useData();
  const now = useNow(1000);
  const [pos, setPos] = useState<Awaited<ReturnType<typeof readPosition>> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const dec = feed?.decimals ?? 8;
  const asset = feed?.asset ?? "…";
  const grace = params?.grace ?? 300;
  const settleAt = c.end + grace;
  const yes = impliedYesBps(c);
  const touch = events.touches.find((t) => t.id === c.id);

  const loadPos = useCallback(async () => {
    if (!w.account) return setPos(null);
    try {
      setPos(await readPosition(c.id, w.account));
    } catch {
      /* RPC hiccup: keep the last numbers, retry on the next tick */
    }
  }, [w.account, c.id]);
  useEffect(() => {
    void loadPos();
    const t = setInterval(() => document.visibilityState === "visible" && void loadPos(), 15_000);
    return () => clearInterval(t);
  }, [loadPos]);

  const send = (label: string, functionName: string, args: readonly unknown[]) => {
    setMsg(null);
    return w
      .write(label, { ...CALLS, functionName, args })
      .then(() => Promise.all([refresh(), loadPos()]))
      .catch((e) => setMsg(explain(e)));
  };
  const sync = () => send("Check the oracle", "sync", [BigInt(c.id), 0n]);
  const settle = () => send("Settle the call", "settle", [BigInt(c.id)]);
  const claim = (amount: bigint) => send(`Claim ${qusdc(amount)} QUSDC`, "claim", [BigInt(c.id)]);

  const won = pos && c.settled && !pos.hasClaimed ? (c.yesWon ? pos.payoutIfYes : pos.payoutIfNo) : 0n;
  const open = !c.settled && now > 0 && c.end > now;
  const title = `Target: ${asset} touches ${usdPx(price(c.strike, dec))}`;

  const checkRow = (
    <>
      <div className="mt-2 flex items-center justify-between px-1 text-xs text-faint">
        <span>Saw the touch?</span>
        <button onClick={() => void sync()} className="text-muted underline hover:text-ink disabled:opacity-40" disabled={!w.account} data-testid="sync">
          Check the oracle
        </button>
      </div>
      <p className="mt-1 px-1 text-[11px] leading-snug text-faint">
        Any QIE Oracle round inside the window at or past the target settles it YES. The contract checks every round itself
        before each bet and before NO, so a touch can&apos;t be missed or raced.
      </p>
    </>
  );

  return (
    <section className="panel glow min-w-0 p-5" data-testid="panel-conviction">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="label">Conviction · back or challenge</span>
              <h3 className="display mt-2 text-xl">{title}</h3>
            </div>
            <div className="text-right">
              <div className="flex items-baseline justify-end gap-2">
                <span className="num text-4xl leading-none">{pct(yes, 1)}</span>
                <Delta now={yes} open={c.openBps} />
              </div>
              <div className="num mt-1 text-[11px] text-faint">YES · opened {pct(c.openBps, 1)}</div>
            </div>
          </div>
          <div className="mt-4">
            <LineChart
              label={`${title}, crowd YES odds`}
              color="var(--color-yes-mark)"
              points={[...oddsHistory(c, tradesOf(c.id)), ...(now > c.start ? [{ t: Math.min(now, c.end), v: yes }] : [])].map((p) => ({ t: p.t, v: p.v / 100 }))}
              yDomain={[0, 100]}
              yFormat={(v) => `${v.toFixed(0)}%`}
              marker={c.touched && touch ? { t: touch.updatedAt, label: "touched" } : undefined}
              height={200}
            />
          </div>
          <div className="num mt-3 grid grid-cols-3 gap-3 text-xs text-faint">
            <span>
              pot <span className="block text-sm text-ink">{qusdc(c.yesPool + c.noPool)} QUSDC</span>
            </span>
            <span>
              backing · YES <span className="block text-sm text-yes">{qusdc(c.yesPool)}</span>
            </span>
            <span>
              challenging · NO <span className="block text-sm text-ink">{qusdc(c.noPool)}</span>
            </span>
          </div>
        </div>

        <div className="min-w-0 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-ink">Quick trade</span>
            <span className="num text-xs text-faint">{open ? `${timeLeft(c.end, now)} left` : ""}</span>
          </div>
          {c.settled ? (
            <div className={"rounded-2xl border p-4 " + (c.yesWon ? "border-yes/25 bg-yes/5" : "border-line bg-panel-2")} data-testid="resolution">
              <div className="text-muted">
                Settled: <span className="text-ink">{c.yesWon ? "YES — touched" : "NO — not touched"}</span>
              </div>
              {c.touched && (
                <div className="num mt-1 text-xs text-muted">
                  Oracle round {c.touchRound.toString()} printed {usdPx(price(c.touchPrice, dec))}
                  {touch ? ` · ${when(touch.updatedAt)}` : ""}
                </div>
              )}
              {touch && (
                <a href={explorerTx(touch.tx)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-ink underline decoration-brand underline-offset-4">
                  Proof transaction ↗
                </a>
              )}
              {w.account && won > 0n ? (
                <button onClick={() => void claim(won)} className="btn btn-primary mt-3 w-full" data-testid="claim">
                  Claim {qusdc(won)} QUSDC
                </button>
              ) : (
                w.account && <div className="mt-1 text-xs text-faint">{pos?.hasClaimed ? "Claimed." : "Nothing to claim in this wallet."}</div>
              )}
            </div>
          ) : open ? (
            <>
              <TradeBox id={c.id} onDone={() => void loadPos()} />
              {checkRow}
            </>
          ) : now === 0 ? (
            <div className="rounded-2xl border border-line bg-panel-2 p-4 text-muted">…</div>
          ) : settleAt > now ? (
            <>
              <div className="rounded-2xl border border-line bg-panel-2 p-4 text-muted" data-testid="resolution">
                Window closed. Oracle rounds published inside the window still count; it can settle in {timeLeft(settleAt, now)}.
              </div>
              {checkRow}
            </>
          ) : (
            <div className="rounded-2xl border border-line bg-panel-2 p-4 text-muted" data-testid="resolution">
              Window and grace period over with no touch found yet: settles NO once the contract has checked every round.
              <button onClick={() => void settle()} disabled={!w.account} className="btn btn-ghost mt-3 w-full text-xs disabled:opacity-40" data-testid="settle">
                Settle now (anyone can)
              </button>
            </div>
          )}
          {msg && <p className="mt-2 px-1 text-xs text-bad">{msg}</p>}
          {pos && (pos.yes > 0n || pos.no > 0n) && (
            <div className="num mt-3 rounded-xl border border-line px-3 py-2 text-xs" data-testid="position">
              <div className="flex justify-between">
                <span className="text-faint">Your position</span>
                <span>
                  {qusdc(pos.yes)} YES · {qusdc(pos.no)} NO
                </span>
              </div>
              {!c.settled && (
                <div className="mt-1 text-faint">
                  {pos.yes > 0n && <>pays {qusdc(pos.payoutIfYes)} if it hits</>}
                  {pos.yes > 0n && pos.no > 0n && " · "}
                  {pos.no > 0n && <>pays {qusdc(pos.payoutIfNo)} if it misses</>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
