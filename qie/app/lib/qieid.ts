import { createPublicClient, getAddress, http, isAddress, zeroAddress, type Address } from "viem";

/**
 * QIE ID: human-readable names (`alex.qie`) for wallet addresses. QIE IDs live
 * on QIE mainnet only, and an address is the same on every network, so lookups
 * always go to mainnet whichever network the app runs on.
 *
 *   name → address  the paid-ID record store onchain (`resolveCurrency(name, "qie")`),
 *                   then QIE's read-only lookup service, which also covers free IDs
 *   address → name  QIE's lookup service; the name is used only if it resolves
 *                   back to the same address
 *
 * The lookup service is QIE's public MCP server (mcp.qie.digital): read-only,
 * no keys, CORS open.
 *
 * Trust: paid IDs are checked against the onchain store; free IDs exist only
 * in QIE's service, so for those the round trip checks consistency, and the
 * trust is in QIE itself. Names are display only: nothing here sends funds to
 * a name, and the address is always one click away. "No name" is cached for
 * 10 minutes, names for 6 hours.
 */
const MAINNET_RPC = "https://rpc1mainnet.qie.digital";
const QIE_ID_STORE = "0x8777d01d509D0eA71FB38F88F79867da558d5018" as const;
const LOOKUP = "https://mcp.qie.digital/mcp";
const STORE_ABI = [
  { type: "function", name: "resolveCurrency", stateMutability: "view", inputs: [{ name: "domain_", type: "string" }, { name: "currency_", type: "string" }], outputs: [{ type: "address" }] },
] as const;

const mainnet = createPublicClient({ transport: http(MAINNET_RPC) });

/** "Alex", "@alex", "alex.qie" → "alex.qie"; null if it can't be a QIE ID. */
export function normalizeQieId(input: string): string | null {
  let s = input.trim().toLowerCase().replace(/^@/, "");
  if (!s) return null;
  if (!s.includes(".")) s += ".qie";
  return /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?\.qie$/.test(s) ? s : null;
}

let rpcId = 0;
async function lookup<T>(tool: string, args: Record<string, string>): Promise<T | null> {
  const res = await fetch(LOOKUP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name: tool, arguments: { ...args, network: "mainnet" } } }),
  });
  if (!res.ok) throw new Error(`QIE ID lookup failed (${res.status})`);
  const text = await res.text();
  // The server answers as JSON or as a server-sent event ("data: {...}").
  const body = text.trimStart().startsWith("{") ? text : (text.split("\n").find((l) => l.startsWith("data:")) ?? "").slice(5);
  const msg = JSON.parse(body) as { result?: { structuredContent?: T; isError?: boolean }; error?: { message: string } };
  if (msg.error) throw new Error(msg.error.message);
  return msg.result?.isError ? null : (msg.result?.structuredContent ?? null);
}

const forward = new Map<string, Promise<Address | null>>();

/** The wallet address a QIE ID points to, or null if it isn't registered. */
export function resolveQieId(input: string): Promise<Address | null> {
  const name = normalizeQieId(input);
  if (!name) return Promise.resolve(null);
  if (!forward.has(name)) {
    const p = (async () => {
      const onchain = await mainnet
        .readContract({ address: QIE_ID_STORE, abi: STORE_ABI, functionName: "resolveCurrency", args: [name, "qie"] })
        .catch(() => zeroAddress);
      if (onchain !== zeroAddress) return getAddress(onchain);
      const r = await lookup<{ address: string | null }>("qie_resolve_name", { name });
      return r?.address && isAddress(r.address) ? getAddress(r.address) : null;
    })();
    forward.set(name, p);
    p.catch(() => forward.delete(name)); // retry on the next ask after a network error
  }
  return forward.get(name)!;
}

const CACHE_KEY = "thesis-qieid-names";
const TTL = 6 * 3600 * 1000;
/** "No name" is cached briefly: a newly bought or transferred ID should show up soon. */
const MISS_TTL = 10 * 60 * 1000;
const reverse = new Map<string, Promise<string | null>>();

function cached(addr: string): string | null | undefined {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<string, [string | null, number]>;
    const hit = all[addr];
    return hit && Date.now() - hit[1] < (hit[0] ? TTL : MISS_TTL) ? hit[0] : undefined;
  } catch {
    return undefined;
  }
}
function remember(addr: string, name: string | null) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<string, [string | null, number]>;
    all[addr] = [name, Date.now()];
    const keys = Object.keys(all);
    if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete all[k];
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    /* storage full or blocked: lookups still work, just uncached */
  }
}

// At most four lookups in flight: a leaderboard can name many wallets at once.
let active = 0;
const queue: (() => void)[] = [];
async function limited<T>(f: () => Promise<T>): Promise<T> {
  if (active >= 4) await new Promise<void>((r) => queue.push(r));
  active++;
  try {
    return await f();
  } finally {
    active--;
    queue.shift()?.();
  }
}

/** Forgets what's known about an address (after it gets a new QIE ID). */
export function forgetQieId(address: string) {
  const addr = address.toLowerCase();
  reverse.delete(addr);
  forward.clear();
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<string, unknown>;
    delete all[addr];
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    /* nothing cached */
  }
}

/** The QIE ID of an address, or null. Only a name that resolves back to the address is returned. */
export function qieIdOf(address: string): Promise<string | null> {
  if (!isAddress(address)) return Promise.resolve(null);
  const addr = address.toLowerCase();
  const hit = typeof window !== "undefined" ? cached(addr) : undefined;
  if (hit !== undefined) return Promise.resolve(hit);
  if (!reverse.has(addr)) {
    const p = limited(async () => {
      const r = await lookup<{ name: string | null }>("qie_reverse_lookup", { address: getAddress(addr) });
      const name = r?.name ? normalizeQieId(r.name) : null;
      const back = name ? await resolveQieId(name) : null;
      const ok = name && back && back.toLowerCase() === addr ? name : null;
      remember(addr, ok);
      return ok;
    });
    reverse.set(addr, p);
    p.catch(() => reverse.delete(addr));
  }
  return reverse.get(addr)!;
}
