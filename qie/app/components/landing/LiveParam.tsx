"use client";

import { useData } from "@/lib/data";
import { durationText, pct } from "@/lib/format";

/**
 * A contract setting, read live, for copy on static pages. The prebuilt HTML
 * shows the launch value until the contract has been read, so the page never
 * states a number the contract has since changed.
 */
const SETTINGS = {
  fee: { launch: "2%", live: (p: P) => pct(p.params.feeBps, p.params.feeBps % 100 ? 1 : 0) },
  creatorShare: { launch: "half", live: (p: P) => (p.creatorShareBps === 5000 ? "half" : pct(p.creatorShareBps, 0)) },
  close: { launch: "10%", live: (p: P) => pct(p.params.closeBps, 0) },
  cutoff: { launch: "0.25%", live: (p: P) => pct(p.params.betCutoffBps, 2) },
  oracleAge: { launch: "3 h", live: (p: P) => durationText(p.params.maxOracleAge) },
  grace: { launch: "5 min", live: (p: P) => durationText(p.params.grace) },
  voidAfter: { launch: "3 days", live: (p: P) => durationText(p.params.voidAfter) },
} as const;

type P = { params: NonNullable<ReturnType<typeof useData>["params"]>; creatorShareBps: number };

export function LiveParam({ k }: { k: keyof typeof SETTINGS }) {
  const { params, creatorShareBps } = useData();
  const s = SETTINGS[k];
  return <>{params ? s.live({ params, creatorShareBps }) : s.launch}</>;
}
