"use client";

import { explorerTx } from "@/lib/config";
import { useWallet } from "@/lib/wallet";

const STYLE = {
  pending: "border-yes/30 text-ink",
  confirmed: "border-yes/60 text-ink",
  failed: "border-bad/60 text-ink",
} as const;
const LABEL = { pending: "Pending", confirmed: "Confirmed", failed: "Failed" } as const;

/** Pending, confirmed or failed, with an explorer link. */
export function TxToasts() {
  const { toasts, dismiss } = useWallet();
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-36 right-4 z-30 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 lg:bottom-4 lg:right-24" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={"rounded-2xl border bg-panel/95 p-3 text-sm shadow-2xl backdrop-blur " + STYLE[t.status]} data-testid={`tx-${t.status}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium">{t.label}</div>
              <div className="text-xs text-muted">
                {t.status === "pending" ? "⏳ " : t.status === "confirmed" ? "✓ " : "✕ "}
                {t.status === "pending" && !t.hash ? "Waiting for signature" : LABEL[t.status]}
                {t.hash && (
                  <>
                    {" · "}
                    <a className="underline" href={explorerTx(t.hash)} target="_blank" rel="noreferrer">
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
