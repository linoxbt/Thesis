"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseEventLogs, type Abi } from "viem";
import { usdPx } from "@/components/Position";
import { ERC20_ABI, THESIS_CALLS_ABI } from "@/lib/abi";
import { publicClient, readBalances, readMinDistance } from "@/lib/chain";
import { CALLS_ADDRESS, explorerTx, QUSDC_URL } from "@/lib/config";
import { useData, useNow } from "@/lib/data";
import { byteLength, callLine, decimalInput, distanceBps, parseAmount, pct, price, qusdc, timeLeft, when } from "@/lib/format";
import { fmtPct, positionOf } from "@/lib/position";
import { explain, useWallet } from "@/lib/wallet";

const MOVES = [2, 3, 5, 10];
const WINDOWS = [
  { label: "1h", secs: 3600 },
  { label: "6h", secs: 6 * 3600 },
  { label: "24h", secs: 86_400 },
  { label: "48h", secs: 172_800 },
  { label: "7d", secs: 604_800 },
];

type Step = { key: string; label: string; status: "todo" | "active" | "done" | "failed" | "skipped"; tx?: string; note?: string };

/** Post a trade: the contract prices it from the QIE Oracle the moment it lands. */
export default function NewTrade() {
  const { feeds, params, stakeToken, paused, refresh } = useData();
  const w = useWallet();
  const now = useNow(5000);
  const [feedAddr, setFeedAddr] = useState<string>("");
  const [above, setAbove] = useState(true);
  const [target, setTarget] = useState("");
  const [windowSecs, setWindowSecs] = useState(172_800);
  const [seed, setSeed] = useState("10");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ open: number; err?: string } | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [posted, setPosted] = useState<number | null>(null);
  const [bal, setBal] = useState<{ usd: bigint; gas: bigint } | null>(null);
  const [minDist, setMinDist] = useState<number | null>(null);
  const submitting = useRef(false);

  const live = feeds.filter((f) => f.enabled);
  const feed = live.find((f) => f.address === feedAddr) ?? live.find((f) => f.asset === "SOL") ?? live[0];
  const dec = feed?.decimals ?? 8;
  const spot = feed ? price(feed.price, dec) : null;
  const busy = !!steps && steps.some((s) => s.status === "active");

  // A fresh default target (±3%) whenever the asset or side changes.
  const fill = (m: number) => spot && setTarget((spot * (1 + (above ? m : -m) / 100)).toFixed(spot >= 1000 ? 0 : 2));
  useEffect(() => {
    if (spot) setTarget((spot * (1 + (above ? 3 : -3) / 100)).toFixed(spot >= 1000 ? 0 : 2));
  }, [feed?.address, above]); // eslint-disable-line react-hooks/exhaustive-deps

  const strike = useMemo(() => {
    if (!/^\d+(\.\d{0,8})?$/.test(target)) return null;
    const [i, f = ""] = target.split(".");
    const v = BigInt(i) * 10n ** BigInt(dec) + BigInt((f + "0".repeat(dec)).slice(0, dec) || "0");
    return v > 0n ? v : null;
  }, [target, dec]);
  const position = spot && strike ? positionOf(above ? "above" : "below", spot, price(strike, dec)) : null;
  const end = now + windowSecs;
  const seedMicro = parseAmount(seed);

  // The least distance the contract accepts right now: it grows with the age
  // of the latest oracle print (the market may have moved since).
  useEffect(() => {
    if (!feed) return;
    let on = true;
    readMinDistance(feed.address).then((d) => on && setMinDist(d)).catch(() => on && setMinDist(null));
    return () => {
      on = false;
    };
  }, [feed?.address, feed?.updatedAt, Math.floor(now / 60)]); // eslint-disable-line react-hooks/exhaustive-deps

  const printAge = feed && now > 0 ? Math.max(0, now - feed.updatedAt) : 0;
  const textBytes = byteLength(text);

  // Client-side checks mirror the contract's, so the button never sends a doomed call.
  const inputErr = (() => {
    if (!params || !feed) return null;
    if (paused) return "Posting is paused.";
    if (!strike || !position) return "Enter a take-profit price.";
    if (above ? strike <= feed.price : strike >= feed.price) return above ? "A long's take profit must be above the price." : "A short's take profit must be below the price.";
    const bps = distanceBps(feed.price, strike);
    const need = Math.max(params.minDistanceBps, minDist ?? 0);
    if (bps < need)
      return need > params.minDistanceBps
        ? `The latest oracle price is ${Math.round(printAge / 60)} min old, so the take profit must be at least ${pct(need, 1)} away until it updates.`
        : `The take profit must be at least ${pct(need, 1)} from the price.`;
    if (bps > params.maxDistanceBps) return `The take profit can be at most ${pct(params.maxDistanceBps, 0)} from the price.`;
    if (windowSecs < params.minWindow || windowSecs > params.maxWindow) return "That window is outside the allowed range.";
    if (!seedMicro || seedMicro < params.minSeed || seedMicro > params.maxSeed) return `Seed between ${qusdc(params.minSeed, 0)} and ${qusdc(params.maxSeed, 0)} QUSDC.`;
    if (textBytes > 280) return `The reason is ${textBytes} bytes; the limit is 280 (emoji and accents take more than one).`;
    if (now > 0 && printAge > params.maxOracleAge) return `The oracle price is ${Math.round(printAge / 60)} min old (limit ${params.maxOracleAge / 60}); try again after its next update.`;
    if (now > 0 && now - feed.volUpdatedAt > params.maxVolAge) return `${feed.asset} volatility hasn't been updated in ${Math.round((now - feed.volUpdatedAt) / 86_400)} days; posting reopens once it is.`;
    return null;
  })();

  useEffect(() => {
    setPreview(null); // never show odds for inputs that have since changed
    if (!feed || !strike || !params || inputErr) return;
    let on = true;
    publicClient
      .readContract({ address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI, functionName: "previewOpenBps", args: [feed.address, above, strike, BigInt(Math.floor(Date.now() / 1000) + windowSecs)] })
      .then(([open]) => on && setPreview({ open: Number(open) }))
      .catch((e) => on && setPreview({ open: 0, err: explain(e) }));
    return () => {
      on = false;
    };
  }, [feed?.address, above, strike, windowSecs, params, inputErr]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!w.account || !stakeToken) return setBal(null);
    readBalances(stakeToken, w.account).then(setBal).catch(() => {});
  }, [w.account, stakeToken, posted, steps]);

  const short = bal !== null && seedMicro !== null && bal.usd < seedMicro;
  const blocked = !!inputErr || !!preview?.err || !preview || busy || short;

  const go = async () => {
    if (!feed || !strike || !seedMicro || !stakeToken || !w.account) return;
    if (submitting.current) return; // a second click while the first is still starting
    submitting.current = true;
    const plan: Step[] = [
      { key: "approve", label: `Approve ${qusdc(seedMicro)} QUSDC`, status: "todo" },
      { key: "post", label: `Post ${callLine(feed.asset, above, strike, dec)}`, status: "todo" },
    ];
    const upd = (key: string, patch: Partial<Step>) => setSteps((s) => (s ?? plan).map((x) => (x.key === key ? { ...x, ...patch } : x)));
    setSteps(plan.map((x, i) => (i === 0 ? { ...x, status: "active" } : x)));
    let current = "approve";
    try {
      const b = await readBalances(stakeToken, w.account);
      if (b.allowance >= seedMicro) plan[0].status = "skipped";
      upd("approve", { status: plan[0].status === "skipped" ? "skipped" : "todo" });
      if (plan[0].status !== "skipped") {
        upd("approve", { status: "active" });
        const tx = await w.write(plan[0].label, { address: stakeToken, abi: ERC20_ABI as Abi, functionName: "approve", args: [CALLS_ADDRESS, seedMicro] });
        upd("approve", { status: "done", tx });
      }
      current = "post";
      upd("post", { status: "active" });
      // The deadline is fixed when you confirm.
      const deadline = BigInt(Math.floor(Date.now() / 1000) + windowSecs);
      const hash = await w.write(plan[1].label, { address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI as Abi, functionName: "createCall", args: [feed.address, above, strike, deadline, seedMicro, text.trim()] });
      upd("post", { status: "done", tx: hash });
      const receipt = await publicClient.getTransactionReceipt({ hash: hash as `0x${string}` });
      const ev = parseEventLogs({ abi: THESIS_CALLS_ABI, logs: receipt.logs, eventName: "CallCreated" })[0];
      await refresh();
      setPosted(ev ? Number(ev.args.id) : null);
    } catch (e) {
      upd(current, { status: "failed", note: explain(e) });
    } finally {
      submitting.current = false;
    }
  };

  if (posted !== null) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <div className="panel space-y-3 p-6" data-testid="posted">
          <span className="label">Live</span>
          <h1 className="display text-3xl">Your trade is live.</h1>
          <p className="text-sm text-muted">Share it: people back it or challenge it, and you earn half of every fee on it.</p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/t/?id=${posted}`} className="btn btn-primary" data-testid="view-call">
              View your trade →
            </Link>
            <button onClick={() => (setPosted(null), setSteps(null), setText(""))} className="btn btn-ghost">
              Post another
            </button>
          </div>
        </div>
      </div>
    );
  }

  const failed = !!steps?.some((s) => s.status === "failed");
  const locked = !!steps && !failed;
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <span className="label">New trade</span>
        <h1 className="display mt-2 text-4xl">Post your trade</h1>
        <p className="mt-2 text-sm text-muted">
          Your call becomes a market: the crowd backs or challenges your take profit in QUSDC, priced by the contract from the
          QIE Oracle the moment it lands. One or two confirms.
        </p>
      </div>
      <fieldset disabled={locked} className="contents">
        <section className={"space-y-3 panel p-5" + (locked ? " opacity-70" : "")}>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Asset">
            {live.map((f) => (
              <button
                key={f.address}
                role="radio"
                aria-checked={feed?.address === f.address}
                onClick={() => setFeedAddr(f.address)}
                className={"num rounded-full px-3 py-1 text-xs " + (feed?.address === f.address ? "bg-ink text-bg" : "border border-line text-muted hover:text-ink")}
                data-testid={`asset-${f.asset}`}
              >
                {f.asset}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span className="num text-sm text-ink">{feed ? `${feed.asset} / USDT` : "…"}</span>
            <span className="num text-xs text-muted">
              mark <span className="text-ink">{spot ? usdPx(spot) : "…"}</span> · QIE Oracle
              {printAge > 0 && <span className="text-faint"> · {Math.round(printAge / 60)} min ago</span>}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[true, false].map((a) => (
              <button
                key={String(a)}
                aria-pressed={above === a}
                onClick={() => setAbove(a)}
                data-testid={a ? "side-long" : "side-short"}
                className={"rounded-xl py-2.5 text-sm font-semibold transition-colors " + (above === a ? (a ? "bg-yes text-yes-ink" : "bg-bad text-white") : "border border-line text-muted hover:text-ink")}
              >
                {a ? "Long" : "Short"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="text-sm">
              <span className="text-muted">Entry</span>
              <div className="num field mt-1 px-3 py-2.5 text-muted">
                {spot ? usdPx(spot) : "…"} <span className="text-xs">market</span>
              </div>
            </div>
            <label className="block text-sm">
              <span className="text-muted">
                Take profit{" "}
                {position && position.tpMovePct > 0 && <span className="num text-yes">{fmtPct(position.tpMovePct)}</span>}
              </span>
              <input
                value={target}
                onChange={(e) => setTarget(decimalInput(e.target.value))}
                inputMode="decimal"
                className="num field mt-1 w-full px-3 py-2.5 outline-none"
                aria-label="Take profit price in USD"
                data-testid="target"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-1">
            {MOVES.map((m) => (
              <button key={m} onClick={() => fill(m)} className="num rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink">
                {above ? "+" : "−"}
                {m}%
              </button>
            ))}
          </div>
          <div>
            <span className="text-sm text-muted">Window</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {WINDOWS.filter((x) => !params || (x.secs >= params.minWindow && x.secs <= params.maxWindow)).map((x) => (
                <button
                  key={x.secs}
                  onClick={() => setWindowSecs(x.secs)}
                  className={"num rounded-full px-3 py-1 text-xs " + (windowSecs === x.secs ? "bg-ink text-bg" : "border border-line text-muted hover:text-ink")}
                >
                  {x.label}
                </button>
              ))}
            </div>
            {now > 0 && params && (
              <div className="num mt-1 text-xs text-faint">
                until {when(end)} · betting closes {timeLeft(Math.floor((windowSecs * params.closeBps) / 10_000), 0)} before
              </div>
            )}
          </div>
          <label className="block text-sm">
            <span className="text-muted">Why (optional, shown on the card)</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="field mt-1 w-full px-3 py-2.5 outline-none" aria-describedby="why-count" />
            <span id="why-count" className={"num block text-right text-xs " + (textBytes > 280 ? "text-bad" : "text-faint")}>
              {textBytes}/280
            </span>
          </label>
          <label className="block text-sm">
            <span className="text-muted">Seed (QUSDC: opens both sides at the odds below, paid out with whichever side wins)</span>
            <input value={seed} onChange={(e) => setSeed(decimalInput(e.target.value))} inputMode="decimal" className="num field mt-1 w-full px-3 py-2.5 outline-none" data-testid="seed" />
          </label>
          <div className="num rounded-xl border border-line bg-panel-2 p-3 text-sm" data-testid="preview">
            {inputErr || preview?.err ? (
              <span className="text-bad">{inputErr ?? preview?.err}</span>
            ) : (
              <>
                Opening odds: <strong>{preview ? pct(preview.open, 2) : "…"}</strong>
                <span className="text-muted">
                  {" "}
                  that {feed?.asset} touches your take profit {strike ? usdPx(price(strike, dec)) : "…"} in time
                </span>
                {preview && params && (
                  <div className="mt-1 text-xs text-faint">
                    Hit it and your skill gains {((10_000 - preview.open) / 10_000).toFixed(2)}; miss and it loses {(preview.open / 10_000).toFixed(2)}. Skill counts once
                    others have bet {qusdc(params.minScoredVolume, 0)} QUSDC on it.
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </fieldset>

      <section className="panel p-5">
        {position && position.tpMovePct > 0 && (
          <div className="num mb-4 rounded-xl border border-line bg-bg p-3 text-xs" data-testid="order-summary">
            <div className="flex items-center justify-between">
              <span className={"font-semibold uppercase " + (above ? "text-yes" : "text-bad")}>
                {above ? "long" : "short"} {feed?.asset}
              </span>
              {preview && <span className="text-muted">opens at {pct(preview.open, 1)}</span>}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-muted">
              <span>
                entry <span className="block text-ink">{usdPx(position.entry)}</span>
              </span>
              <span>
                take profit <span className="block text-yes">{usdPx(position.tp)}</span>
              </span>
              <span>
                deadline <span className="block text-ink">{now ? when(end).replace(/^\w+, /, "") : "…"}</span>
              </span>
            </div>
          </div>
        )}
        <div className="num mb-3 text-sm text-muted">
          Total: <span className="text-ink">{seedMicro ? qusdc(seedMicro) : "…"}</span> QUSDC + a little QIE for gas
          {bal !== null && (
            <span className="block text-xs text-faint">
              wallet: {qusdc(bal.usd)} QUSDC · {(Number(bal.gas) / 1e18).toFixed(3)} QIE
              {short && (
                <span className="text-bad">
                  {" "}· not enough QUSDC:{" "}
                  <a href={QUSDC_URL} target="_blank" rel="noreferrer" className="underline">
                    get QUSDC
                  </a>
                </span>
              )}
            </span>
          )}
        </div>
        {!w.account ? (
          <button onClick={() => void w.connect().catch(() => {})} className="btn btn-primary w-full py-2.5">
            Sign in to post
          </button>
        ) : (
          <button onClick={() => void go()} disabled={blocked || (!!steps && !failed)} className="btn btn-primary w-full py-2.5 disabled:opacity-40" data-testid="post-submit">
            {busy ? "Confirm in your wallet…" : failed ? "Retry" : "Post trade"}
          </button>
        )}
        {failed && (
          <button onClick={() => setSteps(null)} className="mt-2 w-full text-center text-xs text-muted underline hover:text-ink">
            Start over with new inputs
          </button>
        )}
        {steps && (
          <ol className="mt-4 space-y-2 text-sm" data-testid="create-steps">
            {steps.map((s, i) => (
              <li key={s.key} className="flex gap-2">
                <span className="num w-5 text-muted">{i + 1}.</span>
                <div>
                  <span className={s.status === "failed" ? "text-bad" : s.status === "done" ? "text-ink" : "text-muted"}>
                    {s.status === "done" ? "✓ " : s.status === "active" ? "⏳ " : s.status === "failed" ? "✕ " : s.status === "skipped" ? "– " : ""}
                    {s.label}
                    {s.status === "skipped" ? " (already approved)" : ""}
                  </span>
                  {s.tx && (
                    <a href={explorerTx(s.tx)} target="_blank" rel="noreferrer" className="ml-2 text-xs text-muted underline">
                      tx
                    </a>
                  )}
                  {s.note && <div className="text-xs text-muted">{s.note}</div>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
