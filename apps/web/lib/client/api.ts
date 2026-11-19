"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * One entry per URL, shared by every component polling it: the last good
 * body (kept through transient errors) and any request in flight, so ten
 * panels reading /api/config make one request, not ten.
 */
const cache = new Map<string, { data: unknown; at: number; inflight?: Promise<unknown> }>();

async function fetchShared(url: string, maxAgeMs: number): Promise<unknown> {
  const hit = cache.get(url);
  if (hit?.inflight) return hit.inflight;
  if (hit && hit.data !== undefined && Date.now() - hit.at < maxAgeMs) return hit.data;
  const inflight = (async () => {
    const r = await fetch(url, { cache: "no-store" });
    const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    if (!r.ok) throw Object.assign(new Error((body as { error?: string }).error ?? `HTTP ${r.status}`), { status: r.status });
    cache.set(url, { data: body, at: Date.now() });
    return body;
  })();
  cache.set(url, { data: hit?.data, at: hit?.at ?? 0, inflight });
  try {
    return await inflight;
  } finally {
    const e = cache.get(url);
    if (e?.inflight === inflight) cache.set(url, { data: e.data, at: e.at });
  }
}

/** Drops cached bodies (after a transaction, so the next read is fresh). */
export function invalidate(prefix = "") {
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

/**
 * Polls a JSON endpoint. Pauses while the tab is hidden and never faster than
 * every 15 s by default (public RPC and the API are rate-limited). A failed
 * poll keeps the last good data (`error` says why it may be stale); only a
 * response for the current URL is ever applied.
 */
export function usePoll<T>(url: string | null, intervalMs = 15_000) {
  const [data, setData] = useState<T | null>(() => (url ? ((cache.get(url)?.data as T | undefined) ?? null) : null));
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const load = useCallback(
    async (force = false) => {
      if (!url) return;
      const mine = ++seq.current;
      try {
        // Polls share a body for up to a second; explicit reloads go to the network.
        if (force) cache.delete(url);
        const body = await fetchShared(url, force ? 0 : 1_000);
        if (mine !== seq.current) return; // a newer request (or URL) won
        setData(body as T);
        setError(null);
        setStatus(200);
      } catch (e) {
        if (mine !== seq.current) return;
        setError((e as Error).message);
        setStatus((e as { status?: number }).status ?? null);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [url],
  );

  useEffect(() => {
    // A different resource: don't show the previous URL's body under it.
    setData(url ? ((cache.get(url)?.data as T | undefined) ?? null) : null);
    setError(null);
    setStatus(null);
    setLoading(!!url);
    void load();
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const t = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      seq.current++; // ignore anything still in flight for this URL
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [url, load, intervalMs]);

  const reload = useCallback(() => load(true), [load]);
  return { data, error, status, loading, reload };
}

// ------------------------------------------------------------------ clock

/** One shared one-second ticker for every countdown on the page. */
const listeners = new Set<() => void>();
let nowSecs = typeof window === "undefined" ? 0 : Date.now() / 1000;
let ticker: ReturnType<typeof setInterval> | undefined;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!ticker) {
    nowSecs = Date.now() / 1000;
    ticker = setInterval(() => {
      nowSecs = Date.now() / 1000;
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && ticker) {
      clearInterval(ticker);
      ticker = undefined;
    }
  };
}

/**
 * The current time in seconds, re-rendering on the shared ticker. `ms` above
 * a second throttles re-renders for slow-moving displays.
 */
export function useNow(ms = 1000): number {
  const t = useSyncExternalStore(
    subscribe,
    () => nowSecs,
    () => 0,
  );
  const step = Math.max(1, Math.round(ms / 1000));
  return step === 1 ? t : Math.floor(t / step) * step;
}
