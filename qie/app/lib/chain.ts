import { createPublicClient, http, type Address } from "viem";
import { ERC20_ABI, PRICE_FEED_ABI, THESIS_CALLS_ABI } from "./abi";
import { CALLS_ADDRESS, qie, RPC_URL } from "./config";

/** Read-only client. JSON-RPC batching keeps page loads to a few requests. */
export const publicClient = createPublicClient({ chain: qie, transport: http(RPC_URL, { batch: { wait: 16 } }) });

const calls = { address: CALLS_ADDRESS, abi: THESIS_CALLS_ABI } as const;

export interface Call {
  id: number;
  creator: Address;
  feed: Address;
  above: boolean;
  touched: boolean;
  settled: boolean;
  yesWon: boolean;
  openBps: number;
  start: number;
  end: number;
  strike: bigint;
  spotAtOpen: bigint;
  touchRound: bigint;
  touchPrice: bigint;
  yesPool: bigint;
  noPool: bigint;
  volume: bigint;
  text: string;
}

export interface Feed {
  address: Address;
  /** "SOL", from the feed's "SOL / USDT" description. */
  asset: string;
  decimals: number;
  enabled: boolean;
  volBps: number;
  price: bigint;
  roundId: bigint;
  updatedAt: number;
}

export interface Stats {
  posted: number;
  hits: number;
  misses: number;
  skillBps: number;
  volume: bigint;
}

export interface Params {
  feeBps: number;
  minSeed: bigint;
  maxSeed: bigint;
  minStake: bigint;
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
}

export async function readParams(): Promise<{ params: Params; stakeToken: Address; creatorShareBps: number; paused: boolean }> {
  const [p, stakeToken, creatorShareBps, paused] = await Promise.all([
    publicClient.readContract({ ...calls, functionName: "params" }),
    publicClient.readContract({ ...calls, functionName: "stakeToken" }),
    publicClient.readContract({ ...calls, functionName: "creatorShareBps" }),
    publicClient.readContract({ ...calls, functionName: "paused" }),
  ]);
  const [feeBps, minSeed, maxSeed, minStake, minWindow, maxWindow, grace, maxOracleAge, maxVolAge, minDistanceBps, maxDistanceBps, minOpenBps, maxOpenBps, betCutoffBps] = p;
  return {
    params: { feeBps, minSeed, maxSeed, minStake, minWindow, maxWindow, grace, maxOracleAge, maxVolAge, minDistanceBps, maxDistanceBps, minOpenBps, maxOpenBps, betCutoffBps },
    stakeToken,
    creatorShareBps,
    paused,
  };
}

export async function readFeeds(): Promise<Feed[]> {
  const n = Number(await publicClient.readContract({ ...calls, functionName: "feedCount" }));
  const addrs = await Promise.all(Array.from({ length: n }, (_, i) => publicClient.readContract({ ...calls, functionName: "feedList", args: [BigInt(i)] })));
  return Promise.all(
    addrs.map(async (address) => {
      const [cfg, desc, decimals, latest] = await Promise.all([
        publicClient.readContract({ ...calls, functionName: "feeds", args: [address] }),
        publicClient.readContract({ address, abi: PRICE_FEED_ABI, functionName: "description" }),
        publicClient.readContract({ address, abi: PRICE_FEED_ABI, functionName: "decimals" }),
        publicClient.readContract({ address, abi: PRICE_FEED_ABI, functionName: "latestRoundData" }),
      ]);
      return {
        address,
        asset: desc.split("/")[0].trim(),
        decimals,
        enabled: cfg[0],
        volBps: cfg[1],
        price: latest[1],
        roundId: latest[0],
        updatedAt: Number(latest[3]),
      };
    }),
  );
}

export async function readCalls(): Promise<Call[]> {
  const n = Number(await publicClient.readContract({ ...calls, functionName: "callCount" }));
  const out: Call[] = [];
  for (let from = 0; from < n; from += 50) {
    const page = await publicClient.readContract({ ...calls, functionName: "getCalls", args: [BigInt(from), 50n] });
    const texts = await Promise.all(page.map((_, i) => publicClient.readContract({ ...calls, functionName: "callText", args: [BigInt(from + i)] })));
    page.forEach((c, i) =>
      out.push({
        id: from + i,
        creator: c.creator,
        feed: c.feed,
        above: c.above,
        touched: c.touched,
        settled: c.settled,
        yesWon: c.yesWon,
        openBps: c.openBps,
        start: Number(c.start),
        end: Number(c.end),
        strike: c.strike,
        spotAtOpen: c.spotAtOpen,
        touchRound: c.touchRound,
        touchPrice: c.touchPrice,
        yesPool: c.yesPool,
        noPool: c.noPool,
        volume: c.volume,
        text: texts[i],
      }),
    );
  }
  return out;
}

export async function readCreators(): Promise<{ creator: Address; stats: Stats }[]> {
  const n = Number(await publicClient.readContract({ ...calls, functionName: "creatorCount" }));
  const out: { creator: Address; stats: Stats }[] = [];
  for (let from = 0; from < n; from += 100) {
    const [who, s] = await publicClient.readContract({ ...calls, functionName: "getCreators", args: [BigInt(from), 100n] });
    who.forEach((creator, i) =>
      out.push({ creator, stats: { posted: s[i].posted, hits: s[i].hits, misses: s[i].misses, skillBps: Number(s[i].skillBps), volume: s[i].volume } }),
    );
  }
  return out;
}

export async function readPosition(id: number, user: Address) {
  const [yes, no, hasClaimed, payoutIfYes, payoutIfNo] = await publicClient.readContract({ ...calls, functionName: "position", args: [BigInt(id), user] });
  return { yes, no, hasClaimed, payoutIfYes, payoutIfNo };
}

export async function readBalances(token: Address, user: Address) {
  const [usd, gas, allowance] = await Promise.all([
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [user] }),
    publicClient.getBalance({ address: user }),
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [user, CALLS_ADDRESS] }),
  ]);
  return { usd, gas, allowance };
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

export { calls as CALLS_CONTRACT };
