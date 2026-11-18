"use client";

import { explorerTx } from "@/lib/client/config";
import { useTx } from "@/lib/client/tx";

const STYLE = {
  signing: "ring-line text-muted",
  pending: "ring-yes/40 text-ink",
  confirmed: "ring-yes text-ink",
  failed: "ring-bad text-ink",
} as const;
const LABEL = { signing: "Waiting for signature", pending: "Pending", confirmed: "Confirmed", failed: "Failed" } as const;

/** Pending, confirmed or failed, with an explorer link (spec 8). */
export function TxToasts() {
  const { items, dismiss } = useTx();
  if (!items.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-30 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={"rounded-lg bg-panel p-3 text-sm ring-1 " + STYLE[t.status]} data-testid={`tx-${t.status}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium">{t.label}</div>
              <div className="text-xs text-muted">
                {t.status === "pending" || t.status === "signing" ? "⏳ " : t.status === "confirmed" ? "✓ " : "✕ "}
                {LABEL[t.status]}
                {t.signature && (
                  <>
                    {" · "}
                    <a className="underline" href={explorerTx(t.signature)} target="_blank" rel="noreferrer">
                      explorer
                    </a>
                  </>
                )}
              </div>
              {t.error && <div className="mt-1 text-xs text-bad">{t.error}</div>}
            </div>
            <button className="text-muted hover:text-ink" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
