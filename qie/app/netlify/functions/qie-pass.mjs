// QIE Pass for Thesis, server side. The partner secret never leaves here.
//
// Sign in with QIE ID (QIE Pass "qie-login" API):
//   POST ?action=start   { qieId }  → { qieId, code, expiresAt }   starts a sign-in; QIE Wallet gets a prompt
//   GET  ?action=status             → { status, expiresAt } | { status: "completed", address, qieId, verified }
//                                     polls QIE; on approval collects the result once, checks the user's
//                                     approval signature, and opens a session
//   GET  ?action=me                 → { address, qieId, verified } of the current session, or 401
//   POST ?action=logout             → ends the session
// Wallet badge (QIE Pass "Verify with QIE ID", step 0):
//   POST ?action=verify-wallet { message, signature } → { address, verified } for a wallet that just
//                                     signed a Sign-In with Ethereum message
//
// The sign-in request ID and the session live in sealed cookies (AES-256-GCM,
// HttpOnly, SameSite=Strict): the browser can't read or choose them, so only
// the browser that started a sign-in can collect it.
//
// Env (Netlify): QIE_PASS_API_URL, QIE_PASS_PUBLIC_KEY, QIE_PASS_SECRET_KEY
import crypto from "node:crypto";
import { createPublicClient, getAddress, http, isAddress, recoverMessageAddress } from "viem";
import { parseSiweMessage } from "viem/siwe";

const API = () => (process.env.QIE_PASS_API_URL || "https://pass-api.qie.digital") + "/api/v1/partners";
const CHAIN_ID = 1990;
const RPC = "https://rpc1mainnet.qie.digital";
const ALLOWED_DOMAINS = ["thesis-qie.netlify.app"];
const SESSION_DAYS = 7;
const LOGIN_COOKIE = "tq_login";
const SESSION_COOKIE = "tq_session";

// ---- QIE Pass requests ------------------------------------------------------

function authHeaders() {
  const pk = process.env.QIE_PASS_PUBLIC_KEY;
  const sk = process.env.QIE_PASS_SECRET_KEY;
  if (!pk || !sk) throw Object.assign(new Error("QIE Pass keys are not configured"), { status: 500 });
  const timestamp = Date.now().toString(); // fresh for every request, never reused
  const signature = crypto.createHmac("sha256", sk).update(pk + timestamp).digest("hex");
  return { "X-Public-Key": pk, "X-Timestamp": timestamp, "X-Signature": signature, "Content-Type": "application/json" };
}

async function qie(method, path, body) {
  const res = await fetch(API() + path, { method, headers: authHeaders(), body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && json.success !== false, json, retryAfter: res.headers.get("retry-after") };
}

// ---- Sealed cookies ---------------------------------------------------------

function sealKey() {
  return Buffer.from(crypto.hkdfSync("sha256", process.env.QIE_PASS_SECRET_KEY || "", "thesis-qie", "cookie-seal-v1", 32));
}
function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", sealKey(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}
function unseal(token) {
  try {
    const buf = Buffer.from(token, "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", sealKey(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    const obj = JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"));
    return obj && obj.exp > Date.now() ? obj : null;
  } catch {
    return null;
  }
}
function readCookie(event, name) {
  const raw = event.headers?.cookie || event.headers?.Cookie || "";
  const hit = raw.split(/;\s*/).find((c) => c.startsWith(name + "="));
  return hit ? unseal(hit.slice(name.length + 1)) : null;
}
const cookie = (name, value, maxAgeSecs) =>
  `${name}=${value}; Path=/.netlify/functions/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSecs}`;
const clear = (name) => cookie(name, "", 0);

function reply(statusCode, body, cookies = []) {
  return {
    statusCode,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    multiValueHeaders: cookies.length ? { "set-cookie": cookies } : undefined,
    body: JSON.stringify(body),
  };
}
const fail = (statusCode, code, message, extra = {}, cookies = []) => reply(statusCode, { code, message, ...extra }, cookies);

// ---- Helpers ----------------------------------------------------------------

/** "Alice", "@alice", "alice.qie" → "alice.qie"; null if it can't be a QIE ID. */
function normalizeQieId(input) {
  let s = String(input ?? "").trim().toLowerCase().replace(/^@/, "");
  if (!s) return null;
  if (!s.includes(".")) s += ".qie";
  return /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?\.qie$/.test(s) ? s : null;
}

/** The user's IP as Netlify sees it: one address, never the whole forwarded chain. */
function clientIp(event) {
  const h = event.headers || {};
  const ip = h["x-nf-client-connection-ip"] || (h["x-forwarded-for"] || "").split(",")[0].trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : undefined;
}

// Messages for QIE's error codes (branch on code, never on message).
const START_ERRORS = {
  QIE_ID_NOT_FOUND: [404, "That QIE ID isn't registered. Check the spelling and try again."],
  REQUEST_ALREADY_OPEN: [429, "A sign-in for this QIE ID is already waiting in QIE Wallet. Approve it there, or try again shortly."],
  BLOCKED_BY_USER: [429, "Sign-in with this QIE ID isn't available right now. Please try again later."],
  RESOLVER_UNAVAILABLE: [503, "QIE couldn't look up that QIE ID right now. Try again in a few seconds."],
  PARTNER_NOT_APPROVED: [503, "Sign in with QIE ID isn't available on this site yet."],
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
  const ua = (event.headers?.["user-agent"] || "").slice(0, 512);
  const client = { ...(clientIp(event) ? { ip: clientIp(event) } : {}), ...(ua ? { userAgent: ua } : {}) };
  const r = await qie("POST", "/qie-login/requests", { qieId, ...(Object.keys(client).length ? { client } : {}) });
  if (!r.ok) {
    const [status, message] = START_ERRORS[r.json.code] || [r.status >= 500 ? 502 : r.status, "QIE couldn't start the sign-in. Try again."];
    const retryAfterSeconds = r.json.retryAfterSeconds ?? (r.retryAfter ? Number(r.retryAfter) : undefined);
    return fail(status, r.json.code || "START_FAILED", message, retryAfterSeconds ? { retryAfterSeconds } : {});
  }
  const d = r.json.data;
  // Keep the request ID server-side (sealed), tied to this browser; it lives until the collect window could end.
  const exp = Date.parse(d.expiresAt) + 6 * 60 * 1000;
  return reply(202, { qieId: d.qieId, code: d.code, expiresAt: d.expiresAt }, [cookie(LOGIN_COOKIE, seal({ rid: d.requestId, qieId: d.qieId, exp }), Math.ceil((exp - Date.now()) / 1000))]);
}

async function status(event) {
  const pending = readCookie(event, LOGIN_COOKIE);
  if (!pending) return fail(404, "NO_SIGNIN", "No sign-in in progress. Start again.");
  const r = await qie("GET", `/qie-login/requests/${encodeURIComponent(pending.rid)}`);
  if (!r.ok) {
    if (r.json.code === "REQUEST_NOT_FOUND") return fail(404, "REQUEST_NOT_FOUND", "That sign-in has ended. Start again.", {}, [clear(LOGIN_COOKIE)]);
    return fail(502, r.json.code || "STATUS_FAILED", "Couldn't reach QIE. Retrying…");
  }
  const d = r.json.data;
  if (d.status === "pending") return reply(200, { status: "pending", expiresAt: d.expiresAt });
  if (d.status === "rejected") return reply(200, { status: "rejected" }, [clear(LOGIN_COOKIE)]);
  if (d.status === "expired") return reply(200, { status: "expired" }, [clear(LOGIN_COOKIE)]);
  if (d.status === "completed") return fail(409, "ALREADY_COLLECTED", "This sign-in was already used. Start again.", {}, [clear(LOGIN_COOKIE)]);
  if (d.status !== "approved") return fail(502, "UNKNOWN_STATUS", "Unexpected answer from QIE. Start again.", {}, [clear(LOGIN_COOKIE)]);

  // Approved: collect exactly once, for the request this browser started.
  const c = await qie("POST", `/qie-login/requests/${encodeURIComponent(pending.rid)}/collect`);
  if (!c.ok) {
    const code = c.json.code || "COLLECT_FAILED";
    if (code === "NOT_APPROVED") return reply(200, { status: "pending", expiresAt: d.expiresAt });
    return fail(c.status === 410 ? 410 : 409, code, code === "EXPIRED" ? "The sign-in timed out. Start again." : "This sign-in can't be completed. Start again.", {}, [clear(LOGIN_COOKIE)]);
  }
  const res = c.json.data;
  if (!isAddress(res.walletAddress || "")) return fail(502, "BAD_RESULT", "QIE returned no wallet. Start again.", {}, [clear(LOGIN_COOKIE)]);
  const address = getAddress(res.walletAddress);
  // Our own check of the user's consent: signed by that wallet, for this request.
  const a = res.approval;
  if (!a?.message || !a?.signature) return fail(401, "NO_APPROVAL", "QIE returned no approval signature. Start again.", {}, [clear(LOGIN_COOKIE)]);
  const signer = await recoverMessageAddress({ message: a.message, signature: a.signature }).catch(() => null);
  const forThisRequest = a.message.split("\n").includes(`Request: ${pending.rid}`);
  if (!signer || signer.toLowerCase() !== address.toLowerCase() || !forThisRequest) {
    return fail(401, "APPROVAL_MISMATCH", "The approval didn't check out. Start again.", {}, [clear(LOGIN_COOKIE)]);
  }
  const session = { address, qieId: res.qieId || pending.qieId, verified: res.isVerifiedUser === true, exp: Date.now() + SESSION_DAYS * 86_400_000 };
  return reply(200, { status: "completed", address: session.address, qieId: session.qieId, verified: session.verified, expiresAt: session.exp }, [
    clear(LOGIN_COOKIE),
    cookie(SESSION_COOKIE, seal(session), SESSION_DAYS * 86_400),
  ]);
}

function me(event) {
  const s = readCookie(event, SESSION_COOKIE);
  return s ? reply(200, { address: s.address, qieId: s.qieId, verified: s.verified, expiresAt: s.exp }) : fail(401, "NO_SESSION", "Not signed in");
}

const client = createPublicClient({ transport: http(RPC) });
async function verifyWallet(event) {
  let message, signature;
  try {
    ({ message, signature } = JSON.parse(event.body || "{}"));
  } catch {
    return fail(400, "BAD_REQUEST", "Invalid JSON");
  }
  if (typeof message !== "string" || typeof signature !== "string" || message.length > 2000) return fail(400, "BAD_REQUEST", "message and signature required");
  const m = parseSiweMessage(message);
  const now = Date.now();
  if (!m.address || !ALLOWED_DOMAINS.includes(m.domain)) return fail(401, "WRONG_SITE", "Sign-in message is for another site");
  if (m.chainId !== CHAIN_ID) return fail(401, "WRONG_CHAIN", "Sign-in message is for another network");
  if (!m.issuedAt || now - m.issuedAt.getTime() > 10 * 60_000 || m.issuedAt.getTime() - now > 60_000) return fail(401, "STALE", "Sign-in message is stale");
  const address = getAddress(m.address);
  const ok = await client.verifyMessage({ address, message, signature }).catch(() => false);
  if (!ok) return fail(401, "BAD_SIGNATURE", "Signature doesn't match the wallet");
  const r = await qie("GET", `/verification-requests/is-verified?identifier=${encodeURIComponent(address)}`);
  if (!r.ok) return fail(502, "QIE_UNREACHABLE", "QIE Pass is unreachable right now");
  return reply(200, { address, verified: r.json.data?.isVerified === true });
}

export const handler = async (event) => {
  const action = event.queryStringParameters?.action;
  const method = event.httpMethod;
  try {
    if (action === "start" && method === "POST") return await start(event);
    if (action === "status" && method === "GET") return await status(event);
    if (action === "me" && method === "GET") return me(event);
    if (action === "logout" && method === "POST") return reply(200, { ok: true }, [clear(SESSION_COOKIE), clear(LOGIN_COOKIE)]);
    if (action === "verify-wallet" && method === "POST") return await verifyWallet(event);
    return fail(404, "NOT_FOUND", "Unknown action");
  } catch (e) {
    return fail(e.status || 502, "SERVER_ERROR", "Something went wrong talking to QIE. Try again.");
  }
};
