"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Abi } from "viem";
import { THESIS_CALLS_ABI } from "@/lib/abi";
import { publicClient, readPosition, type Call, type Feed } from "@/lib/chain";
import { CALLS_ADDRESS, explorerTx } from "@/lib/config";
import { impliedYesBps, oddsHistory, useData, useNow } from "@/lib/data";
import { durationText, pct, price, timeLeft, when } from "@/lib/format";
import { amt } from "@/lib/tokens";
import { errorName, explain, useWallet } from "@/lib/wallet";
import { LineChart } from "./LineChart";
import { usdPx } from "./Position";
import { Delta } from "./ThesisCard";
import { TradeBox } from "./TradeBox";

const CALLS = { address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI as Abi };

/** The call's market: crowd odds over time on the left, the trade ticket or the outcome on the right. */
export function MarketPanel({ c, feed }: { c: Call; feed: Feed | undefined }) {
  const w = useWallet();
  const { tradesOf, events, refresh, tokenOf } = useData();
  const tok = tokenOf(c.token);
  const now = useNow(1000);
  const [pos, setPos] = useState<Awaited<ReturnType<typeof readPosition>> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const actingRef = useRef(false);
  const dec = feed?.decimals ?? 8;
  const asset = feed?.asset ?? "…";
  const settleAt = c.end + c.grace;
  const voidAt = c.end + c.voidAfter;
  const yes = impliedYesBps(c);
  const touch = events.touches.find((t) => t.id === c.id);

  // The account the latest read is for: a read that finishes after a switch or
  // sign-out is dropped, so another account's position never shows.
  const forAccount = useRef(w.account);
  forAccount.current = w.account;
  const loadPos = useCallback(async () => {
    const who = w.account;
    if (!who) return setPos(null);
    try {
      const p = await readPosition(c.id, who);
      if (forAccount.current === who) setPos(p);
    } catch {
      /* RPC hiccup: keep the last numbers, retry on the next tick */
    }
  }, [w.account, c.id]);
  useEffect(() => setPos(null), [w.account]);
  useEffect(() => {
    void loadPos();
    const t = setInterval(() => document.visibilityState === "visible" && void loadPos(), 15_000);
    return () => clearInterval(t);
  }, [loadPos]);

  /** One action at a time: a second click while one is running does nothing. */
  const act = async (key: string, fn: () => Promise<unknown>) => {
    if (actingRef.current) return;
    actingRef.current = true;
    setActing(key);
    setMsg(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setMsg(explain(e));
    } finally {
      await Promise.all([refresh(), loadPos()]).catch(() => {});
      actingRef.current = false;
      setActing(null);
    }
  };
  const write = (label: string, functionName: string, args: readonly unknown[]) => w.write(label, { ...CALLS, functionName, args });
  const readCall = () => publicClient.readContract({ address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI, functionName: "getCall", args: [BigInt(c.id)] });

  // Check up to 200 unchecked oracle rounds for a touch, and say what it found.
  const sync = () =>
    act("sync", async () => {
      await write("Check the oracle", "sync", [BigInt(c.id), 200n]);
      const after = await readCall();
      setInfo(
        after.touched
          ? `Touch found: oracle round ${after.touchRound} printed ${usdPx(price(after.touchPrice, dec))}. ${after.voided ? "It came in the first round after posting, so the call is void and every stake is refunded." : "The call settled YES."}`
          : after.scanDone
            ? "Every round up to the deadline is checked: no touch."
            : `No touch in the oracle rounds up to #${after.checkedRound}.`,
      );
    });

  // Settle: catch the contract's oracle check up as far as needed (one
  // confirm per 300 rounds), then settle. If the oracle hasn't printed past
  // the deadline yet, say so; once voidAfter has passed, void and refund.
  const settle = () =>
    act("settle", async () => {
      for (let i = 0; i < 10; i++) {
        try {
          await publicClient.simulateContract({ ...CALLS, functionName: "settle", args: [BigInt(c.id)], account: w.account! });
        } catch (e) {
          const name = errorName(e);
          if (name === "SyncRequired") {
            await write("Check the oracle", "sync", [BigInt(c.id), 300n]);
            continue;
          }
          throw e;
        }
        await write("Settle the call", "settle", [BigInt(c.id)]);
        return;
      }
      throw new Error("The oracle has a very long backlog of rounds. Press Settle again to keep checking.");
    });
  // Past voidAfter: voidCall settles whatever the oracle can still decide, and
  // voids (refunding everyone) only if it never printed past the deadline.
  const settleOrVoid = () =>
    act("settle", async () => {
      for (let i = 0; i < 10; i++) {
        try {
          await publicClient.simulateContract({ ...CALLS, functionName: "voidCall", args: [BigInt(c.id)], account: w.account! });
        } catch (e) {
          if (errorName(e) === "SyncRequired") {
            await write("Check the oracle", "sync", [BigInt(c.id), 300n]);
            continue;
          }
          throw e;
        }
        await write("Settle or void the call", "voidCall", [BigInt(c.id)]);
        return;
      }
      throw new Error("The oracle has a very long backlog of rounds. Press the button again to keep checking.");
    });
  const claim = (amount: bigint) => act("claim", () => write(`Claim ${amt(amount, tok)} ${tok.symbol}`, "claim", [BigInt(c.id)]));

  const won = pos && c.settled ? pos.claimable : 0n;
  const open = !c.settled && now > 0 && c.end > now;
  const title = `Target: ${asset} touches ${usdPx(price(c.strike, dec))}`;

  const checkRow = (
    <>
      <div className="mt-2 flex items-center justify-between px-1 text-xs text-faint">
        <span>Saw the touch?</span>
        <button onClick={() => void sync()} className="text-muted underline hover:text-ink disabled:opacity-40" disabled={!w.account || !!acting} data-testid="sync">
          {acting === "sync" ? "Checking…" : "Check the oracle"}
        </button>
      </div>
      <p className="mt-1 px-1 text-[11px] leading-snug text-faint">
        Any QIE Oracle round inside the window at or past the target settles it YES. The contract checks every round itself
        before each bet and before NO, so a touch can&apos;t be missed. Bets placed while the latest price was the round just before the touch are
        refunded rather than paid, so it can&apos;t be raced either.
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
              pot <span className="block text-sm text-ink">{amt(c.yesPool + c.noPool, tok)} {tok.symbol}</span>
            </span>
            <span>
              backing · YES <span className="block text-sm text-yes">{amt(c.yesPool, tok)}</span>
            </span>
            <span>
              challenging · NO <span className="block text-sm text-ink">{amt(c.noPool, tok)}</span>
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
                {c.voided ? (
                  <>
                    Void: <span className="text-ink">every stake is refunded</span>
                    <div className="mt-1 text-xs text-faint">
                      {c.touched
                        ? "The oracle touched the target in its first round after the call was posted, so it can't count."
                        : `The oracle printed no price after the deadline for ${durationText(c.voidAfter)} (or its feed broke), so there was no fair way to settle it.`}{" "}
                      Bets still waiting on their next oracle round get their fee back too; fees already earned stay with the creator and treasury.
                    </div>
                  </>
                ) : (
                  <>
                    Settled: <span className="text-ink">{c.yesWon ? "YES — touched" : "NO — not touched"}</span>
                  </>
                )}
              </div>
              {c.yesWon && !c.voided && c.hasRefund && (
                <div className="num mt-1 text-xs text-faint">{amt(c.voidYes + c.voidNo, tok)} {tok.symbol} bet in the oracle round before the touch was refunded in full (fee included), not paid.</div>
              )}
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
                <button onClick={() => void claim(won)} disabled={!!acting} className="btn btn-primary mt-3 w-full disabled:opacity-40" data-testid="claim">
                  {acting === "claim" ? "Claiming…" : `Claim ${amt(won, tok)} ${tok.symbol}`}
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
            <>
              <div className="rounded-2xl border border-line bg-panel-2 p-4 text-muted" data-testid="resolution">
                Window and grace period over with no touch found yet. It settles NO once the contract has checked every round up to
                the deadline and the oracle has printed a price after it
                {now > voidAt ? `. It's been ${durationText(c.voidAfter)}: settling now decides it if the oracle can, and otherwise voids it with every stake refunded.` : "."}
                <button onClick={() => void (now > voidAt ? settleOrVoid() : settle())} disabled={!w.account || !!acting} className="btn btn-ghost mt-3 w-full text-xs disabled:opacity-40" data-testid="settle">
                  {acting === "settle" ? "Settling…" : now > voidAt ? "Settle or void (anyone can)" : "Settle now (anyone can)"}
                </button>
              </div>
              {checkRow}
            </>
          )}
          {msg && <p className="mt-2 px-1 text-xs text-bad" role="alert">{msg}</p>}
          {info && <p className="mt-2 px-1 text-xs text-muted" role="status" data-testid="sync-result">{info}</p>}
          {pos && (pos.yes > 0n || pos.no > 0n) && (
            <div className="num mt-3 rounded-xl border border-line px-3 py-2 text-xs" data-testid="position">
              <div className="flex justify-between">
                <span className="text-faint">Your position</span>
                <span>
                  {amt(pos.yes, tok)} YES · {amt(pos.no, tok)} NO
                </span>
              </div>
              {!c.settled ? (
                <div className="mt-1 text-faint">
                  {pos.yes > 0n && <>pays {amt(pos.payoutIfYes, tok)} if it hits</>}
                  {pos.yes > 0n && pos.no > 0n && " · "}
                  {pos.no > 0n && <>pays {amt(pos.payoutIfNo, tok)} if it misses</>}
                </div>
              ) : (
                <div className="mt-1 text-faint">{pos.hasClaimed ? "claimed" : pos.claimable > 0n ? `${amt(pos.claimable, tok)} ${tok.symbol} to claim` : "nothing to claim"}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
