"use client";

import { Info } from "lucide-react";
import { DEPLOYED, NETWORK } from "@/lib/config";
import { useData } from "@/lib/data";

/** Says plainly what isn't working right now, instead of failing quietly. */
export function StatusBanner() {
  const { error, ready, paused } = useData();
  let msg: string | null = null;
  if (!DEPLOYED) msg = `Preview: the Thesis contract isn't deployed on QIE ${NETWORK} yet. Every screen is live; trading opens once it is.`;
  else if (error) msg = ready ? `Couldn't refresh from QIE (${error}); showing the last data. Retrying…` : `Couldn't reach QIE (${error}). Retrying…`;
  else if (paused) msg = "Trading is paused by the contract owner. Positions and claims are unaffected.";
  if (!msg) return null;
  return (
    <div className="mb-6 flex items-start gap-3 rounded-2xl border border-line bg-panel px-4 py-3 text-sm text-ink" data-testid="status-banner" role="status">
      <Info size={16} className="mt-0.5 shrink-0 text-muted" />
      <span>{msg}</span>
    </div>
  );
}
