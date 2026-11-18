"use client";

import Link from "next/link";
import { useState } from "react";
import { ThesisCard, type FeedThesis } from "@/components/ThesisCard";
import { usePoll } from "@/lib/client/api";

const SORTS = [
  { key: "hot", label: "Hot" },
  { key: "new", label: "New" },
  { key: "ending", label: "Ending soon" },
] as const;

/** Feed: thesis cards, Hot / New / Ending soon (spec 8, screen 1). */
export default function FeedPage() {
  const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("hot");
  const { data, error, loading } = usePoll<{ theses: FeedThesis[] }>(`/api/theses?sort=${sort}`, 15_000);
  return (
    <div>
      <section className="mb-4">
        <h1 className="text-xl font-semibold">Post your trade. The crowd bets on it.</h1>
        <p className="text-sm text-muted">
          Back a call or challenge it. Traders cover their downside with a price proof anyone can submit.
        </p>
      </section>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-1 rounded-lg bg-panel p-1 ring-1 ring-line" role="tablist">
          {SORTS.map((s) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={sort === s.key}
              onClick={() => setSort(s.key)}
              className={"rounded-md px-3 py-1 text-sm " + (sort === s.key ? "bg-panel-2 text-ink" : "text-muted hover:text-ink")}
            >
              {s.label}
            </button>
          ))}
        </div>
        <Link href="/new" className="rounded-md bg-yes px-3 py-1.5 text-sm font-semibold text-yes-ink">
          Post a thesis
        </Link>
      </div>
      {error && <p className="text-sm text-bad">Couldn't load the feed: {error}</p>}
      {loading && !data && <p className="text-sm text-muted">Loading…</p>}
      {data && data.theses.length === 0 && (
        <div className="rounded-xl bg-panel p-6 text-center text-sm text-muted ring-1 ring-line">
          {sort === "ending" ? "Nothing ending soon." : "No theses yet."}{" "}
          <Link href="/new" className="text-yes underline">
            Post the first one
          </Link>
          .
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {data?.theses.map((t) => <ThesisCard key={t.pda} t={t} />)}
      </div>
    </div>
  );
}
