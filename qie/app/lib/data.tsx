"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { publicClient, readCalls, readCreators, readFeeds, readParams, type Call, type Feed, type Params, type Stats } from "./chain";
import { DEPLOY_BLOCK, DEPLOYED } from "./config";
import { cloneEvents, emptyEvents, loadCachedEvents, readEvents, saveCachedEvents, type Events, type Trade } from "./events";

interface Data {
  ready: boolean;
  /** Event history has been read up to the chain head at least once. */
  historyReady: boolean;
  error: string | null;
  params: Params | null;
  stakeToken: Address | null;
  creatorShareBps: number;
  paused: boolean;
  feeds: Feed[];
  calls: Call[];
  creators: { creator: Address; stats: Stats }[];
  events: Events;
  feedOf(address: Address): Feed | undefined;
  tradesOf(id: number): Trade[];
  refresh(): Promise<void>;
}

const Ctx = createContext<Data | null>(null);

type State = Omit<Data, "feedOf" | "tradesOf" | "refresh">;

/**
 * Everything the pages show, read straight from the contract, its events and
 * the QIE Oracle every 15 s (paused while the tab is hidden). Events are read
 * once from the deploy block, then only new blocks. A failed refresh keeps
 * the last good data.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({
    ready: false,
    historyReady: false,
    error: null,
    params: null,
    stakeToken: null,
    creatorShareBps: 5000,
    paused: false,
    feeds: [],
    calls: [],
    creators: [],
    events: emptyEvents(),
  });
  const busy = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const cursor = useRef<bigint>(DEPLOY_BLOCK);
  const events = useRef<Events>(emptyEvents());
  const seen = useRef(new Set<string>());
  const callsRef = useRef<Call[]>([]);
  const loaded = useRef(false);

  const once = useCallback(async () => {
    if (!loaded.current) {
      loaded.current = true;
      const cached = loadCachedEvents();
      if (cached && cached.cursor > DEPLOY_BLOCK) {
        events.current = cached.events;
        cursor.current = cached.cursor;
        seen.current = cached.seen;
        setState((s) => ({ ...s, events: cached.events }));
      }
    }
    try {
      const [p, feeds, calls, creators] = await Promise.all([readParams(), readFeeds(), readCalls(callsRef.current), readCreators()]);
      callsRef.current = calls;
      setState((s) => ({ ...s, ready: true, error: null, ...p, feeds, calls, creators }));
      // History: from the last read block (a few blocks back, deduplicated) to the head.
      const head = await publicClient.getBlockNumber();
      const from = cursor.current > DEPLOY_BLOCK + 5n ? cursor.current - 5n : DEPLOY_BLOCK;
      const next = cloneEvents(events.current);
      await readEvents(from, head, next, seen.current);
      events.current = next;
      cursor.current = head + 1n;
      saveCachedEvents(next, cursor.current, seen.current);
      setState((s) => ({ ...s, historyReady: true, events: next }));
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message.split("\n")[0] }));
    }
  }, []);

  /**
   * Refresh now. If one is already running, another runs right after it (so
   * a refresh after a transaction never returns data read before it).
   */
  const refresh = useCallback(async () => {
    if (!DEPLOYED) return;
    if (busy.current) {
      again.current = true;
      return busy.current;
    }
    const run = (async () => {
      do {
        again.current = false;
        await once();
      } while (again.current);
    })();
    busy.current = run;
    try {
      await run;
    } finally {
      busy.current = null;
    }
  }, [once]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => document.visibilityState === "visible" && void refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const value = useMemo<Data>(() => {
    const byCall = new Map<number, Trade[]>();
    for (const t of state.events.trades) {
      if (!byCall.has(t.id)) byCall.set(t.id, []);
      byCall.get(t.id)!.push(t);
    }
    return {
      ...state,
      feedOf: (a) => state.feeds.find((f) => f.address.toLowerCase() === a.toLowerCase()),
      tradesOf: (id) => byCall.get(id) ?? [],
      refresh,
    };
  }, [state, refresh]);
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

export const impliedYesBps = (c: Pick<Call, "yesPool" | "noPool" | "openBps">) =>
  c.yesPool + c.noPool === 0n ? c.openBps : Number((c.yesPool * 10_000n) / (c.yesPool + c.noPool));

/** Crowd YES odds over time: the opening odds, then the pools after each bet. */
export function oddsHistory(c: Call, trades: Trade[]): { t: number; v: number }[] {
  return [{ t: c.start, v: c.openBps }, ...trades.map((t) => ({ t: t.ts, v: impliedYesBps({ yesPool: t.yesPool, noPool: t.noPool, openBps: c.openBps }) }))];
}

export const volumeSince = (trades: Trade[], since: number) => trades.filter((t) => t.ts >= since).reduce((s, t) => s + t.amount, 0n);
