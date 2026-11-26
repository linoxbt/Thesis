"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CallCard } from "@/components/CallCard";
import { useData, useNow } from "@/lib/data";
import { price, usd } from "@/lib/format";

type Filter = "live" | "settled" | "all";

/** Home: the pitch in one line, live oracle prices, and the calls. */
export default function Home() {
  const { ready, calls, feeds, params, feedOf } = useData();
  const now = useNow(1000);
  const [filter, setFilter] = useState<Filter>("live");
  const shown = useMemo(() => {
    const xs = [...calls].reverse();
    if (filter === "live") return xs.filter((c) => !c.settled && c.end > now);
    if (filter === "settled") return xs.filter((c) => c.settled);
    return xs;
  }, [calls, filter, now]);

  return (
    <div className="space-y-8">
      <section className="glow relative overflow-hidden rounded-3xl border border-line px-6 py-8 sm:px-10 sm:py-10">
        <span className="label">Thesis on QIE</span>
        <h1 className="display mt-3 text-4xl sm:text-5xl">Prove you called it.</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">
          Post a call on BTC, ETH or SOL. The contract prices it the moment you post, the crowd backs it or challenges it in
          QUSDC, and the QIE Oracle settles it. Every result scores your skill onchain: hitting a long shot counts for more
          than calling the obvious.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/new/" className="btn btn-primary" data-testid="cta-post">
            Post a call
          </Link>
          <Link href="/leaderboard/" className="btn btn-ghost">
            See the leaderboard
          </Link>
        </div>
        <div className="num mt-6 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted" data-testid="oracle-prices">
          {feeds.map((f) => (
            <span key={f.address}>
              {f.asset} <span className="text-ink">{usd(price(f.price, f.decimals), price(f.price, f.decimals) >= 1000 ? 0 : 2)}</span>
            </span>
          ))}
          {feeds.length > 0 && <span className="text-faint">QIE Oracle</span>}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="display text-2xl">Calls</h2>
          <div className="grid grid-cols-3 gap-1 rounded-full border border-line bg-bg p-1 text-xs">
            {(["live", "settled", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={"rounded-full px-3 py-1 capitalize " + (filter === f ? "bg-ink text-bg" : "text-muted hover:text-ink")}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        {!ready ? (
          <p className="text-sm text-muted">Reading from QIE…</p>
        ) : shown.length === 0 ? (
          <div className="panel p-6 text-sm text-muted">
            No {filter === "all" ? "" : filter} calls yet.{" "}
            <Link href="/new/" className="text-ink underline decoration-brand underline-offset-4">
              Post the first one
            </Link>
            .
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((c) => (
              <CallCard key={c.id} c={c} feed={feedOf(c.feed)} now={now} grace={params?.grace ?? 300} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
