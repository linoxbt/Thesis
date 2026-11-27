// Link previews for single calls, so a shared link unfurls into that call's
// own card on X, Telegram, Discord and the rest (the site itself is a static
// export, so it can't put per-call tags in /t/?id=N).
//
//   GET /s/<id>                       (rewritten to /.netlify/functions/share/<id> by _redirects)
//       → a tiny HTML page with the call's Open Graph / X card tags that sends
//         people on to /t/?id=<id>
//   GET /.netlify/functions/share/<id>?img=1&v=<state>  → the 1200×630 PNG card
// The id is read from the path (or ?id=). Any other query (junk, or an
// out-of-date `v`) gets a redirect to the canonical URL, so the CDN caches
// one response per call state and junk can't force fresh renders.
//
// Everything on the card is read from the chain (and QIE's name service).
// THESIS_CALLS / THESIS_RPC / THESIS_SITE are fixed at bundle time
// (scripts/deploy-netlify.mjs) from the app's build settings.
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import satori from "satori";
import { createPublicClient, fallback, http } from "viem";
import wasm from "@resvg/resvg-wasm/index_bg.wasm";
import soraBold from "@fontsource/sora/files/sora-latin-600-normal.woff";
import inter from "@fontsource/inter/files/inter-latin-400-normal.woff";
import mono from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff";
import { PRICE_FEED_ABI, THESIS_CALLS_ABI } from "../../lib/abi.ts";

const CALLS = process.env.THESIS_CALLS;
const SITE = process.env.THESIS_SITE || "https://thesis-qie.netlify.app";
const RPCS = (process.env.THESIS_RPC || [1, 2, 3, 4, 5].map((n) => `https://rpc${n}mainnet.qie.digital`).join(",")).split(",");
const MCP = "https://mcp.qie.digital/mcp";

const client = createPublicClient({ transport: fallback(RPCS.map((u) => http(u, { timeout: 6_000, retryCount: 1 }))) });
let wasmReady = null;

const C = { bg: "#f4f2ec", panel: "#ffffff", ink: "#16171b", muted: "#6b6a64", faint: "#a3a19a", line: "#e4e1d8", brand: "#ff6a3d", yes: "#1f9e6a", bad: "#d64545" };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const usd = (v) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: v >= 1000 ? 0 : 2, maximumFractionDigits: v >= 1000 ? 0 : 2 });
const pct = (bps, d = 0) => (bps / 100).toFixed(d) + "%";
// A call is staked in native QIE (the zero address, 18 decimals) or a token
// (its own symbol and decimals, read from the token).
const NATIVE = "0x0000000000000000000000000000000000000000";
const ERC20_META = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
];
const tokenMeta = new Map();
async function tokenOf(token) {
  if (token.toLowerCase() === NATIVE) return { symbol: "QIE", decimals: 18 };
  if (!tokenMeta.has(token)) {
    const [symbol, decimals] = await Promise.all([
      client.readContract({ address: token, abi: ERC20_META, functionName: "symbol" }),
      client.readContract({ address: token, abi: ERC20_META, functionName: "decimals" }),
    ]);
    tokenMeta.set(token, { symbol: String(symbol).replace(/[^\w.-]/g, "").slice(0, 12) || "token", decimals: Number(decimals) });
  }
  return tokenMeta.get(token);
}
const stake = (v, t) => {
  const n = Number(v) / 10 ** t.decimals;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: n !== 0 && n < 1 ? 4 : 0 })} ${t.symbol}`;
};

/** The call id from /s/<id>, /share/<id> or ?id=<id>; null if none or malformed. */
export function callIdFrom(event) {
  const q = event.queryStringParameters ?? {};
  const fromQuery = q.id != null ? String(q.id).replace(/\/$/, "") : null;
  const paths = [event.path, event.rawUrl, event.headers?.["x-nf-original-path"]].filter(Boolean).map(String);
  const fromPath = paths.map((p) => /\/(?:s|share)\/(\d{1,9})\/?(?:[?#]|$)/.exec(p)?.[1]).find(Boolean) ?? null;
  const raw = fromQuery ?? fromPath;
  return raw != null && /^\d{1,9}$/.test(raw) ? Number(raw) : null;
}
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const when = (ts) => new Date(ts * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";

/** QIE ID for an address (reverse lookup, accepted only if it resolves back), or null. */
async function qieName(address) {
  const call = async (name, args) => {
    const r = await fetch(MCP, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      signal: AbortSignal.timeout(2_500),
    });
    const text = await r.text();
    const json = JSON.parse(text.startsWith("{") ? text : (text.match(/^data: (.*)$/m)?.[1] ?? "{}"));
    return json?.result?.structuredContent ?? null;
  };
  try {
    const rev = await call("qie_reverse_lookup", { address });
    const name = rev?.name;
    if (!name || !/^[a-z0-9-]{1,64}\.qie$/.test(name)) return null;
    const fwd = await call("qie_resolve_name", { name });
    return fwd?.address?.toLowerCase() === address.toLowerCase() ? name : null;
  } catch {
    return null;
  }
}

async function readCall(id) {
  const calls = { address: CALLS, abi: THESIS_CALLS_ABI };
  const c = await client.readContract({ ...calls, functionName: "getCall", args: [BigInt(id)] });
  const [text, desc, decimals, name, tok] = await Promise.all([
    client.readContract({ ...calls, functionName: "callText", args: [BigInt(id)] }),
    client.readContract({ address: c.feed, abi: PRICE_FEED_ABI, functionName: "description" }),
    client.readContract({ address: c.feed, abi: PRICE_FEED_ABI, functionName: "decimals" }),
    qieName(c.creator),
    tokenOf(c.token),
  ]);
  const scale = 10 ** decimals;
  const entry = Number(c.spotAtOpen) / scale;
  const tp = Number(c.strike) / scale;
  const pot = c.yesPool + c.noPool;
  const crowd = pot === 0n ? c.openBps : Number((c.yesPool * 10_000n) / pot);
  const now = Math.floor(Date.now() / 1000);
  const status = c.voided ? "void · refunded" : c.settled ? (c.yesWon ? "called it" : "missed") : Number(c.end) > now ? "live" : "window closed";
  return {
    id,
    asset: desc.split("/")[0].trim(),
    long: c.above,
    entry,
    tp,
    move: ((c.above ? 1 : -1) * (tp - entry) * 100) / entry,
    end: Number(c.end),
    crowd,
    open: c.openBps,
    pot,
    token: tok,
    creator: name ?? short(c.creator),
    status,
    text,
  };
}

/** satori element helper. */
const h = (type, style, ...children) => ({ type, props: { style: { display: "flex", ...style }, children: children.flat().filter((x) => x !== null && x !== undefined && x !== false) } });

function card(d) {
  const side = d.long ? C.yes : C.bad;
  const cell = (k, v, color, sub) =>
    h("div", { flexDirection: "column", flex: 1, padding: "0 36px" },
      h("div", { fontFamily: "Mono", fontSize: 18, color: C.faint, letterSpacing: 1 }, k),
      h("div", { fontFamily: "Mono", fontSize: 36, color, marginTop: 12, whiteSpace: "nowrap" }, v),
      sub ? h("div", { fontFamily: "Mono", fontSize: 20, color, marginTop: 6 }, sub) : null);
  return h("div", { width: 1200, height: 630, flexDirection: "column", backgroundColor: C.bg, backgroundImage: "radial-gradient(circle at 92% 6%, rgba(255,106,61,0.22), rgba(255,106,61,0) 45%)", padding: "52px 64px 0", fontFamily: "Inter", color: C.ink, position: "relative" },
    h("div", { alignItems: "center", justifyContent: "space-between" },
      h("div", { alignItems: "center" },
        h("div", { width: 44, height: 44, position: "relative" },
          h("div", { position: "absolute", left: 1, top: 2, width: 42, height: 8, borderRadius: 2, backgroundColor: C.ink }),
          h("div", { position: "absolute", left: 17, top: 14, width: 10, height: 30, borderRadius: 2, backgroundColor: C.ink }),
          h("div", { position: "absolute", left: 16, top: 6, width: 12, height: 12, borderRadius: 6, backgroundColor: C.brand })),
        h("div", { fontFamily: "Sora", fontSize: 30, marginLeft: 14 }, "Thesis")),
      h("div", { fontFamily: "Mono", fontSize: 20, color: C.muted }, d.status.toUpperCase())),
    h("div", { alignItems: "center", marginTop: 28 },
      h("div", { fontFamily: "Mono", fontSize: 24, color: side, backgroundColor: d.long ? "rgba(31,158,106,0.12)" : "rgba(214,69,69,0.12)", padding: "8px 18px", borderRadius: 10 }, d.long ? "LONG" : "SHORT"),
      h("div", { fontFamily: "Sora", fontSize: 64, marginLeft: 24, letterSpacing: -2 }, `${d.asset} / USDT`)),
    h("div", { marginTop: 26, backgroundColor: C.panel, border: `2px solid ${C.line}`, borderRadius: 24, padding: "28px 0" },
      cell("ENTRY", usd(d.entry), C.ink),
      cell("TAKE PROFIT", usd(d.tp), side, `${d.move >= 0 ? "+" : "−"}${Math.abs(d.move).toFixed(1)}%`),
      cell("DEADLINE (UTC)", when(d.end).replace(" UTC", ""), C.ink)),
    h("div", { alignItems: "flex-end", marginTop: 22 },
      h("div", { flexDirection: "column" },
        h("div", { fontSize: 24, color: C.muted }, "Crowd says"),
        h("div", { fontFamily: "Sora", fontSize: 52 }, pct(d.crowd))),
      h("div", { fontSize: 24, color: C.muted, marginLeft: 26, marginBottom: 8 }, `YES · opened at ${pct(d.open)} · pot ${stake(d.pot, d.token)}`)),
    d.text ? h("div", { fontSize: 22, color: C.muted, marginTop: 8, maxWidth: 1072, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }, `“${d.text}”`) : null,
    h("div", { position: "absolute", left: 64, right: 64, bottom: 30, justifyContent: "space-between", fontFamily: "Mono", fontSize: 20 },
      h("div", { color: C.faint, maxWidth: 420, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }, `by ${d.creator}`),
      h("div", { color: C.ink }, "thesis-qie.netlify.app · back it or challenge it on QIE")),
    h("div", { position: "absolute", left: 0, right: 0, bottom: 0, height: 8, backgroundColor: C.brand }));
}

async function png(d) {
  wasmReady ??= initWasm(wasm);
  await wasmReady;
  const svg = await satori(card(d), {
    width: 1200,
    height: 630,
    fonts: [
      { name: "Sora", data: soraBold, weight: 600, style: "normal" },
      { name: "Inter", data: inter, weight: 400, style: "normal" },
      { name: "Mono", data: mono, weight: 500, style: "normal" },
    ],
  });
  return new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
}

function page(d) {
  const url = `${SITE}/t/?id=${d.id}`;
  const title = `${d.long ? "Long" : "Short"} ${d.asset}: take profit ${usd(d.tp)} — crowd says ${pct(d.crowd)}`;
  const desc = `${d.text ? d.text + " · " : ""}Entry ${usd(d.entry)}, deadline ${when(d.end)}. Back it or challenge it in ${d.token.symbol} on Thesis, settled by the QIE Oracle.`;
  // The image URL changes with the call's state, so caches pick up new odds and outcomes.
  const img = imageUrl(d);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Thesis on QIE">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(img)}">
<meta http-equiv="refresh" content="0;url=${esc(url)}"><link rel="canonical" href="${esc(url)}">
</head><body style="font-family:sans-serif;background:#f4f2ec;color:#16171b"><p><a href="${esc(url)}">Open this call on Thesis</a></p></body></html>`;
}

const NOSNIFF = { "x-content-type-options": "nosniff" };
const notFound = () => ({ statusCode: 302, headers: { ...NOSNIFF, location: `${SITE}/app/`, "cache-control": "no-store" }, body: "" });
const redirect = (to) => ({ statusCode: 301, headers: { ...NOSNIFF, location: to, "cache-control": "public, max-age=60" }, body: "" });
const stateTag = (d) => `${d.status.replace(/\W/g, "")}-${d.crowd}`;
const imageUrl = (d) => `${SITE}/.netlify/functions/share/${d.id}?img=1&v=${stateTag(d)}`;

export const handler = async (event) => {
  const q = event.queryStringParameters ?? {};
  const id = callIdFrom(event);
  if (id === null || !CALLS) return notFound();
  const wantImg = q.img === "1";
  // Only canonical queries are served: the page takes none (beyond a legacy
  // ?id=), the image takes img=1 and v. Anything else is redirected before
  // any RPC read or render.
  const extra = Object.keys(q).filter((k) => !(k === "id" || (wantImg && (k === "img" || k === "v"))));
  if (extra.length) return redirect(wantImg ? `${SITE}/.netlify/functions/share/${id}?img=1` : `${SITE}/s/${id}`);
  try {
    if (id >= Number(await client.readContract({ address: CALLS, abi: THESIS_CALLS_ABI, functionName: "callCount" }))) return notFound();
    const d = await readCall(id);
    if (wantImg) {
      // An out-of-date (or made-up) state tag: point at the current one, without rendering.
      if (q.v !== stateTag(d)) return redirect(imageUrl(d));
      const buf = await png(d);
      return {
        statusCode: 200,
        headers: { ...NOSNIFF, "content-type": "image/png", "cache-control": "public, max-age=300", "netlify-cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=600" },
        body: Buffer.from(buf).toString("base64"),
        isBase64Encoded: true,
      };
    }
    return {
      statusCode: 200,
      headers: {
        ...NOSNIFF,
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=60",
        "netlify-cdn-cache-control": "public, s-maxage=60, stale-while-revalidate=120",
        "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
      body: page(d),
    };
  } catch (e) {
    console.log("[share] error", id, e?.shortMessage || e?.message);
    // Never strand a visitor: send them to the call page anyway.
    return { statusCode: 302, headers: { ...NOSNIFF, location: `${SITE}/t/?id=${id}`, "cache-control": "no-store" }, body: "" };
  }
};

export const _internal = { card, page, png, readCall, stateTag, imageUrl };
