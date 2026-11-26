import { parseEventLogs, type Address, type Hash } from "viem";
import { THESIS_CALLS_ABI } from "./abi";
import { publicClient } from "./chain";
import { CALLS_ADDRESS } from "./config";

/** QIE RPC nodes serve eth_getLogs over at most 10,000 blocks per request. */
const SPAN = 9_999n;

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
export interface CreatorFeeClaim {
  creator: Address;
  amount: bigint;
  ts: number;
}
export interface Events {
  trades: Trade[];
  touches: Touch[];
  settlements: Settlement[];
  claims: Claim[];
  feeClaims: CreatorFeeClaim[];
  /** Transaction that posted each call. */
  createdTx: Record<number, Hash>;
}

export const emptyEvents = (): Events => ({ trades: [], touches: [], settlements: [], claims: [], feeClaims: [], createdTx: {} });

const blockTimes = new Map<bigint, number>();
async function timesOf(blocks: bigint[]) {
  const missing = [...new Set(blocks)].filter((b) => !blockTimes.has(b));
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50);
    const got = await Promise.all(chunk.map((b) => publicClient.getBlock({ blockNumber: b })));
    got.forEach((g, k) => blockTimes.set(chunk[k], Number(g.timestamp)));
  }
}

/**
 * Reads the contract's events in [from, to] and appends them to `into`
 * (deduplicated by tx and log index, so overlapping reads are harmless).
 * Everything the history views show comes from here: no indexer, no database.
 */
export async function readEvents(from: bigint, to: bigint, into: Events, seen: Set<string>): Promise<void> {
  if (to < from) return;
  const ranges: [bigint, bigint][] = [];
  for (let a = from; a <= to; a += SPAN + 1n) ranges.push([a, a + SPAN > to ? to : a + SPAN]);
  const raw = (
    await Promise.all(ranges.map(([a, b]) => publicClient.getLogs({ address: CALLS_ADDRESS, fromBlock: a, toBlock: b })))
  ).flat();
  const logs = parseEventLogs({ abi: THESIS_CALLS_ABI, logs: raw }).filter((l) => {
    const k = `${l.transactionHash}:${l.logIndex}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  logs.sort((a, b) => (a.blockNumber === b.blockNumber ? (a.logIndex ?? 0) - (b.logIndex ?? 0) : a.blockNumber! < b.blockNumber! ? -1 : 1));
  await timesOf(logs.filter((l) => ["Bet", "Settled", "Claimed", "CreatorFeesClaimed"].includes(l.eventName)).map((l) => l.blockNumber!));
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
        into.settlements.push({ id: Number(a.id), yesWon: a.yesWon, skillDeltaBps: Number(a.skillDeltaBps), creator: a.creator, tx, ts });
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
}
