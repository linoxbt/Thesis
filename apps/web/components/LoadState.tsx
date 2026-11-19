/**
 * What a page shows before its data arrives: loading, "indexing" for
 * something just created (the API 404s until the indexer catches up; the
 * page keeps polling), or the error.
 */
export function LoadState({ error, status, what }: { error: string | null; status: number | null; what: string }) {
  if (status === 404) {
    return (
      <div className="panel p-5 text-sm" data-testid="indexing">
        <div className="text-ink">Indexing…</div>
        <p className="mt-1 text-muted">
          If you just created this {what}, it appears here within a few seconds of confirming onchain. This page refreshes
          on its own.
        </p>
      </div>
    );
  }
  if (error) return <p className="text-sm text-bad">{error}</p>;
  return <p className="text-sm text-muted">Loading…</p>;
}

/** A failed refresh over data already on screen: keep the data, say it may be stale. */
export function StaleNote({ error }: { error: string }) {
  return (
    <p className="rounded-xl border border-line bg-panel-2 px-3 py-2 text-xs text-muted" role="status">
      Couldn&apos;t refresh ({error}); showing the last data. Retrying…
    </p>
  );
}
