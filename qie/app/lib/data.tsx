"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { readCalls, readCreators, readFeeds, readParams, type Call, type Feed, type Params, type Stats } from "./chain";
import { DEPLOYED } from "./config";

interface Data {
  ready: boolean;
  error: string | null;
  params: Params | null;
  stakeToken: Address | null;
  creatorShareBps: number;
  paused: boolean;
  feeds: Feed[];
  calls: Call[];
  creators: { creator: Address; stats: Stats }[];
  feedOf(address: Address): Feed | undefined;
  refresh(): Promise<void>;
}

const Ctx = createContext<Data | null>(null);

/**
 * Everything the pages show, read straight from the contract and the QIE
 * Oracle every 15 s (paused while the tab is hidden). A failed refresh keeps
 * the last good data.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<Data, "feedOf" | "refresh">>({
    ready: false,
    error: null,
    params: null,
    stakeToken: null,
    creatorShareBps: 5000,
    paused: false,
    feeds: [],
    calls: [],
    creators: [],
  });
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (!DEPLOYED || busy.current) return;
    busy.current = true;
    try {
      const [p, feeds, calls, creators] = await Promise.all([readParams(), readFeeds(), readCalls(), readCreators()]);
      setState({ ready: true, error: null, ...p, feeds, calls, creators });
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message.split("\n")[0] }));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => document.visibilityState === "visible" && void refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const value = useMemo<Data>(
    () => ({ ...state, feedOf: (a) => state.feeds.find((f) => f.address.toLowerCase() === a.toLowerCase()), refresh }),
    [state, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): Data {
  const v = useContext(Ctx);
  if (!v) throw new Error("useData outside DataProvider");
  return v;
}

/** Seconds since epoch, ticking every `ms`; 0 until mounted (prebuilt HTML has no clock). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Call status in words, from chain state and the clock. */
export function statusOf(c: Call, now: number, grace: number): { label: string; tone: "open" | "yes" | "no" | "wait" } {
  if (c.settled) return c.yesWon ? { label: "Hit", tone: "yes" } : { label: "Missed", tone: "no" };
  if (now < c.end) return { label: "Live", tone: "open" };
  if (now <= c.end + grace) return { label: "Checking oracle", tone: "wait" };
  return { label: "Ready to settle", tone: "wait" };
}

export const impliedYesBps = (c: Call) => (c.yesPool + c.noPool === 0n ? c.openBps : Number((c.yesPool * 10_000n) / (c.yesPool + c.noPool)));
