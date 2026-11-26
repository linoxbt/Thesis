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
  /** Counted toward the creator's skill (the call had enough outside volume). */
  scored: boolean;
  creator: Address;
  tx: Hash;
  ts: number;
}
export interface Voiding {
  id: number;
  /** 1: touched right after posting; 2: no oracle print past the deadline. */
  reason: number;
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
export interface CreatorFeeClaim {
  creator: Address;
  amount: bigint;
  ts: number;
}
export interface Events {
  trades: Trade[];
  touches: Touch[];
  settlements: Settlement[];
  voids: Voiding[];
  claims: Claim[];
  feeClaims: CreatorFeeClaim[];
  /** Transaction that posted each call. */
  createdTx: Record<number, Hash>;
}

export const emptyEvents = (): Events => ({ trades: [], touches: [], settlements: [], voids: [], claims: [], feeClaims: [], createdTx: {} });

export const cloneEvents = (e: Events): Events => ({
  trades: [...e.trades],
  touches: [...e.touches],
  settlements: [...e.settlements],
  voids: [...e.voids],
  claims: [...e.claims],
  feeClaims: [...e.feeClaims],
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

/**
 * Reads the contract's events in [from, to] and appends them to `into`
 * (deduplicated by tx and log index, so overlapping reads are harmless).
 * Everything the history views show comes from here: no indexer, no database.
 * Nothing is marked as seen until the whole read has succeeded, so a failed
 * read is simply retried next time without losing events.
 */
export async function readEvents(from: bigint, to: bigint, into: Events, seen: Set<string>): Promise<void> {
  if (to < from) return;
  const ranges: [bigint, bigint][] = [];
  for (let a = from; a <= to; a += SPAN + 1n) ranges.push([a, a + SPAN > to ? to : a + SPAN]);
  const raw = (
    await pool(
      ranges.map(([a, b]) => () => withRetry(() => publicClient.getLogs({ address: CALLS_ADDRESS, fromBlock: a, toBlock: b }))),
      CONCURRENCY,
    )
  ).flat();
  const fresh = new Set<string>();
  const logs = parseEventLogs({ abi: THESIS_CALLS_ABI, logs: raw }).filter((l) => {
    const k = `${l.transactionHash}:${l.logIndex}`;
    if (seen.has(k) || fresh.has(k)) return false;
    fresh.add(k);
    return true;
  });
  logs.sort((a, b) => (a.blockNumber === b.blockNumber ? (a.logIndex ?? 0) - (b.logIndex ?? 0) : a.blockNumber! < b.blockNumber! ? -1 : 1));
  await timesOf(logs.filter((l) => ["Bet", "Settled", "Voided", "Claimed", "CreatorFeesClaimed"].includes(l.eventName)).map((l) => l.blockNumber!));
  for (const l of logs) {
    const ts = blockTimes.get(l.blockNumber!) ?? 0;
    const tx = l.transactionHash!;
    switch (l.eventName) {
      case "Bet": {
        const a = l.args;
        into.trades.push({ id: Number(a.id), user: a.user, yes: a.yes, amount: a.amount, fee: a.fee, yesPool: a.yesPool, noPool: a.noPool, tx, ts });
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
      case "Voided": {
        const a = l.args;
        into.voids.push({ id: Number(a.id), reason: Number(a.reason), tx, ts });
        break;
      }
      case "Claimed": {
        const a = l.args;
        into.claims.push({ id: Number(a.id), user: a.user, amount: a.amount, tx, ts });
        break;
      }
      case "CreatorFeesClaimed": {
        const a = l.args;
        into.feeClaims.push({ creator: a.creator, amount: a.amount, ts });
        break;
      }
      case "CallCreated":
        into.createdTx[Number(l.args.id)] = tx;
        break;
    }
  }
  for (const k of fresh) seen.add(k);
}

// ------------------------------------------------------------------ cache
// History read once is kept in localStorage (per chain and contract), so a
// return visit only reads blocks it hasn't seen. Stale or corrupt entries are
// ignored. A reorg deeper than the 5-block overlap is not expected on QIE
// (CometBFT finality).

const CACHE_KEY = `thesis-events:v2:${qie.id}:${CALLS_ADDRESS.toLowerCase()}`;
const big = (_k: string, v: unknown) => (typeof v === "bigint" ? { $b: v.toString() } : v);
const unbig = (_k: string, v: unknown) => (v && typeof v === "object" && "$b" in v ? BigInt((v as { $b: string }).$b) : v);

export function loadCachedEvents(): { events: Events; cursor: bigint; seen: Set<string> } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw, unbig) as { events: Events; cursor: bigint; seen: string[] };
    if (typeof c.cursor !== "bigint" || !Array.isArray(c.events?.trades)) return null;
    return { events: { ...emptyEvents(), ...c.events }, cursor: c.cursor, seen: new Set(c.seen) };
  } catch {
    return null;
  }
}

export function saveCachedEvents(events: Events, cursor: bigint, seen: Set<string>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ events, cursor, seen: [...seen] }, big));
  } catch {
    // Storage full or blocked: the app works without the cache.
  }
}
