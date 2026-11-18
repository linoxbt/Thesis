"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Pills } from "@/components/Pills";
import { ThesisCard, type FeedThesis } from "@/components/ThesisCard";
import { usePoll } from "@/lib/client/api";
import { pythToNumber, usdc } from "@/lib/client/format";
import { useSpot } from "@/lib/client/useConfig";

const SORTS = [
  { key: "hot", label: "Hot" },
  { key: "new", label: "New" },
  { key: "ending", label: "Ending soon" },
] as const;

interface Stats {
  wallets: string;
  volume_usdc: string;
  theses: string;
  touches_proven: number;
}

/** Feed (spec 8, screen 1). */
export default function FeedPage() {
  const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("hot");
  const { data, error, loading } = usePoll<{ theses: FeedThesis[] }>(`/api/theses?sort=${sort}`, 15_000);
  const { data: stats } = usePoll<Stats>("/api/stats", 30_000);
  const { data: spot } = useSpot();
  const mark = spot ? pythToNumber(spot.price, spot.expo) : null;
  return (
    <div className="space-y-10">
      <section className="glow relative overflow-hidden rounded-3xl border border-line px-6 py-10 sm:px-10">
        <span className="label">Live trades on Solana</span>
        <h1 className="display mt-4 max-w-2xl text-4xl leading-[1.05] sm:text-5xl">Trade the call. Hedge the wick.</h1>
        <p className="mt-4 max-w-xl text-muted">
          Traders post their SOL position: side, leverage, take profit and liquidation. The crowd backs or challenges the
          take profit, and protection covers the liquidation wick. Both settle from a Pyth price anyone can prove.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/new" className="btn btn-primary">
            Post a trade <ArrowUpRight size={14} className="-mt-0.5 inline" />
          </Link>
          <Link href="/protect" className="btn btn-ghost">
            Protect a position
          </Link>
        </div>
        <div className="glow-line absolute inset-x-0 bottom-0" />
      </section>

      {stats && Number(stats.theses) + Number(stats.wallets) > 0 && (
        <section className="grid grid-cols-2 overflow-hidden rounded-2xl border border-line sm:grid-cols-4">
          {[
            ["Volume", usdc(stats.volume_usdc, 0)],
            ["Traders", stats.wallets],
            ["Theses", stats.theses],
            ["Touches proven", String(stats.touches_proven)],
          ].map(([k, v], i) => (
            <div key={k} className={"bg-panel px-5 py-4 " + (i ? "border-l border-line" : "") + (i === 2 ? " border-t sm:border-t-0" : "") + (i === 3 ? " border-t sm:border-t-0" : "")}>
              <div className="text-xs text-faint">{k}</div>
              <div className="num mt-1 text-xl text-ink">{v}</div>
            </div>
          ))}
        </section>
      )}

      <section>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="label">Positions</span>
            <h2 className="display mt-2 text-3xl">Back it or challenge it</h2>
          </div>
          <Pills items={SORTS} value={sort} onChange={setSort} />
        </div>
        {error && <p className="text-sm text-bad">Couldn't load the feed: {error}</p>}
        {loading && !data && <p className="text-sm text-muted">Loading…</p>}
        {data && data.theses.length === 0 && (
          <div className="panel p-8 text-center text-sm text-muted">
            {sort === "ending" ? "Nothing ending soon." : "No calls yet."}{" "}
            <Link href="/new" className="text-ink underline decoration-brand underline-offset-4">
              Post the first one
            </Link>
            .
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data?.theses.map((t) => <ThesisCard key={t.pda} t={t} mark={mark} />)}
        </div>
      </section>
    </div>
  );
}
