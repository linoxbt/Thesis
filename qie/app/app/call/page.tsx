"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { Abi } from "viem";
import { StatusPill } from "@/components/CallCard";
import { LineChart } from "@/components/LineChart";
import { ERC20_ABI, THESIS_CALLS_ABI } from "@/lib/abi";
import { publicClient, readBalances, readPosition, readRounds } from "@/lib/chain";
import { CALLS_ADDRESS, explorerAddress } from "@/lib/config";
import { impliedYesBps, statusOf, useData, useNow } from "@/lib/data";
import { callLine, parseAmount, pct, price, qusdc, shortAddr, timeLeft, usd, when } from "@/lib/format";
import { explain, useWallet } from "@/lib/wallet";

const CALLS = { address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI as Abi };

export default function CallPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <CallView />
    </Suspense>
  );
}

function CallView() {
  const id = Number(useSearchParams().get("id") ?? "-1");
  const { ready, calls, params, stakeToken, feedOf, refresh } = useData();
  const now = useNow(1000);
  const c = calls.find((x) => x.id === id);
  const feed = c ? feedOf(c.feed) : undefined;
  const [rounds, setRounds] = useState<{ t: number; price: bigint }[]>([]);

  useEffect(() => {
    if (!c || !feed) return;
    let live = true;
    readRounds(c.feed, feed.roundId, 60)
      .then((r) => live && setRounds(r.filter((x) => x.t >= c.start - 6 * 3600)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [c?.id, c?.feed, c?.start, feed?.roundId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <p className="text-sm text-muted">Reading from QIE…</p>;
  if (!c || !feed || !params || !stakeToken) return <p className="text-sm text-muted">Call #{id} not found.</p>;

  const s = statusOf(c, now, params.grace);
  const yes = impliedYesBps(c);
  const dec = feed.decimals;
  const move = ((Number(c.strike) - Number(c.spotAtOpen)) / Number(c.spotAtOpen)) * 100;
  const open = !c.settled && !c.touched && now < c.end;
  const share = typeof window !== "undefined" ? `${window.location.origin}/call/?id=${c.id}` : "";
  const tweet = `${c.above ? "Long" : "Short"} ${feed.asset}: ${callLine(feed.asset, c.above, c.strike, dec)} by ${when(c.end)}. The crowd says ${pct(yes, 0)}. Back it or challenge it on QIE:`;

  return (
    <div className="space-y-5">
      <section className="glow relative overflow-hidden rounded-3xl border border-line px-6 py-7 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={`/profile/?a=${c.creator}`} className="num text-sm text-muted hover:text-ink">
            by {shortAddr(c.creator)}
          </Link>
          <StatusPill {...s} />
        </div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className={"num rounded-full px-2 py-0.5 text-xs font-medium " + (c.above ? "bg-yes/10 text-yes" : "bg-bad/10 text-bad")}>
              {c.above ? "Long" : "Short"} {feed.asset}
            </span>
            <h1 className="display mt-2 text-3xl sm:text-4xl" data-testid="call-title">
              {callLine(feed.asset, c.above, c.strike, dec)}
            </h1>
            <p className="num mt-1 text-sm text-muted">
              {move >= 0 ? "+" : ""}
              {move.toFixed(2)}% from {usd(price(c.spotAtOpen, dec))} · by {when(c.end)}
              {open && <span className="text-ink"> · {timeLeft(c.end, now)} left</span>}
            </p>
            {c.text && <p className="mt-3 max-w-xl text-[15px] text-ink">“{c.text}”</p>}
          </div>
          <div className="text-right">
            <div className="num text-5xl leading-none">{pct(yes, 0)}</div>
            <div className="num mt-1 text-xs text-faint">crowd says YES · opened {pct(c.openBps, 1)}</div>
          </div>
        </div>
        <div className="num mt-5 grid grid-cols-2 gap-3 text-xs text-muted sm:grid-cols-4">
          <span>
            pot <span className="block text-base text-ink">{qusdc(c.yesPool + c.noPool)} QUSDC</span>
          </span>
          <span>
            backing (YES) <span className="block text-base text-yes">{qusdc(c.yesPool)}</span>
          </span>
          <span>
            challenging (NO) <span className="block text-base text-ink">{qusdc(c.noPool)}</span>
          </span>
          <span>
            volume <span className="block text-base text-ink">{qusdc(c.volume)}</span>
          </span>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="panel min-w-0 p-5">
          <span className="label">QIE Oracle</span>
          <h2 className="display mb-3 mt-2 text-xl">{feed.asset} / USDT, oracle rounds</h2>
          <LineChart
            label={`${feed.asset} price`}
            color="var(--color-yes-mark)"
            points={rounds.map((r) => ({ t: r.t, v: price(r.price, dec) }))}
            yFormat={(v) => usd(v, v >= 1000 ? 0 : 2)}
            refs={[
              { v: price(c.strike, dec), label: `target ${usd(price(c.strike, dec))}` },
              { v: price(c.spotAtOpen, dec), label: `entry ${usd(price(c.spotAtOpen, dec))}` },
            ]}
            marker={c.touched ? { t: Math.min(now, c.end), label: "touched" } : undefined}
            height={220}
          />
          <p className="mt-3 text-xs text-faint">
            Settles from the{" "}
            <a href={explorerAddress(c.feed)} target="_blank" rel="noreferrer" className="underline">
              QIE Oracle feed
            </a>
            : any round published inside the window at or past the target makes it YES. The contract checks every round
            itself, so nobody has to race to prove it.
          </p>
        </section>

        <div className="space-y-4">
          {open ? <BetBox id={c.id} stakeToken={stakeToken} minStake={params.minStake} feeBps={params.feeBps} onDone={refresh} /> : <Resolution c={c} now={now} grace={params.grace} onDone={refresh} dec={dec} />}
          <PositionBox id={c.id} settled={c.settled} yesWon={c.yesWon} onDone={refresh} />
          <div className="panel flex flex-wrap items-center gap-2 p-4 text-sm">
            <a
              href={`https://x.com/intent/post?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent(share)}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost px-3 py-1.5 text-xs"
            >
              Share on X
            </a>
            <button onClick={() => void navigator.clipboard.writeText(share)} className="btn btn-ghost px-3 py-1.5 text-xs">
              Copy link
            </button>
            {open && <OracleCheck id={c.id} onDone={refresh} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function BetBox({ id, stakeToken, minStake, feeBps, onDone }: { id: number; stakeToken: `0x${string}`; minStake: bigint; feeBps: number; onDone: () => Promise<void> }) {
  const w = useWallet();
  const [yes, setYes] = useState(true);
  const [amount, setAmount] = useState("5");
  const [quote, setQuote] = useState<{ net: bigint; pays: bigint } | null>(null);
  const [bal, setBal] = useState<{ usd: bigint; allowance: bigint } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const micro = parseAmount(amount);

  const loadBal = useCallback(async () => {
    if (!w.account) return setBal(null);
    const b = await readBalances(stakeToken, w.account);
    setBal({ usd: b.usd, allowance: b.allowance });
  }, [w.account, stakeToken]);
  useEffect(() => void loadBal().catch(() => {}), [loadBal]);

  useEffect(() => {
    setQuote(null);
    if (!micro) return;
    let live = true;
    const t = setTimeout(() => {
      publicClient
        .readContract({ address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI, functionName: "quote", args: [BigInt(id), yes, micro] })
        .then(([net, pays]) => live && setQuote({ net, pays }))
        .catch(() => {});
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [id, yes, micro]);

  const needsApprove = !!micro && !!bal && bal.allowance < micro;
  const short = !!micro && !!bal && bal.usd < micro;
  const tooSmall = !!micro && micro < minStake;

  const go = async () => {
    if (!micro) return;
    setBusy(true);
    setErr(null);
    try {
      if (needsApprove) {
        await w.write(`Approve ${qusdc(micro)} QUSDC`, { address: stakeToken, abi: ERC20_ABI as Abi, functionName: "approve", args: [CALLS_ADDRESS, micro] });
      }
      await w.write(`${yes ? "Back" : "Challenge"} with ${qusdc(micro)} QUSDC`, { ...CALLS, functionName: "bet", args: [BigInt(id), yes, micro] });
      await Promise.all([onDone(), loadBal()]);
    } catch (e) {
      setErr(explain(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel p-4 text-sm" data-testid="bet-box">
      <div className="mb-2 grid grid-cols-2 gap-1 rounded-full border border-line bg-bg p-1">
        {[true, false].map((side) => (
          <button
            key={String(side)}
            onClick={() => setYes(side)}
            className={"rounded-full py-1.5 text-xs font-medium " + (yes === side ? (side ? "bg-yes text-yes-ink" : "bg-ink text-bg") : "text-muted hover:text-ink")}
            data-testid={side ? "side-yes" : "side-no"}
          >
            {side ? "Back · YES" : "Challenge · NO"}
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
          data-testid="bet-amount"
        />
        <span className="num rounded-full bg-panel-3 px-2 py-1 text-xs text-ink">QUSDC</span>
      </label>
      <div className="num mt-2 min-h-[2.5rem] space-y-0.5 px-1 text-[11px] text-faint" data-testid="bet-quote">
        {quote && micro && (
          <>
            <div>
              pays about <span className="text-muted">{qusdc(quote.pays)} QUSDC</span> if {yes ? "it hits" : "it misses"} (before later bets)
            </div>
            <div>{feeBps / 100}% fee: half to the creator, half to the treasury</div>
          </>
        )}
        {bal && <div>wallet: {qusdc(bal.usd)} QUSDC</div>}
        {tooSmall && <div className="text-bad">Minimum bet is {qusdc(minStake)} QUSDC.</div>}
        {short && <div className="text-bad">Not enough QUSDC in this wallet.</div>}
      </div>
      {!w.account ? (
        <button onClick={() => w.connect().catch((e) => setErr(explain(e)))} className="btn btn-primary mt-2 w-full">
          Connect wallet to trade
        </button>
      ) : (
        <button
          onClick={() => void go()}
          disabled={busy || !micro || tooSmall || short}
          className={"btn mt-2 w-full disabled:opacity-40 " + (yes ? "btn-yes" : "bg-ink text-bg")}
          data-testid="bet-submit"
        >
          {busy ? "Confirm in your wallet…" : needsApprove ? `Approve, then ${yes ? "back" : "challenge"}` : yes ? "Back it" : "Challenge it"}
        </button>
      )}
      {err && <p className="mt-2 text-xs text-bad">{err}</p>}
    </section>
  );
}

function OracleCheck({ id, onDone }: { id: number; onDone: () => Promise<void> }) {
  const w = useWallet();
  const [msg, setMsg] = useState<string | null>(null);
  if (!w.account) return null;
  return (
    <>
      <button
        onClick={() =>
          w
            .write("Check the oracle", { ...CALLS, functionName: "sync", args: [BigInt(id), 0n] })
            .then(onDone)
            .catch((e) => setMsg(explain(e)))
        }
        className="btn btn-ghost px-3 py-1.5 text-xs"
        title="Check new oracle rounds now; a round at or past the target settles the call YES"
        data-testid="sync"
      >
        Check the oracle
      </button>
      {msg && <span className="text-xs text-bad">{msg}</span>}
    </>
  );
}

function Resolution({ c, now, grace, onDone, dec }: { c: ReturnType<typeof useData>["calls"][number]; now: number; grace: number; onDone: () => Promise<void>; dec: number }) {
  const w = useWallet();
  const [err, setErr] = useState<string | null>(null);
  const settle = () => w.write("Settle the call", { ...CALLS, functionName: "settle", args: [BigInt(c.id)] }).then(onDone).catch((e) => setErr(explain(e)));
  const sync = () => w.write("Check the oracle", { ...CALLS, functionName: "sync", args: [BigInt(c.id), 200n] }).then(onDone).catch((e) => setErr(explain(e)));
  return (
    <section className="panel p-4 text-sm" data-testid="resolution">
      {c.settled ? (
        <div>
          <div className="text-ink">{c.yesWon ? "Hit: the target was touched." : "Missed: the target wasn't touched in time."}</div>
          {c.touched && (
            <div className="num mt-1 text-xs text-muted">
              Oracle round {c.touchRound.toString()} printed {usd(price(c.touchPrice, dec))}.
            </div>
          )}
        </div>
      ) : now <= c.end + grace ? (
        <div className="text-muted">The window has closed. The last oracle rounds are being checked; it settles in {timeLeft(c.end + grace, now)}.</div>
      ) : (
        <div className="space-y-2">
          <div className="text-muted">The window has closed with no touch so far. Anyone can settle it: the contract checks every oracle round first.</div>
          {w.account && (
            <div className="flex gap-2">
              <button onClick={() => void settle()} className="btn btn-primary text-xs" data-testid="settle">
                Settle now
              </button>
              <button onClick={() => void sync()} className="btn btn-ghost text-xs">
                Check the oracle
              </button>
            </div>
          )}
        </div>
      )}
      {err && <p className="mt-2 text-xs text-bad">{err}</p>}
    </section>
  );
}

function PositionBox({ id, settled, yesWon, onDone }: { id: number; settled: boolean; yesWon: boolean; onDone: () => Promise<void> }) {
  const w = useWallet();
  const [p, setP] = useState<Awaited<ReturnType<typeof readPosition>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!w.account) return setP(null);
    setP(await readPosition(id, w.account));
  }, [id, w.account]);
  useEffect(() => {
    void load().catch(() => {});
    const t = setInterval(() => void load().catch(() => {}), 15_000);
    return () => clearInterval(t);
  }, [load]);
  const won = useMemo(() => (p && settled ? (yesWon ? p.payoutIfYes : p.payoutIfNo) : 0n), [p, settled, yesWon]);
  if (!p || (p.yes === 0n && p.no === 0n)) return null;
  return (
    <section className="panel p-4 text-sm" data-testid="position">
      <div className="text-ink">Your position</div>
      <div className="num mt-1 text-xs text-muted">
        {p.yes > 0n && <div>YES stake {qusdc(p.yes)} · pays {qusdc(p.payoutIfYes)} if it hits</div>}
        {p.no > 0n && <div>NO stake {qusdc(p.no)} · pays {qusdc(p.payoutIfNo)} if it misses</div>}
      </div>
      {settled &&
        (p.hasClaimed ? (
          <div className="mt-2 text-xs text-yes">Claimed.</div>
        ) : won > 0n ? (
          <button
            onClick={() =>
              w
                .write(`Claim ${qusdc(won)} QUSDC`, { ...CALLS, functionName: "claim", args: [BigInt(id)] })
                .then(() => Promise.all([load(), onDone()]))
                .catch((e) => setErr(explain(e)))
            }
            className="btn btn-yes mt-2 w-full"
            data-testid="claim"
          >
            Claim {qusdc(won)} QUSDC
          </button>
        ) : (
          <div className="mt-2 text-xs text-faint">Nothing to claim on this one.</div>
        ))}
      {err && <p className="mt-2 text-xs text-bad">{err}</p>}
    </section>
  );
}
