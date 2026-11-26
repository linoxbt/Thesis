"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { parseEventLogs, type Abi } from "viem";
import { ERC20_ABI, THESIS_CALLS_ABI } from "@/lib/abi";
import { publicClient, readBalances } from "@/lib/chain";
import { CALLS_ADDRESS, QUSDC_URL } from "@/lib/config";
import { useData, useNow } from "@/lib/data";
import { callLine, parseAmount, pct, price, qusdc, usd, when } from "@/lib/format";
import { explain, useWallet } from "@/lib/wallet";

const MOVES = [2, 3, 5, 10];
const WINDOWS = [
  { label: "1h", secs: 3600 },
  { label: "6h", secs: 6 * 3600 },
  { label: "24h", secs: 86_400 },
  { label: "48h", secs: 172_800 },
  { label: "7d", secs: 604_800 },
];

/** Post a call: the contract prices it from the QIE Oracle the moment it lands. */
export default function NewCall() {
  const { feeds, params, stakeToken, paused, refresh } = useData();
  const w = useWallet();
  const now = useNow(5000);
  const [feedAddr, setFeedAddr] = useState<string>("");
  const [above, setAbove] = useState(true);
  const [movePct, setMovePct] = useState("3");
  const [windowSecs, setWindowSecs] = useState(172_800);
  const [seed, setSeed] = useState("10");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ open: number; err?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [posted, setPosted] = useState<number | null>(null);
  const [bal, setBal] = useState<bigint | null>(null);

  const feed = feeds.find((f) => f.address === feedAddr) ?? feeds.find((f) => f.asset === "SOL") ?? feeds[0];
  const spot = feed ? price(feed.price, feed.decimals) : null;
  const move = Number(movePct);
  const strike = useMemo(() => {
    if (!feed || !Number.isFinite(move) || move <= 0) return null;
    const bps = BigInt(Math.round(move * 100));
    return above ? (feed.price * (10_000n + bps)) / 10_000n : (feed.price * (10_000n - bps)) / 10_000n;
  }, [feed, move, above]);
  const end = now + windowSecs;
  const seedMicro = parseAmount(seed);

  // Client-side checks mirror the contract's, so the button never sends a doomed call.
  const inputErr = (() => {
    if (!params || !feed) return null;
    if (paused) return "Posting is paused.";
    if (!strike) return "Enter how far the price must move.";
    const bps = Math.round(move * 100);
    if (bps < params.minDistanceBps) return `The target must be at least ${pct(params.minDistanceBps, 1)} from the price.`;
    if (bps > params.maxDistanceBps) return `The target can be at most ${pct(params.maxDistanceBps, 0)} from the price.`;
    if (windowSecs < params.minWindow || windowSecs > params.maxWindow) return "That deadline is outside the allowed window.";
    if (!seedMicro || seedMicro < params.minSeed || seedMicro > params.maxSeed) return `Seed between ${qusdc(params.minSeed, 0)} and ${qusdc(params.maxSeed, 0)} QUSDC.`;
    if (now > 0 && now - feed.updatedAt > params.maxOracleAge) return "The oracle price is too old right now; try again after its next update.";
    return null;
  })();

  useEffect(() => {
    if (!feed || !strike || !params) return setPreview(null);
    let live = true;
    publicClient
      .readContract({ address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI, functionName: "previewOpenBps", args: [feed.address, strike, BigInt(end)] })
      .then(([open]) => {
        if (!live) return;
        const o = Number(open);
        setPreview({ open: o, err: o < params.minOpenBps || o > params.maxOpenBps ? "Those odds are outside 1%–99%: pick a nearer target or a longer deadline." : undefined });
      })
      .catch(() => live && setPreview(null));
    return () => {
      live = false;
    };
    // `end` moves every tick; the odds barely do. Re-preview on input changes only.
  }, [feed?.address, strike, windowSecs, params]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!w.account || !stakeToken) return setBal(null);
    readBalances(stakeToken, w.account).then((b) => setBal(b.usd)).catch(() => {});
  }, [w.account, stakeToken, posted]);

  const blocked = !!inputErr || !!preview?.err || !preview || busy;
  const short = bal !== null && seedMicro !== null && bal < seedMicro;

  const go = async () => {
    if (!feed || !strike || !seedMicro || !stakeToken || !w.account) return;
    setBusy(true);
    setErr(null);
    try {
      const b = await readBalances(stakeToken, w.account);
      if (b.allowance < seedMicro) {
        await w.write(`Approve ${qusdc(seedMicro)} QUSDC`, { address: stakeToken, abi: ERC20_ABI as Abi, functionName: "approve", args: [CALLS_ADDRESS, seedMicro] });
      }
      // The deadline is fixed when you press the button.
      const deadline = BigInt(Math.floor(Date.now() / 1000) + windowSecs);
      const hash = await w.write(`Post ${callLine(feed.asset, above, strike, feed.decimals)}`, {
        address: CALLS_ADDRESS,
        abi: THESIS_CALLS_ABI as Abi,
        functionName: "createCall",
        args: [feed.address, above, strike, deadline, seedMicro, text.trim()],
      });
      const receipt = await publicClient.getTransactionReceipt({ hash: hash as `0x${string}` });
      const ev = parseEventLogs({ abi: THESIS_CALLS_ABI, logs: receipt.logs, eventName: "CallCreated" })[0];
      setPosted(ev ? Number(ev.args.id) : null);
      await refresh();
    } catch (e) {
      setErr(explain(e));
    } finally {
      setBusy(false);
    }
  };

  if (posted !== null) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <div className="panel space-y-3 p-6" data-testid="posted">
          <span className="label">Live</span>
          <h1 className="display text-3xl">Your call is live.</h1>
          <p className="text-sm text-muted">Share it: people back it or challenge it, and you earn half of every trade fee on it.</p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/call/?id=${posted}`} className="btn btn-primary" data-testid="view-call">
              View your call →
            </Link>
            <button onClick={() => (setPosted(null), setText(""))} className="btn btn-ghost">
              Post another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <span className="label">New call</span>
        <h1 className="display mt-2 text-4xl">Post a call</h1>
        <p className="mt-2 text-sm text-muted">
          Say where the price goes and by when. The contract prices it from the QIE Oracle the moment it lands, and your seed
          opens the pot at those odds.
        </p>
      </div>
      <section className="panel space-y-4 p-5">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Asset">
          {feeds.map((f) => (
            <button
              key={f.address}
              onClick={() => setFeedAddr(f.address)}
              className={"num rounded-full px-3 py-1.5 text-sm " + (feed?.address === f.address ? "bg-ink text-bg" : "border border-line text-muted hover:text-ink")}
              data-testid={`asset-${f.asset}`}
            >
              {f.asset} <span className="opacity-70">{usd(price(f.price, f.decimals), price(f.price, f.decimals) >= 1000 ? 0 : 2)}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[true, false].map((a) => (
            <button
              key={String(a)}
              onClick={() => setAbove(a)}
              className={"rounded-xl py-2.5 text-sm font-semibold " + (above === a ? (a ? "bg-yes text-yes-ink" : "bg-bad text-white") : "border border-line text-muted hover:text-ink")}
            >
              {a ? "Long: it rises to" : "Short: it falls to"}
            </button>
          ))}
        </div>
        <div>
          <div className="text-sm text-muted">Target move</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {MOVES.map((m) => (
              <button
                key={m}
                onClick={() => setMovePct(String(m))}
                className={"num rounded-full px-3 py-1 text-xs " + (Number(movePct) === m ? "bg-ink text-bg" : "border border-line text-muted hover:text-ink")}
              >
                {above ? "+" : "−"}
                {m}%
              </button>
            ))}
            <label className="field flex items-center px-2 py-1 text-xs">
              <input value={movePct} onChange={(e) => setMovePct(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="num w-12 bg-transparent outline-none" aria-label="Move in percent" />%
            </label>
          </div>
          {strike && feed && (
            <div className="num mt-2 text-sm">
              Target <span className="text-ink">{usd(price(strike, feed.decimals), spot && spot >= 1000 ? 0 : 2)}</span>{" "}
              <span className="text-faint">from {spot !== null ? usd(spot, spot >= 1000 ? 0 : 2) : "…"} now</span>
            </div>
          )}
        </div>
        <div>
          <div className="text-sm text-muted">Deadline</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
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
          {now > 0 && <div className="num mt-1 text-xs text-faint">by {when(end)}</div>}
        </div>
        <label className="block text-sm">
          <span className="text-muted">Why? (optional, public)</span>
          <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 280))} rows={2} className="field mt-1 w-full px-3 py-2 outline-none" placeholder="One line on your thesis" />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Seed (QUSDC)</span>
          <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="num field mt-1 w-full px-3 py-2.5 outline-none" data-testid="seed" />
          <span className="mt-1 block text-[11px] text-faint">
            Opens both sides at the odds below; it&apos;s your stake too, paid out with whichever side wins.
            {bal !== null && <> Wallet: {qusdc(bal)} QUSDC.</>}{" "}
            <a href={QUSDC_URL} target="_blank" rel="noreferrer" className="underline">
              Get QUSDC
            </a>
          </span>
        </label>
        <div className="num rounded-xl border border-line bg-panel-2 p-3 text-sm" data-testid="preview">
          {inputErr || preview?.err ? (
            <span className="text-bad">{inputErr ?? preview?.err}</span>
          ) : preview ? (
            <>
              Opening odds <strong>{pct(preview.open, 1)}</strong> that {feed?.asset} touches{" "}
              {strike && feed ? usd(price(strike, feed.decimals), spot && spot >= 1000 ? 0 : 2) : ""} in time. Hit it and your
              skill score gains {((10_000 - preview.open) / 10_000).toFixed(2)}; miss and it loses {(preview.open / 10_000).toFixed(2)}.
            </>
          ) : (
            "…"
          )}
        </div>
        {short && <p className="text-xs text-bad">Not enough QUSDC for that seed.</p>}
        {!w.account ? (
          <button onClick={() => w.connect().catch((e) => setErr(explain(e)))} className="btn btn-primary w-full py-2.5">
            Connect wallet to post
          </button>
        ) : (
          <button onClick={() => void go()} disabled={blocked || short} className="btn btn-primary w-full py-2.5 disabled:opacity-40" data-testid="post-submit">
            {busy ? "Confirm in your wallet…" : "Post call"}
          </button>
        )}
        {err && <p className="text-xs text-bad">{err}</p>}
      </section>
    </div>
  );
}
