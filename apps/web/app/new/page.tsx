"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { checkStrike, openingPriceBps } from "@thesis/chain";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MAX_COVER_IMPACT_BPS } from "@/components/TradeBox";
import {
  createMarketInstructions, createThesisInstruction, quoteTrade, sha256, toTx, tradeInstructions,
} from "@/lib/client/actions";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { explorerTx, IS_DEVNET, USDC } from "@/lib/client/config";
import { pct, pythToNumber, usd, usdc } from "@/lib/client/format";
import { explainError, useTx } from "@/lib/client/tx";
import { useConfig, useSpot } from "@/lib/client/useConfig";
import { useActiveWallet, useBurner } from "@/lib/client/wallet";

const WINDOWS = [
  ...(IS_DEVNET ? [{ label: "10 min (demo)", secs: 600 }] : []),
  { label: "24h", secs: 86_400 },
  { label: "48h", secs: 172_800 },
  { label: "7d", secs: 604_800 },
];

type StepKey = "conviction" | "protection" | "thesis" | "cover" | "text";
interface Step {
  key: StepKey;
  label: string;
  status: "todo" | "active" | "done" | "failed" | "skipped";
  sig?: string;
  note?: string;
}

/** Create (spec 8, screen 3): one screen, one button, a progress tracker. */
export default function CreatePage() {
  const { connection } = useConnection();
  const wallet = useActiveWallet();
  const { createBurner } = useBurner();
  const { config, usdcMint } = useConfig();
  const { data: spot } = useSpot();
  const { run } = useTx();

  const [dir, setDir] = useState<"above" | "below">("above");
  const [target, setTarget] = useState("");
  const [window, setWindow] = useState(WINDOWS[IS_DEVNET ? 2 : 1].secs);
  const [text, setText] = useState("");
  const [seed, setSeed] = useState("25");
  const [protect, setProtect] = useState(false);
  const [liq, setLiq] = useState("");
  const [cover, setCover] = useState("2");
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [made, setMade] = useState<{ conviction?: { touch: PublicKey; pm: PublicKey }; protection?: { touch: PublicKey; pm: PublicKey }; thesis?: PublicKey; endTs?: number }>({});

  const spotUsd = spot ? pythToNumber(spot.price, spot.expo) : null;
  const expo = spot?.expo ?? -8;
  // Prefill: +3% for the call, -5% for the cover, on the right sides.
  useEffect(() => {
    if (!spotUsd || target) return;
    setTarget((spotUsd * (dir === "above" ? 1.03 : 0.97)).toFixed(2));
    setLiq((spotUsd * (dir === "above" ? 0.95 : 1.05)).toFixed(2));
  }, [spotUsd, dir, target]);

  const toPyth = (usdStr: string) => {
    const n = Number(usdStr);
    return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n / 10 ** expo)) : 0n;
  };
  const protDir = dir === "above" ? "below" : "above";
  const rules = config
    ? { minStrikeDistanceBps: config.minStrikeDistanceBps, maxStrikeDistanceBps: config.maxStrikeDistanceBps, minOpenBps: config.minOpenBps, maxOpenBps: config.maxOpenBps }
    : null;

  const preview = useMemo(() => {
    if (!spot || !config || !rules) return null;
    const s = BigInt(spot.price);
    const k = toPyth(target);
    const open = openingPriceBps(Number(s), Number(k), config.solVolBps, window);
    const err = checkStrike(dir, s, k, open, rules);
    let pOpen: number | null = null;
    let pErr: string | null = null;
    if (protect) {
      const kp = toPyth(liq);
      pOpen = openingPriceBps(Number(s), Number(kp), config.solVolBps, window);
      pErr = checkStrike(protDir, s, kp, pOpen, rules);
    }
    return { open, err, pOpen, pErr };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot, config, target, liq, dir, window, protect]);

  const seedMicro = BigInt(Math.round((Number(seed) || 0) * USDC));
  const coverMicro = BigInt(Math.round((Number(cover) || 0) * USDC));
  const seedErr =
    config && (seedMicro < BigInt(config.minSeedUsdc) || seedMicro > BigInt(config.maxSeedUsdc))
      ? `Seed must be ${usdc(config.minSeedUsdc, 0)}–${usdc(config.maxSeedUsdc, 0)}`
      : null;
  const total = seedMicro * (protect ? 2n : 1n) + (protect ? coverMicro : 0n);
  const [balance, setBalance] = useState<bigint | null>(null);
  useEffect(() => {
    if (!wallet || !usdcMint) return setBalance(null);
    const ata = getAssociatedTokenAddressSync(usdcMint, wallet.publicKey);
    let live = true;
    const load = () =>
      connection.getTokenAccountBalance(ata).then((b) => live && setBalance(BigInt(b.value.amount))).catch(() => live && setBalance(0n));
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [wallet, usdcMint, connection]);
  const resuming = steps?.some((s) => s.status === "done");
  const shortBy = !resuming && balance !== null && balance < total ? total - balance : 0n;
  const blocked = !preview || !!preview.err || !!preview.pErr || !!seedErr || !usdcMint || config?.paused || shortBy > 0n;

  const setStep = (key: StepKey, patch: Partial<Step>) =>
    setSteps((xs) => xs?.map((s) => (s.key === key ? { ...s, ...patch } : s)) ?? null);

  const go = async () => {
    if (!wallet || !usdcMint || blocked) return;
    const plan: Step[] = [
      { key: "conviction", label: "Create the conviction market", status: "todo" },
      ...(protect ? [{ key: "protection" as const, label: "Create your protection market", status: "todo" as const }] : []),
      { key: "thesis", label: "Post the thesis", status: "todo" },
      ...(protect && coverMicro > 0n ? [{ key: "cover" as const, label: `Buy ${usdc(coverMicro)} of cover`, status: "todo" as const }] : []),
      ...(text.trim() ? [{ key: "text" as const, label: "Save the text", status: "todo" as const }] : []),
    ];
    // Resume: keep finished steps.
    setSteps((prev) => plan.map((s) => prev?.find((p) => p.key === s.key && p.status === "done") ?? s));
    const state = { ...made };
    const endTs = state.endTs ?? Math.floor(Date.now() / 1000) + window;
    state.endTs = endTs;
    try {
      for (const s of plan) {
        const done = steps?.find((p) => p.key === s.key && p.status === "done");
        if (done) continue;
        setStep(s.key, { status: "active" });
        let sig: string | undefined;
        if (s.key === "conviction" || s.key === "protection") {
          const isProt = s.key === "protection";
          const r = await createMarketInstructions(connection, {
            creator: wallet.publicKey,
            usdcMint,
            direction: isProt ? protDir : dir,
            strike: toPyth(isProt ? liq : target),
            endTs,
            seed: seedMicro,
            name: `SOL ${isProt ? protDir : dir} ${isProt ? liq : target}`,
          });
          sig = await run(s.label, wallet, async () => toTx(r.ixs));
          state[s.key] = { touch: r.touchMarket, pm: r.pmMarket };
        } else if (s.key === "thesis") {
          const r = await createThesisInstruction(connection, {
            creator: wallet.publicKey,
            conviction: state.conviction!.touch,
            protection: state.protection?.touch ?? null,
            textHash: await sha256(text.trim()),
          });
          sig = await run(s.label, wallet, async () => toTx([r.ix]));
          state.thesis = r.thesis;
        } else if (s.key === "cover") {
          const args = {
            trader: wallet.publicKey,
            usdcMint,
            thesis: state.thesis!,
            thesisCreator: wallet.publicKey,
            touchMarket: state.protection!.touch,
            pmMarket: state.protection!.pm,
            side: "buy_yes" as const,
            amountIn: coverMicro,
            minOutput: 0n,
          };
          const q = await quoteTrade(connection, args);
          const impact = q.priceAfter !== null && q.priceBefore !== null ? Math.abs(q.priceAfter - q.priceBefore) : 0;
          if (q.error || impact > MAX_COVER_IMPACT_BPS) {
            setStep(s.key, {
              status: "skipped",
              note: q.error ?? `Skipped: ${usdc(coverMicro)} would move this new pool ${(impact / 100).toFixed(0)} points. Buy smaller cover on the thesis page, or seed more.`,
            });
            continue;
          }
          sig = await run(s.label, wallet, async () =>
            toTx(await tradeInstructions(connection, { ...args, minOutput: (q.output * 99n) / 100n })),
          );
          setStep(s.key, { note: `Pays ${usdc(q.output)} if SOL touches ${usd(Number(liq))} before the end.` });
        } else if (s.key === "text") {
          // The indexer needs a few seconds to see the new thesis.
          let ok = false;
          for (let i = 0; i < 20 && !ok; i++) {
            const r = await fetch(`/api/theses/${state.thesis!.toBase58()}/text`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ text: text.trim() }),
            });
            ok = r.ok;
            if (!ok) await new Promise((res) => setTimeout(res, 3000));
          }
          if (!ok) throw new Error("Couldn't save the text yet; it can be added later.");
        }
        setStep(s.key, { status: "done", sig });
        setMade({ ...state });
      }
    } catch (e) {
      setSteps((xs) => xs?.map((s) => (s.status === "active" ? { ...s, status: "failed", note: explainError(e) } : s)) ?? null);
    }
    setMade({ ...state });
  };

  const finished = steps?.every((s) => s.status === "done" || s.status === "skipped");

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <span className="label">New call</span>
        <h1 className="display mt-2 text-4xl">Post your trade</h1>
        <p className="mt-2 text-sm text-muted">Your call becomes a market the crowd can back or challenge. Add cover in the same step.</p>
      </div>
      <section className="space-y-3 panel p-5">
        <div className="num text-xs text-muted">
          SOL now: <span className="text-ink">{spotUsd ? usd(spotUsd) : "…"}</span> (Pyth)
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-full border border-line bg-bg p-1">
          {(["above", "below"] as const).map((d) => (
            <button
              key={d}
              onClick={() => (setDir(d), setTarget(""))}
              className={"rounded-full py-1.5 text-sm font-medium " + (dir === d ? "bg-yes text-yes-ink" : "text-muted hover:text-ink")}
            >
              {d === "above" ? "SOL goes up to…" : "SOL goes down to…"}
            </button>
          ))}
        </div>
        <label className="block text-sm">
          <span className="text-muted">Target price</span>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            className="num field mt-1 w-full px-3 py-2.5 outline-none"
            aria-label="Target price in USD"
          />
        </label>
        <div>
          <span className="text-sm text-muted">Window</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {WINDOWS.map((w) => (
              <button
                key={w.secs}
                onClick={() => setWindow(w.secs)}
                className={"num rounded-full px-3 py-1 text-xs " + (window === w.secs ? "bg-ink text-bg" : "border border-line text-muted hover:text-ink")}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
        <label className="block text-sm">
          <span className="text-muted">Why (optional, shown on the card)</span>
          <textarea
            value={text}
            maxLength={280}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            className="field mt-1 w-full px-3 py-2.5 outline-none"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Seed liquidity per market (you are the first LP; most of it is a cost, not a deposit)</span>
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            className="num field mt-1 w-full px-3 py-2.5 outline-none"
          />
          {seedErr && <span className="text-xs text-bad">{seedErr}</span>}
        </label>
        <div className="num rounded-xl border border-line bg-panel-2 p-3 text-sm">
          Opening odds: <strong>{preview?.open !== null && preview?.open !== undefined ? pct(preview.open, 2) : "…"}</strong>
          <span className="text-muted"> that SOL touches {target ? usd(Number(target)) : "…"} in time</span>
          {preview?.err && <div className="mt-1 text-xs text-bad">{preview.err}</div>}
        </div>
      </section>

      <section className="space-y-3 panel border-guard/25 p-5">
        <label className="flex items-center justify-between text-sm font-semibold">
          <span>
            Protect me <span className="font-normal text-muted">(cover if SOL touches your liquidation price)</span>
          </span>
          <input type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} className="h-5 w-5 accent-[var(--color-guard)]" />
        </label>
        {protect && (
          <>
            <label className="block text-sm">
              <span className="text-muted">Liquidation price (SOL {protDir === "below" ? "falls to" : "rises to"})</span>
              <input
                value={liq}
                onChange={(e) => setLiq(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                className="num field mt-1 w-full px-3 py-2.5 outline-none"
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted">Spend on cover (USDC)</span>
              <input
                value={cover}
                onChange={(e) => setCover(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                className="num field mt-1 w-full px-3 py-2.5 outline-none"
              />
            </label>
            <div className="num rounded-xl border border-line bg-panel-2 p-3 text-sm">
              Cover opens at <strong>{preview?.pOpen !== null && preview?.pOpen !== undefined ? pct(preview.pOpen, 2) : "…"}</strong>
              {preview?.pOpen ? (
                <span className="text-muted">
                  {" "}
                  · {usdc(coverMicro)} buys about {usdc(Number(coverMicro) / (preview.pOpen / 10_000))} of payout before price impact
                </span>
              ) : null}
              {preview?.pErr && <div className="mt-1 text-xs text-bad">{preview.pErr}</div>}
            </div>
            <p className="text-[11px] text-faint">Price-touch protection, paid at window end. Not a liquidation guarantee.</p>
          </>
        )}
      </section>

      <section className="panel p-5">
        <div className="num mb-3 text-sm text-muted">
          Total: <span className="text-ink">{usdc(total)}</span> USDC + ~{protect ? "0.1" : "0.05"} SOL rent
          {balance !== null && (
            <span className="block text-xs text-faint">
              wallet: {usdc(balance)} USDC
              {shortBy > 0n && <span className="text-bad"> · {usdc(shortBy)} short{IS_DEVNET ? ": top up from the wallet menu" : ""}</span>}
            </span>
          )}
        </div>
        {!wallet ? (
          IS_DEVNET ? (
            <button onClick={() => void createBurner()} className="btn btn-yes w-full py-2.5">
              Get an instant wallet (free test USDC)
            </button>
          ) : (
            <p className="text-sm text-muted">Connect a wallet to post.</p>
          )
        ) : (
          <button
            onClick={() => void go()}
            disabled={blocked || (steps !== null && !steps.some((s) => s.status === "failed") && !finished)}
            className="btn btn-yes w-full py-2.5 disabled:opacity-40"
            data-testid="create-submit"
          >
            {steps?.some((s) => s.status === "failed") ? "Retry from the failed step" : "Post thesis"}
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
                  </span>
                  {s.sig && (
                    <a href={explorerTx(s.sig)} target="_blank" rel="noreferrer" className="ml-2 text-xs underline text-muted">
                      tx
                    </a>
                  )}
                  {s.note && <div className="text-xs text-muted">{s.note}</div>}
                </div>
              </li>
            ))}
          </ol>
        )}
        {finished && made.thesis && (
          <Link
            href={`/t/${made.thesis.toBase58()}`}
            className="btn btn-ghost mt-4 block w-full text-center text-sm"
            data-testid="view-thesis"
          >
            View your thesis →
          </Link>
        )}
      </section>
    </div>
  );
}
