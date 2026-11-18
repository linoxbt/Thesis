"use client";

import { Info } from "lucide-react";
import { usePoll } from "@/lib/client/api";

interface Health {
  cluster: string;
  programId: string;
  programDeployed: boolean;
  configInitialized: boolean;
  indexer: boolean;
}

/** Says plainly what isn't live yet on this deployment, instead of failing. */
export function StatusBanner() {
  const { data } = usePoll<Health>("/api/health", 60_000);
  if (!data) return null;
  let msg: string | null = null;
  if (!data.programDeployed) {
    msg = `Preview: the Thesis program isn't deployed on ${data.cluster} yet. Every screen is live; trading opens once it is.`;
  } else if (!data.configInitialized) {
    msg = `Preview: the Thesis program is deployed on ${data.cluster} but not initialised yet.`;
  } else if (!data.indexer) {
    msg = "The feed indexer isn't connected yet, so the feed, profiles and stats are empty for now.";
  }
  if (!msg) return null;
  return (
    <div className="mb-6 flex items-start gap-3 rounded-2xl border border-guard/30 bg-guard/5 px-4 py-3 text-sm text-ink" data-testid="status-banner">
      <Info size={16} className="mt-0.5 shrink-0 text-guard" />
      <span>{msg}</span>
    </div>
  );
}
