// QIE Pass for Thesis, server side. The partner secret never leaves here.
//
// Sign in with QIE ID (QIE Pass "qie-login" API):
//   POST ?action=start   { qieId }  → { qieId, code, expiresAt }   starts a sign-in; QIE Wallet gets a prompt
//   GET  ?action=status             → { status, expiresAt } | { status: "completed", address, qieId, verified }
//                                     polls QIE; on approval collects the result once, checks the user's
//                                     approval signature, and opens a session
//   POST ?action=cancel             → forgets the sign-in this browser started (QIE lets it expire)
//   GET  ?action=me                 → { address, qieId, verified } of the current session, or 401
//   POST ?action=logout             → ends the session
// Wallet badge (QIE Pass "Verify with QIE ID", step 0):
//   GET  ?action=nonce              → { nonce } single-use, for the Sign-In with Ethereum message
//   POST ?action=verify-wallet { message, signature } → { address, verified } for a wallet that just
//                                     signed that message
// Leaderboard badges:
//   GET  ?action=verified&addresses=0x…,0x… → { "0x…": true|false } QIE Pass (identity) verification,
//                                     at most 50 addresses, cached 10 min
//
// The sign-in request ID, the nonce and the session live in sealed cookies
// (AES-256-GCM, HttpOnly, SameSite=Strict): the browser can't read or choose
// them, so only the browser that started a sign-in can collect it.
//
// What a session is for: showing who is signed in (name, QIE Pass badge).
// Nothing onchain trusts it: every transaction is signed by the user's own
// wallet. Don't use it to authorise anything without re-checking here.
//
// Abuse limits: every POST must be JSON from this site (Origin / Sec-Fetch-Site),
// and start / verify-wallet are rate limited per IP and per QIE ID (Netlify
// Blobs; per-instance memory as a fallback).
//
// Env (Netlify): QIE_PASS_API_URL, QIE_PASS_PUBLIC_KEY, QIE_PASS_SECRET_KEY,
//                SESSION_SECRET (≥ 32 random bytes; cookies; fails closed if missing),
//                ALLOWED_HOSTS (optional, comma-separated extra hosts, e.g. a custom domain)
import crypto from "node:crypto";
import { connectLambda, getStore } from "@netlify/blobs";
import { createPublicClient, getAddress, http, isAddress, recoverMessageAddress } from "viem";
import { parseSiweMessage } from "viem/siwe";

const API = () => (process.env.QIE_PASS_API_URL || "https://pass-api.qie.digital") + "/api/v1/partners";
const CHAIN_ID = 1990;
const RPC = "https://rpc1mainnet.qie.digital";
/** This site, its deploy previews (<id>--thesis-qie.netlify.app), and a local dev server. */
const SITE_HOST = /^(?:[a-z0-9-]+--)?thesis-qie\.netlify\.app$/;
const DEV_HOST = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/;
const SESSION_DAYS = 7;
const LOGIN_COOKIE = "tq_login";
const SESSION_COOKIE = "tq_session";
const NONCE_COOKIE = "tq_nonce";
const QIE_TIMEOUT_MS = 8_000;
const LIMITS = {
  // [max, window seconds]
  "start:ip": [6, 600], // one browser/IP trying IDs
  "start:id-ip": [3, 600], // one IP retrying one QIE ID
  "start:id": [10, 600], // all IPs together on one QIE ID: caps prompt spam to a victim
  "verify:ip": [20, 600],
  "verified:ip": [30, 600],
};
const extraHosts = () =>
  String(process.env.ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
const siteHost = (host) => SITE_HOST.test(host) || extraHosts().includes(host) || (process.env.CONTEXT === "dev" && DEV_HOST.test(host));

const log = (...a) => console.log("[qie-pass]", ...a);

// ---- QIE Pass requests ------------------------------------------------------

function authHeaders() {
  const pk = process.env.QIE_PASS_PUBLIC_KEY;
  const sk = process.env.QIE_PASS_SECRET_KEY;
  if (!pk || !sk) throw Object.assign(new Error("QIE Pass keys are not configured"), { status: 500, code: "NOT_CONFIGURED" });
  const timestamp = Date.now().toString(); // fresh for every request, never reused
  const signature = crypto.createHmac("sha256", sk).update(pk + timestamp).digest("hex");
  return { "X-Public-Key": pk, "X-Timestamp": timestamp, "X-Signature": signature, "Content-Type": "application/json" };
}

async function qie(method, path, body) {
  let res;
  try {
    res = await fetch(API() + path, { method, headers: authHeaders(), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(QIE_TIMEOUT_MS) });
  } catch (e) {
    if (e?.status) throw e;
    log("QIE unreachable", method, path.split("?")[0].replace(/\/[^/]{16,}/g, "/…"), e?.name);
    return { status: 504, ok: false, json: { code: "QIE_TIMEOUT" }, retryAfter: null };
  }
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && json.success !== false, json, retryAfter: res.headers.get("retry-after") };
}

// ---- Sealed cookies ---------------------------------------------------------

function sealKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw Object.assign(new Error("SESSION_SECRET is not configured"), { status: 500, code: "NOT_CONFIGURED" });
  return Buffer.from(crypto.hkdfSync("sha256", secret, "thesis-qie", "cookie-seal-v2", 32));
}
/** Encrypts `obj` as a cookie of type `typ` (a login cookie can't pass as a session). */
function seal(typ, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", sealKey(), iv, { authTagLength: 16 });
  const ct = Buffer.concat([c.update(JSON.stringify({ ...obj, typ }), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}
function unseal(typ, token) {
  const key = sealKey(); // throws (fails closed) if not configured
  try {
    const buf = Buffer.from(token, "base64url");
    if (buf.length < 29) return null;
    const d = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12), { authTagLength: 16 });
    d.setAuthTag(buf.subarray(12, 28));
    const obj = JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"));
    return obj && obj.typ === typ && typeof obj.exp === "number" && obj.exp > Date.now() ? obj : null;
  } catch {
    return null;
  }
}
function readCookie(event, name) {
  const raw = event.headers?.cookie || event.headers?.Cookie || "";
  const hit = raw.split(/;\s*/).find((c) => c.startsWith(name + "="));
  return hit ? unseal(name, hit.slice(name.length + 1)) : null;
}
const cookie = (name, value, maxAgeSecs) =>
  `${name}=${value}; Path=/.netlify/functions/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(maxAgeSecs || 0))}`;
const clear = (name) => cookie(name, "", 0);

function reply(statusCode, body, cookies = [], headers = {}) {
  return {
    statusCode,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
    multiValueHeaders: cookies.length ? { "set-cookie": cookies } : undefined,
    body: JSON.stringify(body),
  };
}
const fail = (statusCode, code, message, extra = {}, cookies = []) =>
  reply(statusCode, { code, message, ...extra }, cookies, extra.retryAfterSeconds ? { "retry-after": String(extra.retryAfterSeconds) } : {});

// ---- Request checks ---------------------------------------------------------

const header = (event, name) => {
  const h = event.headers || {};
  return h[name] ?? h[name.toLowerCase()] ?? Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1];
};

/**
 * A POST must be JSON (so a cross-site form can't send it without a CORS
 * preflight, which this function never answers) and come from this site.
 */
function sameSite(event) {
  const ct = String(header(event, "content-type") || "");
  if (!/^application\/json\b/i.test(ct)) return false;
  const site = header(event, "sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = header(event, "origin");
  if (!origin) return site === "same-origin";
  try {
    const u = new URL(origin);
    return (u.protocol === "https:" || process.env.CONTEXT === "dev") && siteHost(u.host);
  } catch {
    return false;
  }
}

/** "Alice", "@alice", "alice.qie" → "alice.qie"; null if it can't be a QIE ID. */
function normalizeQieId(input) {
  let s = String(input ?? "").trim().toLowerCase().replace(/^@/, "");
  if (!s) return null;
  if (!s.includes(".")) s += ".qie";
  return /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?\.qie$/.test(s) ? s : null;
}

/** The user's IP as Netlify sees it: one address, never the whole forwarded chain. */
function clientIp(event) {
  const ip = header(event, "x-nf-client-connection-ip") || String(header(event, "x-forwarded-for") || "").split(",")[0].trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : undefined;
}

// ---- Rate limits ------------------------------------------------------------

const memory = new Map();
let warned = false;
/** This request's Blobs store (its credentials come with each event), or null. */
function limiter(event) {
  try {
    connectLambda(event);
    return getStore({ name: "qie-pass-limits", consistency: "strong" });
  } catch (e) {
    if (!warned) log("rate limits: Netlify Blobs unavailable, using per-instance memory", e?.name || "");
    warned = true;
    return null;
  }
}

/** Counts a hit on `key`; returns seconds to wait if over the limit, else 0. */
async function overLimit(event, kind, id) {
  const [max, win] = LIMITS[kind];
  const slot = Math.floor(Date.now() / 1000 / win);
  const key = `${kind}:${crypto.createHash("sha256").update(String(id)).digest("hex").slice(0, 32)}:${slot}`;
  const wait = (slot + 1) * win - Math.floor(Date.now() / 1000);
  const s = limiter(event);
  let n = 0;
  try {
    if (s) {
      n = Number((await s.get(key)) ?? 0) + 1;
      await s.set(key, String(n));
    } else throw new Error("memory");
  } catch (e) {
    if (s && !warned) {
      log("rate limits: Blobs read/write failed, using per-instance memory", e?.name || "");
      warned = true;
    }
    n = (memory.get(key) ?? 0) + 1;
    memory.set(key, n);
    if (memory.size > 5000) for (const k of [...memory.keys()].slice(0, 2500)) memory.delete(k);
  }
  return n > max ? wait : 0;
}

const tooMany = (wait) => fail(429, "RATE_LIMITED", "Too many attempts. Try again in a few minutes.", { retryAfterSeconds: wait });

// Messages for QIE's error codes (branch on code, never on message).
const START_ERRORS = {
  QIE_ID_NOT_FOUND: [404, "That QIE ID isn't registered. Check the spelling and try again."],
  REQUEST_ALREADY_OPEN: [429, "A sign-in for this QIE ID is already waiting in QIE Wallet. Approve it there, or try again shortly."],
  BLOCKED_BY_USER: [429, "Sign-in with this QIE ID isn't available right now. Please try again later."],
  RESOLVER_UNAVAILABLE: [503, "QIE couldn't look up that QIE ID right now. Try again in a few seconds."],
  PARTNER_NOT_APPROVED: [503, "Sign in with QIE ID isn't available on this site yet."],
  QIE_TIMEOUT: [504, "QIE didn't answer in time. Try again in a few seconds."],
};

// ---- Actions ----------------------------------------------------------------

async function start(event) {
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return fail(400, "BAD_REQUEST", "Invalid JSON");
  }
  const qieId = normalizeQieId(body.qieId);
  if (!qieId) return fail(400, "BAD_QIE_ID", "A QIE ID looks like yourname.qie.");
  const ip = clientIp(event) ?? "unknown";
  // The IP's own limit first: an IP already over it doesn't count against the ID.
  let wait = await overLimit(event, "start:ip", ip);
  if (!wait) wait = await overLimit(event, "start:id-ip", `${qieId}|${ip}`);
  if (!wait) wait = await overLimit(event, "start:id", qieId);
  if (wait) return tooMany(wait);
  const ua = String(header(event, "user-agent") || "").slice(0, 512);
  const client = { ...(ip !== "unknown" ? { ip } : {}), ...(ua ? { userAgent: ua } : {}) };
  const r = await qie("POST", "/qie-login/requests", { qieId, ...(Object.keys(client).length ? { client } : {}) });
  if (!r.ok) {
    const [status, message] = START_ERRORS[r.json.code] || [r.status >= 500 ? 502 : r.status, "QIE couldn't start the sign-in. Try again."];
    const retryAfterSeconds = Number(r.json.retryAfterSeconds ?? r.retryAfter) || undefined;
    return fail(status, r.json.code || "START_FAILED", message, retryAfterSeconds ? { retryAfterSeconds } : {});
  }
  const d = r.json.data || {};
  const expiresAt = Date.parse(d.expiresAt);
  if (!d.requestId || !d.code || !Number.isFinite(expiresAt)) return fail(502, "BAD_RESULT", "QIE returned an incomplete answer. Try again.");
  // Keep the request ID server-side (sealed), tied to this browser; it lives until the collect window could end.
  const exp = expiresAt + 6 * 60 * 1000;
  return reply(202, { qieId: d.qieId, code: d.code, expiresAt: d.expiresAt }, [cookie(LOGIN_COOKIE, seal(LOGIN_COOKIE, { rid: d.requestId, qieId: d.qieId, exp }), (exp - Date.now()) / 1000)]);
}

async function status(event) {
  const pending = readCookie(event, LOGIN_COOKIE);
  if (!pending) return fail(404, "NO_SIGNIN", "No sign-in in progress. Start again.");
  const r = await qie("GET", `/qie-login/requests/${encodeURIComponent(pending.rid)}`);
  if (!r.ok) {
    if (r.json.code === "REQUEST_NOT_FOUND") return fail(404, "REQUEST_NOT_FOUND", "That sign-in has ended. Start again.", {}, [clear(LOGIN_COOKIE)]);
    return fail(502, r.json.code || "STATUS_FAILED", "Couldn't reach QIE. Retrying…");
  }
  const d = r.json.data || {};
  if (d.status === "pending") return reply(200, { status: "pending", expiresAt: d.expiresAt });
  if (d.status === "rejected") return reply(200, { status: "rejected" }, [clear(LOGIN_COOKIE)]);
  if (d.status === "expired") return reply(200, { status: "expired" }, [clear(LOGIN_COOKIE)]);
  if (d.status === "completed") return fail(409, "ALREADY_COLLECTED", "This sign-in was already used. Start again.", {}, [clear(LOGIN_COOKIE)]);
  if (d.status !== "approved") return fail(502, "UNKNOWN_STATUS", "Unexpected answer from QIE. Start again.", {}, [clear(LOGIN_COOKIE)]);

  // Approved: collect exactly once, for the request this browser started.
  const c = await qie("POST", `/qie-login/requests/${encodeURIComponent(pending.rid)}/collect`);
  if (!c.ok) {
    const code = c.json.code || "COLLECT_FAILED";
    if (code === "NOT_APPROVED" || code === "QIE_TIMEOUT") return reply(200, { status: "pending", expiresAt: d.expiresAt });
    return fail(c.status === 410 ? 410 : 409, code, code === "EXPIRED" ? "The sign-in timed out. Start again." : "This sign-in can't be completed. Start again.", {}, [clear(LOGIN_COOKIE)]);
  }
  const res = c.json.data || {};
  if (!isAddress(res.walletAddress || "")) return fail(502, "BAD_RESULT", "QIE returned no wallet. Start again.", {}, [clear(LOGIN_COOKIE)]);
  const address = getAddress(res.walletAddress);
  // Our own check of the user's consent: signed by that wallet, for this request.
  const a = res.approval;
  if (!a?.message || !a?.signature) return fail(401, "NO_APPROVAL", "QIE returned no approval signature. Start again.", {}, [clear(LOGIN_COOKIE)]);
  const signer = await recoverMessageAddress({ message: a.message, signature: a.signature }).catch(() => null);
  const forThisRequest = String(a.message).split("\n").includes(`Request: ${pending.rid}`);
  if (!signer || signer.toLowerCase() !== address.toLowerCase() || !forThisRequest) {
    log("approval mismatch");
    return fail(401, "APPROVAL_MISMATCH", "The approval didn't check out. Start again.", {}, [clear(LOGIN_COOKIE)]);
  }
  const session = { address, qieId: res.qieId || pending.qieId, verified: res.isVerifiedUser === true, exp: Date.now() + SESSION_DAYS * 86_400_000 };
  return reply(200, { status: "completed", address: session.address, qieId: session.qieId, verified: session.verified, expiresAt: session.exp }, [
    clear(LOGIN_COOKIE),
    cookie(SESSION_COOKIE, seal(SESSION_COOKIE, session), SESSION_DAYS * 86_400),
  ]);
}

function me(event) {
  const s = readCookie(event, SESSION_COOKIE);
  return s ? reply(200, { address: s.address, qieId: s.qieId, verified: s.verified, expiresAt: s.exp }) : fail(401, "NO_SESSION", "Not signed in");
}

/** A single-use nonce for the wallet's Sign-In with Ethereum message (10 min). */
function nonce() {
  const n = crypto.randomBytes(12).toString("hex");
  const exp = Date.now() + 10 * 60_000;
  return reply(200, { nonce: n }, [cookie(NONCE_COOKIE, seal(NONCE_COOKIE, { n, exp }), 600)]);
}

const chain = createPublicClient({ transport: http(RPC, { timeout: 8_000 }) });
const verifiedCache = new Map(); // address -> { verified, at }

async function verifyWallet(event) {
  const wait = await overLimit(event, "verify:ip", clientIp(event) ?? "unknown");
  if (wait) return tooMany(wait);
  let message, signature;
  try {
    ({ message, signature } = JSON.parse(event.body || "{}"));
  } catch {
    return fail(400, "BAD_REQUEST", "Invalid JSON");
  }
  if (typeof message !== "string" || typeof signature !== "string" || message.length > 2000 || signature.length > 4000)
    return fail(400, "BAD_REQUEST", "message and signature required");
  const issued = readCookie(event, NONCE_COOKIE);
  const used = [clear(NONCE_COOKIE)]; // single use, whatever happens next
  if (!issued) return fail(401, "NO_NONCE", "Sign-in expired. Try again.", {}, used);
  let m;
  try {
    m = parseSiweMessage(message);
  } catch {
    return fail(400, "BAD_MESSAGE", "Not a sign-in message", {}, used);
  }
  const now = Date.now();
  const t = (d) => (d instanceof Date ? d.getTime() : NaN);
  const issuedAt = t(m.issuedAt);
  let uriOk = false;
  try {
    uriOk = new URL(m.uri ?? "").host === m.domain;
  } catch {}
  if (!m.address || !m.domain || !siteHost(String(m.domain).toLowerCase()) || !uriOk)
    return fail(401, "WRONG_SITE", "Sign-in message is for another site", {}, used);
  if (m.version !== "1" || m.chainId !== CHAIN_ID) return fail(401, "WRONG_CHAIN", "Sign-in message is for another network", {}, used);
  if (m.nonce !== issued.n) return fail(401, "BAD_NONCE", "Sign-in expired. Try again.", {}, used);
  if (!Number.isFinite(issuedAt) || now - issuedAt > 10 * 60_000 || issuedAt - now > 60_000) return fail(401, "STALE", "Sign-in message is stale", {}, used);
  if (m.expirationTime !== undefined && !(t(m.expirationTime) > now)) return fail(401, "STALE", "Sign-in message has expired", {}, used);
  if (m.notBefore !== undefined && !(t(m.notBefore) <= now)) return fail(401, "STALE", "Sign-in message isn't valid yet", {}, used);
  const address = getAddress(m.address);
  const ok = await chain.verifyMessage({ address, message, signature }).catch(() => false);
  if (!ok) return fail(401, "BAD_SIGNATURE", "Signature doesn't match the wallet", {}, used);
  const hit = verifiedCache.get(address);
  if (hit && now - hit.at < 10 * 60_000) return reply(200, { address, verified: hit.verified }, used);
  const r = await qie("GET", `/verification-requests/is-verified?identifier=${encodeURIComponent(address)}`);
  if (!r.ok) return fail(502, "QIE_UNREACHABLE", "QIE Pass is unreachable right now", {}, used);
  const verified = r.json.data?.isVerified === true;
  verifiedCache.set(address, { verified, at: now });
  if (verifiedCache.size > 5000) verifiedCache.clear();
  return reply(200, { address, verified }, used);
}

/** QIE Pass verification of many addresses (public information), for badges. */
async function verifiedMany(event) {
  const list = String(event.queryStringParameters?.addresses ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  if (!list.length || list.length > 50 || !list.every((a) => isAddress(a))) return fail(400, "BAD_REQUEST", "1 to 50 addresses, comma-separated");
  const addrs = [...new Set(list.map((a) => getAddress(a)))];
  const now = Date.now();
  const todo = addrs.filter((a) => !(verifiedCache.get(a) && now - verifiedCache.get(a).at < 10 * 60_000));
  if (todo.length) {
    const wait = await overLimit(event, "verified:ip", clientIp(event) ?? "unknown");
    if (wait) return tooMany(wait);
    for (let i = 0; i < todo.length; i += 5) {
      await Promise.all(
        todo.slice(i, i + 5).map(async (a) => {
          const r = await qie("GET", `/verification-requests/is-verified?identifier=${encodeURIComponent(a)}`);
          if (r.ok) verifiedCache.set(a, { verified: r.json.data?.isVerified === true, at: now });
        }),
      );
    }
    if (verifiedCache.size > 5000) verifiedCache.clear();
  }
  const out = {};
  for (const a of addrs) if (verifiedCache.has(a)) out[a] = verifiedCache.get(a).verified;
  return reply(200, out, [], { "cache-control": "public, max-age=300" });
}

export const handler = async (event) => {
  const action = event.queryStringParameters?.action;
  const method = event.httpMethod;
  try {
    if (method === "POST" && !sameSite(event)) return fail(403, "FORBIDDEN", "Requests must come from this site.");
    if (action === "start" && method === "POST") return await start(event);
    if (action === "status" && method === "GET") return await status(event);
    if (action === "cancel" && method === "POST") return reply(200, { ok: true }, [clear(LOGIN_COOKIE)]);
    if (action === "me" && method === "GET") return me(event);
    if (action === "logout" && method === "POST") return reply(200, { ok: true }, [clear(SESSION_COOKIE), clear(LOGIN_COOKIE), clear(NONCE_COOKIE)]);
    if (action === "nonce" && method === "GET") return nonce();
    if (action === "verify-wallet" && method === "POST") return await verifyWallet(event);
    if (action === "verified" && method === "GET") return await verifiedMany(event);
    return fail(404, "NOT_FOUND", "Unknown action");
  } catch (e) {
    log("error", action, e?.code || e?.name || "Error", String(e?.message || "").slice(0, 120));
    if (e?.code === "NOT_CONFIGURED") return fail(503, "NOT_CONFIGURED", "Sign-in is being set up. Try again shortly.");
    return fail(e?.status || 502, "SERVER_ERROR", "Something went wrong talking to QIE. Try again.");
  }
};

// For tests.
export const _internal = { normalizeQieId, sameSite, seal, unseal, LIMITS, resetLimits: () => memory.clear() };
