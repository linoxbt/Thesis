/**
 * What a page shows before its data arrives: loading, or "not found yet" for
 * something just created (the page keeps polling and fills in on its own).
 */
export function LoadState({ ready, what }: { ready: boolean; what: string }) {
  if (!ready) return <p className="text-sm text-muted">Reading from QIE…</p>;
  return (
    <div className="panel p-5 text-sm" data-testid="indexing">
      <div className="text-ink">Not found yet</div>
      <p className="mt-1 text-muted">
        If you just created this {what}, it appears here within a few seconds of confirming on QIE. This page refreshes on its
        own.
      </p>
    </div>
  );
}
