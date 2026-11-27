"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { Address } from "viem";
import { publicClient, readCalls, readCreators, readFeeds, readParams, readStakeTokens, type Call, type Feed, type Params, type Stats } from "./chain";
import { DEPLOY_BLOCK, DEPLOYED } from "./config";
import { unknownToken, type StakeToken } from "./tokens";
import { cloneEvents, emptyEvents, loadCachedEvents, readEvents, saveCachedEvents, type Events, type Seen, type Trade } from "./events";

interface Data {
  ready: boolean;
  /** Event history has been read up to the chain head at least once. */
  historyReady: boolean;
  /** Reading history keeps failing (it resumes where it stopped, on the next refresh). */
  historyError: string | null;
  error: string | null;
  params: Params | null;
  /** What calls can be staked in: native QIE first, then tokens (QUSDC). */
  stakeTokens: StakeToken[];
  creatorShareBps: number;
  paused: boolean;
  feeds: Feed[];
  calls: Call[];
  creators: { creator: Address; stats: Stats }[];
  events: Events;
  feedOf(address: Address): Feed | undefined;
  /** A stake token's symbol, decimals and limits (a placeholder until loaded). */
  tokenOf(address: Address): StakeToken;
  tradesOf(id: number): Trade[];
  refresh(): Promise<void>;
}

const Ctx = createContext<Data | null>(null);

type State = Omit<Data, "feedOf" | "tokenOf" | "tradesOf" | "refresh">;

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
    historyError: null,
    error: null,
    params: null,
    stakeTokens: [],
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
  const seen = useRef<Seen>(new Map());
  const callsRef = useRef<Call[]>([]);
  const loaded = useRef(false);
  const round = useRef(0);
  const creatorsKey = useRef("");
  const creatorsRef = useRef<{ creator: Address; stats: Stats }[]>([]);
  // The docs pages don't show history: skip reading it there.
  const pathname = usePathname() ?? "";
  const wantHistory = useRef(true);
  wantHistory.current = !pathname.startsWith("/docs");

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
      // Every 4th refresh is a full one (also re-reads calls long past their void deadline).
      const full = round.current++ % 4 === 0;
      const [p, stakeTokens, feeds, calls] = await Promise.all([readParams(), readStakeTokens(), readFeeds(), readCalls(callsRef.current, full)]);
      callsRef.current = calls;
      // Creators' stats change only when a call is posted or settles.
      const key = `${calls.length}:${calls.filter((c) => c.settled).length}`;
      if (key !== creatorsKey.current || full) {
        creatorsRef.current = await readCreators();
        creatorsKey.current = key;
      }
      const creators = creatorsRef.current;
      setState((s) => ({ ...s, ready: true, error: null, ...p, stakeTokens, feeds, calls, creators }));
      if (!wantHistory.current) return;
      // History: from the last read block (a few blocks back, deduplicated) to the head.
      // Progress is kept range by range, so a flaky node only delays the rest.
      const head = await publicClient.getBlockNumber().catch((e) => {
        setState((s) => ({ ...s, historyError: "Couldn't reach QIE to read the history; retrying." }));
        throw e;
      });
      const from = cursor.current > DEPLOY_BLOCK + 5n ? cursor.current - 5n : DEPLOY_BLOCK;
      const next = cloneEvents(events.current);
      const applied = await readEvents(from, head, next, seen.current);
      if (applied >= from) {
        events.current = next;
        cursor.current = applied + 1n;
        saveCachedEvents(next, cursor.current, seen.current);
      }
      const done = applied >= head;
      setState((s) => ({
        ...s,
        events: events.current,
        historyReady: s.historyReady || done,
        historyError: done ? null : `Couldn't read the full history from QIE yet (up to block ${applied < from ? from - 1n : applied} of ${head}); retrying.`,
      }));
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
    // Back to a hidden tab: fresh data now, not up to 15 s later.
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);
  // Only when going from the docs (no history) to a page with history: read it
  // now, not in 15 s. (Not on every navigation: the timer covers the rest.)
  const hadHistory = useRef(wantHistory.current);
  useEffect(() => {
    if (wantHistory.current && !hadHistory.current) void refresh();
    hadHistory.current = wantHistory.current;
  }, [pathname, refresh]);

  const value = useMemo<Data>(() => {
    const byCall = new Map<number, Trade[]>();
    for (const t of state.events.trades) {
      if (!byCall.has(t.id)) byCall.set(t.id, []);
      byCall.get(t.id)!.push(t);
    }
    return {
      ...state,
      feedOf: (a) => state.feeds.find((f) => f.address.toLowerCase() === a.toLowerCase()),
      tokenOf: (a) => state.stakeTokens.find((t) => t.address.toLowerCase() === a.toLowerCase()) ?? unknownToken(a),
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

/**
 * One shared clock per interval: every component asking for `ms` reads the
 * same timer (a page of 50 cards runs one 1 s timer, not 50). Paused while the
 * tab is hidden.
 */
const clocks = new Map<number, { now: number; subs: Set<() => void>; timer: ReturnType<typeof setInterval> | null }>();
function clock(ms: number) {
  let c = clocks.get(ms);
  if (!c) {
    c = { now: Math.floor(Date.now() / 1000), subs: new Set(), timer: null };
    clocks.set(ms, c);
  }
  return c;
}
function subscribe(ms: number, fn: () => void) {
  const c = clock(ms);
  c.subs.add(fn);
  if (!c.timer) {
    c.now = Math.floor(Date.now() / 1000);
    c.timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      c.now = Math.floor(Date.now() / 1000);
      c.subs.forEach((f) => f());
    }, ms);
  }
  return () => {
    c.subs.delete(fn);
    if (!c.subs.size && c.timer) {
      clearInterval(c.timer);
      c.timer = null;
    }
  };
}

/** Seconds since epoch, ticking every `ms`; 0 until mounted (prebuilt HTML has no clock). */
export function useNow(ms = 1000): number {
  return useSyncExternalStore(
    useCallback((fn: () => void) => subscribe(ms, fn), [ms]),
    () => clock(ms).now,
    () => 0,
  );
}

export const impliedYesBps = (c: Pick<Call, "yesPool" | "noPool" | "openBps">) =>
  c.yesPool + c.noPool === 0n ? c.openBps : Number((c.yesPool * 10_000n) / (c.yesPool + c.noPool));

/** Crowd YES odds over time: the opening odds, then the pools after each bet. */
export function oddsHistory(c: Call, trades: Trade[]): { t: number; v: number }[] {
  return [{ t: c.start, v: c.openBps }, ...trades.map((t) => ({ t: t.ts, v: impliedYesBps({ yesPool: t.yesPool, noPool: t.noPool, openBps: c.openBps }) }))];
}

export const volumeSince = (trades: Trade[], since: number) => trades.filter((t) => t.ts >= since).reduce((s, t) => s + t.amount, 0n);

/**
 * Whether a trade was refunded in full (fee included): it was placed in the
 * call's refund round (the round right before a touch, or still pending when
 * the call was voided). Its fee was never earned.
 */
export const isRefunded = (t: Pick<Trade, "round">, c: Pick<Call, "hasRefund" | "refundRound"> | undefined) =>
  !!c && c.hasRefund && t.round === c.refundRound;
