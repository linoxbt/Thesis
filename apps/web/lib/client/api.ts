"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Polls a JSON endpoint. Pauses while the tab is hidden and never faster than
 * every 15 s by default (public RPC and the API are rate-limited; spec 7).
 */
export function usePoll<T>(url: string | null, intervalMs = 15_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!url) return;
    try {
      const r = await fetch(url, { cache: "no-store" });
      const body = await r.json();
      if (!alive.current) return;
      if (!r.ok) setError(body.error ?? `HTTP ${r.status}`);
      else {
        setData(body as T);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    void load();
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const t = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      alive.current = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load, intervalMs]);

  return { data, error, loading, reload: load };
}

/** Re-renders every `ms` so countdowns stay live. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
