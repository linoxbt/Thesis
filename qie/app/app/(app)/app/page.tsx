"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Pills } from "@/components/Pills";
import { ThesisCard } from "@/components/ThesisCard";
import { useData, useNow } from "@/lib/data";
import { perToken } from "@/lib/tokens";

const SORTS = [
  { key: "hot", label: "Hot" },
  { key: "new", label: "New" },
  { key: "ending", label: "Ending soon" },
] as const;

/** Markets: every call on the contract, newest data every 15 s. */
const PAGE = 24;

export default function FeedPage() {
  const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("hot");
  // Render a page of cards at a time: each card has a chart, a timer and a name lookup.
  const [limit, setLimit] = useState(PAGE);
  const { ready, calls, events, feedOf, tradesOf, stakeTokens } = useData();
  const now = useNow(30_000);

  const shown = useMemo(() => {
    const live = (c: (typeof calls)[number]) => !c.settled && c.end > now;
    const list = [...calls];
    if (sort === "new") return list.sort((a, b) => b.start - a.start);
    if (sort === "ending") return list.filter(live).sort((a, b) => a.end - b.end);
    // Hot: open calls first, by the last day's volume, then all-time volume.
    return list.sort((a, b) => {
      if (live(a) !== live(b)) return live(a) ? -1 : 1;
      // By number of trades (the last day's, then all time): a count means the
      // same whether a call is staked in QIE or QUSDC.
      const day = (c: typeof a) => tradesOf(c.id).filter((t) => t.ts >= now - 86_400).length;
      const all = (c: typeof a) => tradesOf(c.id).length;
      return day(b) - day(a) || all(b) - all(a) || b.start - a.start;
    });
  }, [calls, sort, now, tradesOf]);

  const traders = new Set([...events.trades.map((t) => t.user.toLowerCase()), ...calls.map((c) => c.creator.toLowerCase())]).size;
  const volume = perToken(calls.map((c) => ({ token: c.token, value: c.volume })), stakeTokens);

  return (
    <div className="space-y-10">
      <section className="glow relative overflow-hidden rounded-3xl border border-line px-6 py-10 sm:px-10">
        <span className="label">Live trades on QIE</span>
        <h1 className="display mt-4 max-w-2xl text-4xl leading-[1.05] sm:text-5xl">Trade the call. Keep the score.</h1>
        <p className="mt-4 max-w-xl text-muted">
          Traders post their BTC, ETH or SOL call: long or short, a target and a deadline. The crowd backs or challenges it
          in QIE or QUSDC, and the QIE Oracle settles it, round by round, with no one to trust.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/new/" className="btn btn-primary">
            Post a trade <ArrowUpRight size={14} className="-mt-0.5 inline" />
          </Link>
          <Link href="/leaderboard/" className="btn btn-ghost">
            See the leaderboard
          </Link>
        </div>
        <div className="glow-line absolute inset-x-0 bottom-0" />
      </section>

      {calls.length > 0 && (
        <section className="grid grid-cols-2 overflow-hidden rounded-2xl border border-line sm:grid-cols-4" data-testid="feed-stats">
          {[
            ["Volume", volume],
            ["Traders", String(traders)],
            ["Calls", String(calls.length)],
            ["Touches proven", String(calls.filter((c) => c.touched && !c.voided).length)],
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
        {!ready && <p className="text-sm text-muted">Reading from QIE…</p>}
        {ready && shown.length === 0 && (
          <div className="panel p-8 text-center text-sm text-muted" data-testid="feed-empty">
            {sort === "ending" ? "Nothing ending soon." : "No calls yet."}{" "}
            <Link href="/new/" className="text-ink underline decoration-brand underline-offset-4">
              Post the first one
            </Link>
            .
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.slice(0, limit).map((c) => (
            <ThesisCard key={c.id} c={c} feed={feedOf(c.feed)} />
          ))}
        </div>
        {shown.length > limit && (
          <div className="mt-6 text-center">
            <button onClick={() => setLimit((l) => l + PAGE)} className="btn btn-ghost text-sm" data-testid="show-more">
              Show more ({shown.length - limit} left)
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
