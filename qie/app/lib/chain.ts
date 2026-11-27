import { createPublicClient, fallback, http, type Address } from "viem";
import { ERC20_ABI, PRICE_FEED_ABI, THESIS_CALLS_ABI } from "./abi";
import { CALLS_ADDRESS, qie, RPC_URLS } from "./config";
import { isNative, type StakeToken } from "./tokens";

/**
 * Read-only client. Fails over across QIE's RPC nodes (each retried twice)
 * and batches JSON-RPC calls so a page load is a handful of requests.
 */
export const publicClient = createPublicClient({
  chain: qie,
  transport: fallback(
    RPC_URLS.map((u) => http(u, { batch: { wait: 16 }, retryCount: 2, timeout: 15_000 })),
    { rank: false },
  ),
});

const calls = { address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI } as const;

export interface Call {
  id: number;
  creator: Address;
  feed: Address;
  /** Stake: NATIVE (QIE) or a token (QUSDC). Every bet on the call uses it. */
  token: Address;
  above: boolean;
  touched: boolean;
  settled: boolean;
  yesWon: boolean;
  /** Settled as void: every stake is refunded. */
  voided: boolean;
  openBps: number;
  start: number;
  end: number;
  /** Betting closes here (before `end`). */
  closeAt: number;
  /** Time of the oracle print the opening odds used. */
  oracleAt: number;
  feeBps: number;
  grace: number;
  strike: bigint;
  spotAtOpen: bigint;
  touchRound: bigint;
  touchPrice: bigint;
  touchAt: number;
  /** Latest oracle round when posted (a touch in the next one voids the call). */
  openRound: bigint;
  voidAfter: number;
  minScored: bigint;
  /** Smallest bet on this call, fixed at posting. */
  minStake: bigint;
  checkedRound: bigint;
  scanDone: boolean;
  yesPool: bigint;
  noPool: bigint;
  volume: bigint;
  outsideVolume: bigint;
  voidYes: bigint;
  voidNo: bigint;
  text: string;
}

export interface Feed {
  address: Address;
  /** "SOL", from the feed's "SOL / USDT" description. */
  asset: string;
  decimals: number;
  enabled: boolean;
  volBps: number;
  monitorSecs: number;
  volUpdatedAt: number;
  price: bigint;
  roundId: bigint;
  updatedAt: number;
}

export interface Stats {
  posted: number;
  hits: number;
  misses: number;
  /** Sum over scored calls (those with outside volume) of (hit ? 1 : 0) - opening odds. */
  skillBps: number;
  scored: number;
}

export interface Params {
  feeBps: number;
  minWindow: number;
  maxWindow: number;
  grace: number;
  maxOracleAge: number;
  maxVolAge: number;
  minDistanceBps: number;
  maxDistanceBps: number;
  minOpenBps: number;
  maxOpenBps: number;
  betCutoffBps: number;
  staleZTenths: number;
  closeBps: number;
  voidAfter: number;
}

export async function readParams(): Promise<{ params: Params; creatorShareBps: number; paused: boolean }> {
  const [p, creatorShareBps, paused] = await Promise.all([
    publicClient.readContract({ ...calls, functionName: "params" }),
    publicClient.readContract({ ...calls, functionName: "creatorShareBps" }),
    publicClient.readContract({ ...calls, functionName: "paused" }),
  ]);
  const [feeBps, minWindow, maxWindow, grace, maxOracleAge, maxVolAge, minDistanceBps, maxDistanceBps, minOpenBps, maxOpenBps, betCutoffBps, staleZTenths, closeBps, voidAfter] = p;
  return {
    params: { feeBps, minWindow, maxWindow, grace, maxOracleAge, maxVolAge, minDistanceBps, maxDistanceBps, minOpenBps, maxOpenBps, betCutoffBps, staleZTenths, closeBps, voidAfter },
    creatorShareBps,
    paused,
  };
}

/** Token symbols and decimals never change: read once per session. */
const tokenMeta = new Map<Address, { symbol: string; decimals: number }>();

/** What calls can be staked in (native QIE first), with each token's limits. */
export async function readStakeTokens(): Promise<StakeToken[]> {
  const n = Number(await publicClient.readContract({ ...calls, functionName: "stakeTokenCount" }));
  const addrs = await Promise.all(Array.from({ length: n }, (_, i) => publicClient.readContract({ ...calls, functionName: "stakeTokenList", args: [BigInt(i)] })));
  const out = await Promise.all(
    addrs.map(async (address) => {
      const [cfg, meta] = await Promise.all([
        publicClient.readContract({ ...calls, functionName: "stakeTokens", args: [address] }),
        isNative(address)
          ? { symbol: "QIE", decimals: 18 }
          : (tokenMeta.get(address) ??
            Promise.all([
              publicClient.readContract({ address, abi: ERC20_ABI, functionName: "symbol" }),
              publicClient.readContract({ address, abi: ERC20_ABI, functionName: "decimals" }),
            ]).then(([symbol, decimals]) => {
              // A test stand-in on the local chain is still QUSDC to the user.
              const m = { symbol: symbol.replace(/^t(?=QUSDC$)/, ""), decimals };
              tokenMeta.set(address, m);
              return m;
            })),
      ]);
      const [enabled, minSeed, maxSeed, minStake, minScoredVolume] = cfg;
      return { address, ...meta, native: isNative(address), enabled, minSeed, maxSeed, minStake, minScoredVolume };
    }),
  );
  return out.sort((a, b) => Number(b.native) - Number(a.native));
}

/** Feed descriptions and decimals never change: read once per session. */
const feedMeta = new Map<Address, { asset: string; decimals: number }>();

export async function readFeeds(): Promise<Feed[]> {
  const n = Number(await publicClient.readContract({ ...calls, functionName: "feedCount" }));
  const addrs = await Promise.all(Array.from({ length: n }, (_, i) => publicClient.readContract({ ...calls, functionName: "feedList", args: [BigInt(i)] })));
  return Promise.all(
    addrs.map(async (address) => {
      const [cfg, latest, meta] = await Promise.all([
        publicClient.readContract({ ...calls, functionName: "feeds", args: [address] }),
        publicClient.readContract({ address, abi: PRICE_FEED_ABI, functionName: "latestRoundData" }),
        feedMeta.get(address) ??
          Promise.all([
            publicClient.readContract({ address, abi: PRICE_FEED_ABI, functionName: "description" }),
            publicClient.readContract({ address, abi: PRICE_FEED_ABI, functionName: "decimals" }),
          ]).then(([desc, decimals]) => {
            const m = { asset: desc.split("/")[0].trim(), decimals };
            feedMeta.set(address, m);
            return m;
          }),
      ]);
      const [enabled, volBps, monitorSecs, volUpdatedAt] = cfg;
      return { address, ...meta, enabled, volBps, monitorSecs, volUpdatedAt: Number(volUpdatedAt), price: latest[1], roundId: latest[0], updatedAt: Number(latest[3]) };
    }),
  );
}

type RawCall = Awaited<ReturnType<typeof readRawCall>>;
const readRawCall = (id: number) => publicClient.readContract({ ...calls, functionName: "getCall", args: [BigInt(id)] });

function toCall(id: number, c: RawCall, text: string): Call {
  return {
    id,
    creator: c.creator,
    feed: c.feed,
    token: c.token,
    above: c.above,
    touched: c.touched,
    settled: c.settled,
    yesWon: c.yesWon,
    voided: c.voided,
    openBps: c.openBps,
    start: Number(c.start),
    end: Number(c.end),
    closeAt: Number(c.closeAt),
    oracleAt: Number(c.oracleAt),
    feeBps: c.feeBps,
    grace: c.grace,
    strike: c.strike,
    spotAtOpen: c.spotAtOpen,
    touchRound: c.touchRound,
    touchPrice: c.touchPrice,
    touchAt: Number(c.touchAt),
    openRound: c.openRound,
    voidAfter: Number(c.voidAfter),
    minScored: c.minScored,
    minStake: c.minStake,
    checkedRound: c.checkedRound,
    scanDone: c.scanDone,
    yesPool: c.yesPool,
    noPool: c.noPool,
    volume: c.volume,
    outsideVolume: c.outsideVolume,
    voidYes: c.voidYes,
    voidNo: c.voidNo,
    text,
  };
}

/**
 * Every call. Given the previous read, only new calls and calls not yet
 * settled are fetched again (a settled call, and every call's text, never change).
 */
export async function readCalls(prev: Call[] = []): Promise<Call[]> {
  const n = Number(await publicClient.readContract({ ...calls, functionName: "callCount" }));
  const out: Call[] = prev.slice(0, n);
  const open = out.filter((c) => !c.settled).map((c) => c.id);
  const fresh = await Promise.all(open.map((id) => readRawCall(id)));
  open.forEach((id, k) => (out[id] = toCall(id, fresh[k], out[id].text)));
  for (let from = out.length; from < n; from += 50) {
    const page = await publicClient.readContract({ ...calls, functionName: "getCalls", args: [BigInt(from), 50n] });
    const texts = await Promise.all(page.map((_, i) => publicClient.readContract({ ...calls, functionName: "callText", args: [BigInt(from + i)] })));
    page.forEach((c, i) => (out[from + i] = toCall(from + i, c, texts[i])));
  }
  return out;
}

export async function readCreators(): Promise<{ creator: Address; stats: Stats }[]> {
  const n = Number(await publicClient.readContract({ ...calls, functionName: "creatorCount" }));
  const out: { creator: Address; stats: Stats }[] = [];
  for (let from = 0; from < n; from += 100) {
    const [who, s] = await publicClient.readContract({ ...calls, functionName: "getCreators", args: [BigInt(from), 100n] });
    who.forEach((creator, i) =>
      out.push({ creator, stats: { posted: s[i].posted, hits: s[i].hits, misses: s[i].misses, skillBps: Number(s[i].skillBps), scored: s[i].scored } }),
    );
  }
  return out;
}

/** A wallet's stakes in a call, what each side would pay it now, and what it can claim. */
export async function readPosition(id: number, user: Address) {
  const [[yes, no, hasClaimed, payoutIfYes, payoutIfNo], claimable] = await Promise.all([
    publicClient.readContract({ ...calls, functionName: "position", args: [BigInt(id), user] }),
    publicClient.readContract({ ...calls, functionName: "claimable", args: [BigInt(id), user] }),
  ]);
  return { yes, no, hasClaimed, payoutIfYes, payoutIfNo, claimable };
}

/** Whether a call takes bets now; if not, how far the strike needs to be from the latest print. */
export async function readBetStatus(id: number) {
  const [open, needBps, distBps, oracleAge] = await publicClient.readContract({ ...calls, functionName: "betStatus", args: [BigInt(id)] });
  return { open, needBps: Number(needBps), distBps: Number(distBps), oracleAge: Number(oracleAge) };
}

export async function readMinDistance(feed: Address): Promise<number> {
  return Number(await publicClient.readContract({ ...calls, functionName: "minDistanceNow", args: [feed] }));
}

/**
 * A wallet's balance of a stake token, its QIE (for gas), and what the
 * contract may take. Native QIE needs no approval: it's sent with the call.
 */
export async function readBalances(token: Address, user: Address) {
  if (isNative(token)) {
    const gas = await publicClient.getBalance({ address: user });
    return { stake: gas, gas, allowance: 2n ** 256n - 1n };
  }
  const [stake, gas, allowance] = await Promise.all([
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [user] }),
    publicClient.getBalance({ address: user }),
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [user, CALLS_ADDRESS] }),
  ]);
  return { stake, gas, allowance };
}

/** The feed's last `count` rounds (oldest first), for price charts. */
export async function readRounds(feed: Address, latest: bigint, count: number) {
  const ids = Array.from({ length: Math.min(count, Number(latest)) }, (_, i) => latest - BigInt(i)).filter((x) => x > 0n);
  const rows = await Promise.all(
    ids.map((id) =>
      publicClient.readContract({ address: feed, abi: PRICE_FEED_ABI, functionName: "getRoundData", args: [id] }).catch(() => null),
    ),
  );
  return rows
    .filter((r): r is NonNullable<typeof r> => !!r && r[1] > 0n)
    .map((r) => ({ round: r[0], price: r[1], t: Number(r[3]) }))
    .reverse();
}
