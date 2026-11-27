import { parseEventLogs, type Address, type Hash } from "viem";
import { THESIS_CALLS_ABI } from "./abi";
import { publicClient } from "./chain";
import { CALLS_ADDRESS, qie } from "./config";

/** QIE RPC nodes serve eth_getLogs over at most 10,000 blocks per request. */
const SPAN = 9_999n;
/** Log pages fetched at once (the rest wait), and attempts per page. */
const CONCURRENCY = 4;
const ATTEMPTS = 3;

export interface Trade {
  id: number;
  user: Address;
  yes: boolean;
  amount: bigint;
  fee: bigint;
  /** Pools right after the bet: the crowd odds at that moment. */
  yesPool: bigint;
  noPool: bigint;
  /** The oracle round that was latest when it was placed (its refund tag). */
  round: bigint;
  tx: Hash;
  ts: number;
}
export interface Touch {
  id: number;
  roundId: bigint;
  price: bigint;
  updatedAt: number;
  prover: Address;
  tx: Hash;
}
export interface Settlement {
  id: number;
  yesWon: boolean;
  skillDeltaBps: number;
  /** Counted toward the creator's skill (seeded at the scoring size, fixed at posting). */
  scored: boolean;
  creator: Address;
  tx: Hash;
  ts: number;
}
export interface Claim {
  id: number;
  user: Address;
  amount: bigint;
  tx: Hash;
  ts: number;
}
export interface Events {
  trades: Trade[];
  touches: Touch[];
  settlements: Settlement[];
  claims: Claim[];
  /** Transaction that posted each call. */
  createdTx: Record<number, Hash>;
}

export const emptyEvents = (): Events => ({ trades: [], touches: [], settlements: [], claims: [], createdTx: {} });

export const cloneEvents = (e: Events): Events => ({
  trades: [...e.trades],
  touches: [...e.touches],
  settlements: [...e.settlements],
  claims: [...e.claims],
  createdTx: { ...e.createdTx },
});

const blockTimes = new Map<bigint, number>();
async function timesOf(blocks: bigint[]) {
  const missing = [...new Set(blocks)].filter((b) => !blockTimes.has(b));
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50);
    const got = await Promise.all(chunk.map((b) => withRetry(() => publicClient.getBlock({ blockNumber: b }))));
    got.forEach((g, k) => blockTimes.set(chunk[k], Number(g.timestamp)));
  }
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw last;
}

/** Runs `tasks` with at most `limit` in flight; rejects on the first failure. */
async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        out[i] = await tasks[i]();
      }
    }),
  );
  return out;
}

/** Log keys already read (tx:logIndex) with their block, to dedupe overlapping reads. */
export type Seen = Map<string, bigint>;

/**
 * Reads the contract's events in [from, to] and appends them to `into`
 * (deduplicated by tx and log index, so overlapping reads are harmless).
 * Everything the history views show comes from here: no indexer, no database.
 * Ranges are fetched a few at a time but applied in order, up to the first one
 * that fails even after retries; returns the last block applied (from - 1 if
 * none), so the caller saves progress and resumes from there next time.
 */
export async function readEvents(from: bigint, to: bigint, into: Events, seen: Seen): Promise<bigint> {
  if (to < from) return to;
  const ranges: [bigint, bigint][] = [];
  for (let a = from; a <= to; a += SPAN + 1n) ranges.push([a, a + SPAN > to ? to : a + SPAN]);
  const pages = await pool(
    ranges.map(([a, b]) => () => withRetry(() => publicClient.getLogs({ address: CALLS_ADDRESS, fromBlock: a, toBlock: b })).catch(() => null)),
    CONCURRENCY,
  );
  let applied = from - 1n;
  for (let i = 0; i < ranges.length; i++) {
    const raw = pages[i];
    if (!raw) break; // resume here next time
    try {
      await apply(raw, into, seen);
    } catch {
      break; // block times couldn't be read: retry this range next time
    }
    applied = ranges[i][1];
  }
  return applied;
}

async function apply(raw: Awaited<ReturnType<typeof publicClient.getLogs>>, into: Events, seen: Seen) {
  const fresh = new Map<string, bigint>();
  const logs = parseEventLogs({ abi: THESIS_CALLS_ABI, logs: raw }).filter((l) => {
    const k = `${l.transactionHash}:${l.logIndex}`;
    if (seen.has(k) || fresh.has(k)) return false;
    fresh.set(k, l.blockNumber!);
    return true;
  });
  logs.sort((a, b) => (a.blockNumber === b.blockNumber ? (a.logIndex ?? 0) - (b.logIndex ?? 0) : a.blockNumber! < b.blockNumber! ? -1 : 1));
  await timesOf(logs.filter((l) => ["Bet", "Settled", "Claimed"].includes(l.eventName)).map((l) => l.blockNumber!));
  for (const l of logs) {
    const ts = blockTimes.get(l.blockNumber!) ?? 0;
    const tx = l.transactionHash!;
    switch (l.eventName) {
      case "Bet": {
        const a = l.args;
        into.trades.push({ id: Number(a.id), user: a.user, yes: a.yes, amount: a.amount, fee: a.fee, yesPool: a.yesPool, noPool: a.noPool, round: a.round, tx, ts });
        break;
      }
      case "Touched": {
        const a = l.args;
        into.touches.push({ id: Number(a.id), roundId: a.roundId, price: a.price, updatedAt: Number(a.updatedAt), prover: a.prover, tx });
        break;
      }
      case "Settled": {
        const a = l.args;
        into.settlements.push({ id: Number(a.id), yesWon: a.yesWon, skillDeltaBps: Number(a.skillDeltaBps), scored: a.scored, creator: a.creator, tx, ts });
        break;
      }
      case "Claimed": {
        const a = l.args;
        into.claims.push({ id: Number(a.id), user: a.user, amount: a.amount, tx, ts });
        break;
      }
      case "CallCreated":
        into.createdTx[Number(l.args.id)] = tx;
        break;
    }
  }
  for (const [k, b] of fresh) seen.set(k, b);
}

// ------------------------------------------------------------------ cache
// History read once is kept in localStorage (per chain and contract), so a
// return visit only reads blocks it hasn't seen. Stale or corrupt entries are
// ignored. A reorg deeper than the 5-block overlap is not expected on QIE
// (CometBFT finality).

const CACHE_KEY = `thesis-events:v5:${qie.id}:${CALLS_ADDRESS.toLowerCase()}`;
const big = (_k: string, v: unknown) => (typeof v === "bigint" ? { $b: v.toString() } : v);
const unbig = (_k: string, v: unknown) => (v && typeof v === "object" && "$b" in v ? BigInt((v as { $b: string }).$b) : v);

export function loadCachedEvents(): { events: Events; cursor: bigint; seen: Seen } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw, unbig) as { events: Events; cursor: bigint; seen: [string, bigint][] };
    if (typeof c.cursor !== "bigint" || !Array.isArray(c.events?.trades)) return null;
    return { events: { ...emptyEvents(), ...c.events }, cursor: c.cursor, seen: new Map(Array.isArray(c.seen) ? c.seen.filter((x) => Array.isArray(x)) : []) };
  } catch {
    return null;
  }
}

export function saveCachedEvents(events: Events, cursor: bigint, seen: Seen) {
  // Reads overlap by 5 blocks, so only recent keys are needed to dedupe: drop the rest.
  for (const [k, b] of seen) if (b + 20n < cursor) seen.delete(k);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ events, cursor, seen: [...seen] }, big));
  } catch (e) {
    // Storage full or blocked: the app works without the cache (it re-reads
    // history on the next visit). Drop the stale copy so it can't be reused.
    console.warn("Thesis: couldn't save the event cache;", (e as Error)?.name ?? e);
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {}
  }
}
