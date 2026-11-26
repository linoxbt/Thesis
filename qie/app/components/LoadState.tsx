import Link from "next/link";

/**
 * What a page shows before its data arrives: loading; "not found" for an id
 * that can't exist; "not found yet" for something just created (the page
 * keeps polling and fills in on its own).
 */
export function LoadState({ ready, what, invalid = false, pending = true }: { ready: boolean; what: string; invalid?: boolean; pending?: boolean }) {
  if (!ready && !invalid) return <p className="text-sm text-muted">Reading from QIE…</p>;
  if (invalid || !pending) {
    return (
      <div className="panel p-5 text-sm" data-testid="not-found">
        <div className="text-ink">No such {what}</div>
        <p className="mt-1 text-muted">
          This link doesn&apos;t point to a {what} on Thesis.{" "}
          <Link href="/app/" className="text-ink underline">
            Browse the markets
          </Link>
        </p>
      </div>
    );
  }
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
