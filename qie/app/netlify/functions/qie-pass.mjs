// QIE Pass for Thesis, server side. The partner secret never leaves here.
//
// Sign in with QIE ID (QIE Pass "qie-login" API):
//   GET  ?action=challenge          → { challenge, bits } a small proof-of-work, single use, 2 min
//   POST ?action=start   { qieId, pow: { challenge, nonce } } → { qieId, code, expiresAt }
//                                     starts a sign-in; QIE Wallet gets a prompt
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
//                                     at most 10 addresses, cached 10 min
//
// The sign-in request ID, the nonce and the session live in sealed cookies
// (AES-256-GCM, HttpOnly, SameSite=Strict): the browser can't read or choose
// them, so only the browser that started a sign-in can collect it.
//
// What a session is for: showing who is signed in (name, QIE Pass badge).
// Nothing onchain trusts it: every transaction is signed by the user's own
// wallet. Don't use it to authorise anything without re-checking here.
//
// Abuse limits: every POST must be JSON from this site (Origin / Sec-Fetch-Site);
// starting a sign-in (which prompts a wallet) costs a proof-of-work and is
// limited per IP (IPv6 per /64) and per IP + QIE ID, never per QIE ID alone, so
// nobody can lock an owner out of their own sign-in; status polls, wallet checks
// and badge lookups are limited per IP. Counters are atomic (Netlify Blobs
// conditional writes); if Blobs is down they fall back to per-instance memory
// and log an ALERT. Nonces, proofs-of-work and logged-out sessions are
// remembered server-side, so none can be replayed.
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
/** This site (not deploy previews or old deploy permalinks), and a local dev server. */
const SITE_HOST = /^thesis-qie\.netlify\.app$/;
const DEV_HOST = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/;
const SESSION_DAYS = 7;
const LOGIN_COOKIE = "tq_login";
const SESSION_COOKIE = "tq_session";
const NONCE_COOKIE = "tq_nonce";
const QIE_TIMEOUT_MS = 8_000;
/** Leading zero bits the start proof-of-work needs (~260k hashes: well under a second in a browser). */
const POW_BITS = 18;
const POW_TTL_MS = 120_000;
const MAX_BADGES = 10;
const LIMITS = {
  // [max, window seconds]
  "start:ip": [6, 600], // one browser/IP (/64 for IPv6) trying IDs
  "start:id-ip": [3, 600], // one IP retrying one QIE ID
  "status:ip": [300, 600], // sign-in polling (every 2–3 s while a prompt is open)
  "verify:ip": [20, 600],
  "verified:ip": [60, 600], // badge lookups: counted per address looked up at QIE
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
  // At least 32 characters, and not a trivially repetitive one (a random hex
  // secret uses up to 16 different characters; ask for 10).
  if (!secret || secret.length < 32 || new Set(secret).size < 10) throw Object.assign(new Error("SESSION_SECRET is not configured"), { status: 500, code: "NOT_CONFIGURED" });
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
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers },
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

/**
 * The bucket an IP is limited in: IPv4 as is, IPv6 by its /64 (one user
 * typically holds a whole /64, so per-address limits would mean no limit).
 */
function ipBucket(ip) {
  if (!ip || !ip.includes(":")) return ip ?? "unknown";
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1); // IPv4-mapped
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return full.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

// ---- Rate limits ------------------------------------------------------------

const memory = new Map();
let alertedAt = 0;
/** Rate limits and replay guards are degraded: say so loudly (at most once a minute per instance). */
function alert(what, e) {
  if (Date.now() - alertedAt < 60_000) return;
  alertedAt = Date.now();
  console.error(`[qie-pass] ALERT: ${what}; using per-instance memory`, e?.name || "");
}
let testStore = null; // tests inject a store with Blobs' semantics
/** This request's Blobs store (its credentials come with each event), or null. */
function limiter(event) {
  if (testStore) return testStore;
  try {
    connectLambda(event);
    return getStore({ name: "qie-pass-limits", consistency: "strong" });
  } catch (e) {
    alert("Netlify Blobs unavailable", e);
    return null;
  }
}
const memAdd = (key, inc) => {
  const n = (memory.get(key) ?? 0) + inc;
  memory.set(key, n);
  if (memory.size > 5000) for (const k of [...memory.keys()].slice(0, 2500)) memory.delete(k);
  return n;
};

/**
 * Adds `inc` to a counter atomically (compare-and-swap on the entry's ETag, so
 * parallel requests can't all read the same count). Gives up, and counts as
 * over the limit, if it keeps losing the race.
 */
async function bump(s, key, inc) {
  for (let i = 0; i < 12; i++) {
    const cur = await s.getWithMetadata(key, { type: "text" });
    const n = (cur ? Number(cur.data) || 0 : 0) + inc;
    const w = cur ? await s.set(key, String(n), { onlyIfMatch: cur.etag }) : await s.set(key, String(n), { onlyIfNew: true });
    if (w?.modified) return n;
    await new Promise((r) => setTimeout(r, Math.random() * 15 * (i + 1))); // lost the race: back off, retry
  }
  return Infinity;
}

/** Counts `inc` hits on `kind`/`id`; returns seconds to wait if over the limit, else 0. */
async function overLimit(event, kind, id, inc = 1) {
  const [max, win] = LIMITS[kind];
  const slot = Math.floor(Date.now() / 1000 / win);
  const key = `${kind}:${crypto.createHash("sha256").update(String(id)).digest("hex").slice(0, 32)}:${slot}`;
  const wait = (slot + 1) * win - Math.floor(Date.now() / 1000);
  const s = limiter(event);
  let n;
  try {
    if (!s) throw new Error("no store");
    n = await bump(s, key, inc);
  } catch (e) {
    if (s) alert("Blobs read/write failed", e);
    n = memAdd(key, inc);
  }
  return n > max ? wait : 0;
}

/** True the first time `key` is seen (nonces, proofs-of-work); false on a replay. */
async function firstUse(event, key) {
  const s = limiter(event);
  try {
    if (!s) throw new Error("no store");
    const w = await s.set(`once:${key}`, "1", { onlyIfNew: true });
    return Boolean(w?.modified);
  } catch (e) {
    if (s) alert("Blobs write failed (replay guard)", e);
    return memAdd(`once:${key}`, 1) === 1;
  }
}

const sha256hex = (s) => crypto.createHash("sha256").update(s).digest("hex");
/** Leading zero bits of a hex digest. */
function zeroBits(hex) {
  let bits = 0;
  for (const ch of hex) {
    const v = parseInt(ch, 16);
    if (v === 0) {
      bits += 4;
      continue;
    }
    return bits + Math.clz32(v) - 28;
  }
  return bits;
}

/** A proof-of-work challenge for starting a sign-in (sealed: the browser can't forge one). */
function challenge() {
  const c = seal("tq_pow", { r: crypto.randomBytes(12).toString("hex"), exp: Date.now() + POW_TTL_MS });
  return reply(200, { challenge: c, bits: POW_BITS });
}
/** The proof is valid, fresh, and used for the first time. */
async function proofOk(event, pow) {
  if (!pow || typeof pow.challenge !== "string" || typeof pow.nonce !== "string" || pow.challenge.length > 400 || pow.nonce.length > 40) return false;
  if (!unseal("tq_pow", pow.challenge)) return false;
  if (zeroBits(sha256hex(`${pow.challenge}:${pow.nonce}`)) < POW_BITS) return false;
  return firstUse(event, `pow:${sha256hex(pow.challenge)}`);
}

/** Whether a session was ended by logging out (best effort: Blobs down means not revoked). */
async function revoked(event, sid) {
  const s = limiter(event);
  if (!s || !sid) return false;
  try {
    return (await s.get(`revoked:${sid}`)) !== null;
  } catch (e) {
    alert("Blobs read failed (session revocation)", e);
    return false;
  }
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
  sealKey(); // fails closed (503) before anything else if sessions can't be sealed
  const qieId = normalizeQieId(body.qieId);
  if (!qieId) return fail(400, "BAD_QIE_ID", "A QIE ID looks like yourname.qie.");
  // Each wallet prompt costs a fresh proof-of-work (checked first: a bad one
  // doesn't use up anyone's allowance).
  if (!(await proofOk(event, body.pow))) return fail(400, "BAD_PROOF", "Sign-in check failed. Try again.");
  const ip = clientIp(event) ?? "unknown";
  const bucket = ipBucket(ip);
  // The IP's own limit first: an IP already over it doesn't count against the ID.
  // (No limit on a QIE ID alone: strangers mustn't be able to lock its owner out.)
  let wait = await overLimit(event, "start:ip", bucket);
  if (!wait) wait = await overLimit(event, "start:id-ip", `${qieId}|${bucket}`);
  if (wait) return tooMany(wait);
  const ua = String(header(event, "user-agent") || "").slice(0, 512);
  const client = { ...(ip !== "unknown" ? { ip } : {}), ...(ua ? { userAgent: ua } : {}) };
  const r = await qie("POST", "/qie-login/requests", { qieId, ...(Object.keys(client).length ? { client } : {}) });
  if (!r.ok) {
    const known = START_ERRORS[r.json.code];
    const [status, message] = known || [r.status >= 500 ? 502 : 400, "QIE couldn't start the sign-in. Try again."];
    const retryAfterSeconds = Number(r.json.retryAfterSeconds ?? r.retryAfter) || undefined;
    if (!known) log("start: QIE answered", r.status, String(r.json.code || "").slice(0, 40));
    // Only our own codes go to the browser.
    return fail(status, known ? r.json.code : "START_FAILED", message, retryAfterSeconds ? { retryAfterSeconds } : {});
  }
  const d = r.json.data || {};
  const expiresAt = Date.parse(d.expiresAt);
  if (!d.requestId || !d.code || !Number.isFinite(expiresAt)) return fail(502, "BAD_RESULT", "QIE returned an incomplete answer. Try again.");
  // Keep the request ID server-side (sealed), tied to this browser; it lives until the collect window could end.
  const exp = expiresAt + 6 * 60 * 1000;
  return reply(202, { qieId: d.qieId, code: d.code, expiresAt: d.expiresAt }, [cookie(LOGIN_COOKIE, seal(LOGIN_COOKIE, { rid: d.requestId, qieId: d.qieId, exp }), (exp - Date.now()) / 1000)]);
}

async function status(event) {
  const wait = await overLimit(event, "status:ip", ipBucket(clientIp(event)));
  if (wait) return tooMany(wait);
  const pending = readCookie(event, LOGIN_COOKIE);
  if (!pending) return fail(404, "NO_SIGNIN", "No sign-in in progress. Start again.");
  const r = await qie("GET", `/qie-login/requests/${encodeURIComponent(pending.rid)}`);
  if (!r.ok) {
    if (r.json.code === "REQUEST_NOT_FOUND") return fail(404, "REQUEST_NOT_FOUND", "That sign-in has ended. Start again.", {}, [clear(LOGIN_COOKIE)]);
    return fail(502, "STATUS_FAILED", "Couldn't reach QIE. Retrying…");
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
    const expired = code === "EXPIRED";
    return fail(c.status === 410 ? 410 : 409, expired ? "EXPIRED" : "COLLECT_FAILED", expired ? "The sign-in timed out. Start again." : "This sign-in can't be completed. Start again.", {}, [clear(LOGIN_COOKIE)]);
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
  const session = { sid: crypto.randomBytes(12).toString("hex"), address, qieId: res.qieId || pending.qieId, verified: res.isVerifiedUser === true, exp: Date.now() + SESSION_DAYS * 86_400_000 };
  return reply(200, { status: "completed", address: session.address, qieId: session.qieId, verified: session.verified, expiresAt: session.exp }, [
    clear(LOGIN_COOKIE),
    cookie(SESSION_COOKIE, seal(SESSION_COOKIE, session), SESSION_DAYS * 86_400),
  ]);
}

async function me(event) {
  const s = readCookie(event, SESSION_COOKIE);
  if (!s || (await revoked(event, s.sid))) return fail(401, "NO_SESSION", "Not signed in", {}, s ? [clear(SESSION_COOKIE)] : []);
  return reply(200, { address: s.address, qieId: s.qieId, verified: s.verified, expiresAt: s.exp });
}

/** Ends the session here and server-side: a copied cookie stops working too. */
async function logout(event) {
  const s = readCookie(event, SESSION_COOKIE);
  const store = s?.sid ? limiter(event) : null;
  if (store) {
    try {
      await store.set(`revoked:${s.sid}`, String(s.exp));
    } catch (e) {
      alert("Blobs write failed (logout)", e);
    }
  }
  return reply(200, { ok: true }, [clear(SESSION_COOKIE), clear(LOGIN_COOKIE), clear(NONCE_COOKIE)]);
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
  const wait = await overLimit(event, "verify:ip", ipBucket(clientIp(event)));
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
  // Single use server-side too: a kept copy of the cookie can't replay this nonce.
  if (!(await firstUse(event, `nonce:${issued.n}`))) return fail(401, "NONCE_USED", "Sign-in expired. Try again.", {}, used);
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
  if (!list.length || list.length > MAX_BADGES || !list.every((a) => isAddress(a))) return fail(400, "BAD_REQUEST", `1 to ${MAX_BADGES} addresses, comma-separated`);
  const addrs = [...new Set(list.map((a) => getAddress(a)))];
  const now = Date.now();
  const todo = addrs.filter((a) => !(verifiedCache.get(a) && now - verifiedCache.get(a).at < 10 * 60_000));
  if (todo.length) {
    // Each address looked up at QIE counts (cached ones are free).
    const wait = await overLimit(event, "verified:ip", ipBucket(clientIp(event)), todo.length);
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
    if (action === "challenge" && method === "GET") return challenge();
    if (action === "me" && method === "GET") return await me(event);
    if (action === "logout" && method === "POST") return await logout(event);
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
export const _internal = {
  normalizeQieId,
  sameSite,
  seal,
  unseal,
  ipBucket,
  zeroBits,
  sha256hex,
  bump,
  POW_BITS,
  LIMITS,
  MAX_BADGES,
  resetLimits: () => memory.clear(),
  useStore: (s) => (testStore = s),
};
