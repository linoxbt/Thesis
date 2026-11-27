// The QIE Pass function against a simulated QIE Pass API (node --test).
//   cd qie/app && node --test e2e/qie-pass.test.mjs
// The QIE Pass API is faked; the QIE RPC is real (wallet signature checks use it).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

process.env.QIE_PASS_PUBLIC_KEY = "pk_test";
process.env.QIE_PASS_SECRET_KEY = "sk_test";
process.env.SESSION_SECRET = crypto.randomBytes(32).toString("hex");

const user = privateKeyToAccount("0x" + "11".repeat(32));
const SITE = "https://thesis-qie.netlify.app";

// ---- fake QIE Pass ----------------------------------------------------------
const fake = { requests: new Map(), starts: 0, hmacOk: true };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith("https://pass-api.qie.digital")) return realFetch(url, init);
  const h = init.headers;
  const want = crypto.createHmac("sha256", "sk_test").update(h["X-Public-Key"] + h["X-Timestamp"]).digest("hex");
  fake.hmacOk &&= h["X-Signature"] === want;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const path = new URL(u).pathname.replace("/api/v1/partners", "");
  if (init.method === "POST" && path === "/qie-login/requests") {
    fake.starts++;
    const { qieId } = JSON.parse(init.body);
    if (qieId !== "alice.qie") return json(404, { success: false, code: "QIE_ID_NOT_FOUND" });
    const id = "req_" + crypto.randomBytes(8).toString("hex");
    fake.requests.set(id, { status: "pending", collected: false });
    return json(202, { success: true, data: { requestId: id, qieId, code: "123456", expiresAt: new Date(Date.now() + 120e3).toISOString() } });
  }
  const m = /^\/qie-login\/requests\/([^/]+)(\/collect)?$/.exec(path);
  if (m) {
    const r = fake.requests.get(decodeURIComponent(m[1]));
    if (!r) return json(404, { success: false, code: "REQUEST_NOT_FOUND" });
    if (!m[2]) return json(200, { success: true, data: { status: r.collected ? "completed" : r.status, expiresAt: new Date(Date.now() + 60e3).toISOString() } });
    if (r.status !== "approved" || r.collected) return json(409, { success: false, code: "NOT_APPROVED" });
    r.collected = true;
    const message = `QIE ID login\nRequest: ${m[1]}\nPartner: Thesis`;
    const signature = await (r.signer ?? user).signMessage({ message });
    return json(200, { success: true, data: { walletAddress: user.address, qieId: "alice.qie", isVerifiedUser: true, approval: { message, signature } } });
  }
  if (path.startsWith("/verification-requests/is-verified")) return json(200, { success: true, data: { isVerified: true } });
  return json(404, { success: false });
};

const { handler, _internal } = await import("../netlify/functions/qie-pass.mjs");

// ---- a fake Netlify Blobs store (ETags, onlyIfNew / onlyIfMatch) -------------
function fakeStore() {
  const m = new Map();
  let v = 0;
  const delay = () => new Promise((r) => setTimeout(r, Math.random() * 3));
  return {
    m,
    async get(k) {
      await delay();
      return m.has(k) ? m.get(k).data : null;
    },
    async getWithMetadata(k) {
      await delay();
      return m.has(k) ? { ...m.get(k) } : null;
    },
    async set(k, data, o = {}) {
      await delay();
      const cur = m.get(k);
      if (o.onlyIfNew && cur) return { modified: false };
      if (o.onlyIfMatch && (!cur || cur.etag !== o.onlyIfMatch)) return { modified: false };
      const etag = `e${++v}`;
      m.set(k, { data, etag });
      return { modified: true, etag };
    },
  };
}

/** Solves a start proof-of-work like the browser does. */
function solve(challenge, bits) {
  for (let n = 0; n < 1 << (bits + 6); n++) if (_internal.zeroBits(_internal.sha256hex(`${challenge}:${n}`)) >= bits) return String(n);
  throw new Error("no proof-of-work found");
}

// ---- a browser ----------------------------------------------------------------
function browser(ip = "203.0.113." + Math.floor(Math.random() * 250)) {
  const jar = {};
  const call = async (action, { method = "GET", body, headers = {}, pow = true } = {}) => {
    if (action === "start" && pow && body && !body.pow) {
      const ch = (await call("challenge")).body;
      // (No challenge, e.g. the function isn't configured: send the start without one.)
      if (typeof ch.challenge === "string" && Number.isInteger(ch.bits)) body = { ...body, pow: { challenge: ch.challenge, nonce: solve(ch.challenge, ch.bits) } };
    }
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
    const base = { "x-nf-client-connection-ip": ip, cookie };
    if (method === "POST") Object.assign(base, { "content-type": "application/json", origin: SITE, "sec-fetch-site": "same-origin" });
    const res = await handler({ httpMethod: method, queryStringParameters: { action }, headers: { ...base, ...headers }, body: body ? JSON.stringify(body) : undefined });
    for (const c of res.multiValueHeaders?.["set-cookie"] ?? []) {
      const [kv, ...attrs] = c.split("; ");
      const [k, v] = kv.split("=");
      if (attrs.some((a) => a === "Max-Age=0")) delete jar[k];
      else jar[k] = v;
    }
    return { status: res.statusCode, body: JSON.parse(res.body), headers: res.headers };
  };
  return { call, jar };
}

test("signs requests with HMAC-SHA256(publicKey + timestamp)", async () => {
  const b = browser();
  await b.call("start", { method: "POST", body: { qieId: "alice" } });
  assert.equal(fake.hmacOk, true);
});

test("full QIE Pass sign-in: code, approval, verified signature, session, logout", async () => {
  const b = browser();
  const s = await b.call("start", { method: "POST", body: { qieId: "@Alice" } });
  assert.equal(s.status, 202);
  assert.equal(s.body.code, "123456");
  assert.ok(!JSON.stringify(s.body).includes("req_"), "request id never reaches the browser");
  assert.equal((await b.call("status")).body.status, "pending");
  for (const r of fake.requests.values()) r.status = "approved";
  const done = await b.call("status");
  assert.equal(done.body.status, "completed");
  assert.equal(done.body.address, user.address);
  assert.equal(done.body.verified, true);
  assert.equal((await b.call("me")).body.qieId, "alice.qie");
  await b.call("logout", { method: "POST", body: {} });
  assert.equal((await b.call("me")).status, 401);
});

test("an approval signed by another wallet is refused", async () => {
  const b = browser();
  await b.call("start", { method: "POST", body: { qieId: "alice" } });
  const other = privateKeyToAccount("0x" + "22".repeat(32));
  for (const r of fake.requests.values()) if (!r.collected) Object.assign(r, { status: "approved", signer: other });
  const res = await b.call("status");
  assert.equal(res.body.code, "APPROVAL_MISMATCH");
  assert.equal((await b.call("me")).status, 401);
});

test("audit H7: cross-site, non-JSON or origin-less POSTs are refused", async () => {
  const b = browser();
  for (const headers of [
    { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    { "content-type": "text/plain" },
    { origin: "https://thesis-qie.netlify.app.evil.example", "sec-fetch-site": "cross-site" },
    { origin: undefined, "sec-fetch-site": undefined },
  ]) {
    const before = fake.starts;
    const res = await b.call("start", { method: "POST", body: { qieId: "alice" }, headers });
    assert.equal(res.status, 403, JSON.stringify(headers));
    assert.equal(fake.starts, before, "nothing reached QIE");
  }
  // Deploy previews and old deploy permalinks are not this site (they may run old code).
  const preview = await b.call("start", { method: "POST", body: { qieId: "nobody" }, headers: { origin: "https://deploy-preview-7--thesis-qie.netlify.app" } });
  assert.equal(preview.status, 403);
});

test("audit H7: start is rate limited per IP and per IP + QIE ID (never per QIE ID alone)", async () => {
  _internal.resetLimits();
  const b = browser("198.51.100.7");
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push((await b.call("start", { method: "POST", body: { qieId: `ghost${i}` } })).status);
  assert.deepEqual(codes.slice(0, 6), [404, 404, 404, 404, 404, 404]);
  assert.equal(codes[6], 429);
  // One IP retrying one QIE ID: 3 per 10 min.
  _internal.resetLimits();
  const one = browser("192.0.2.9");
  const same = [];
  for (let i = 0; i < 4; i++) same.push((await one.call("start", { method: "POST", body: { qieId: "target-person" } })).status);
  assert.deepEqual(same, [404, 404, 404, 429]);
  // Many IPs on one QIE ID: no global cap, so strangers can't lock the owner out
  // (each prompt costs them a proof-of-work and their own per-IP allowance).
  _internal.resetLimits();
  const id = [];
  for (let i = 0; i < 12; i++) id.push((await browser(`203.0.113.${100 + i}`).call("start", { method: "POST", body: { qieId: "target-person" } })).status);
  assert.deepEqual(id, Array(12).fill(404));
  // An IP already over its own limit doesn't use up the victim's ID allowance.
  _internal.resetLimits();
  const spammer = browser("198.51.100.66");
  for (let i = 0; i < 6; i++) await spammer.call("start", { method: "POST", body: { qieId: `x${i}` } });
  for (let i = 0; i < 5; i++) assert.equal((await spammer.call("start", { method: "POST", body: { qieId: "victim" } })).status, 429);
  assert.equal((await browser().call("start", { method: "POST", body: { qieId: "victim" } })).status, 404);
});

test("audit M12: cancel forgets the sign-in in this browser", async () => {
  _internal.resetLimits();
  const b = browser();
  await b.call("start", { method: "POST", body: { qieId: "alice" } });
  assert.ok(b.jar.tq_login);
  await b.call("cancel", { method: "POST", body: {} });
  assert.equal(b.jar.tq_login, undefined);
  assert.equal((await b.call("status")).body.code, "NO_SIGNIN");
});

test("audit L2: cookies are typed and fail closed without SESSION_SECRET", async () => {
  const { seal, unseal } = _internal;
  const login = seal("tq_login", { rid: "x", exp: Date.now() + 60e3 });
  assert.equal(unseal("tq_session", login), null, "a login cookie can't pass as a session");
  assert.equal(unseal("tq_login", login).rid, "x");
  const tampered = Buffer.from(login, "base64url");
  tampered[tampered.length - 1] ^= 1;
  assert.equal(unseal("tq_login", tampered.toString("base64url")), null);
  const saved = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  try {
    const b = browser();
    b.jar.tq_session = login; // a cookie can't be read (or forged) without the secret
    const res = await b.call("me");
    assert.equal(res.status, 503);
    assert.equal(res.body.code, "NOT_CONFIGURED");
    _internal.resetLimits();
    assert.equal((await browser().call("start", { method: "POST", body: { qieId: "alice" } })).status, 503); // nor sealed
  } finally {
    process.env.SESSION_SECRET = saved;
  }
});

async function siwe(b, overrides = {}) {
  const { nonce } = (await b.call("nonce")).body;
  const message = createSiweMessage({ address: user.address, chainId: 1990, domain: "thesis-qie.netlify.app", uri: SITE, version: "1", nonce, issuedAt: new Date(), statement: "Sign in to Thesis", ...overrides });
  return { message, signature: await user.signMessage({ message }) };
}

test("audit L1: wallet sign-in needs the server's nonce, once", async () => {
  const b = browser();
  const body = await siwe(b);
  const ok = await b.call("verify-wallet", { method: "POST", body });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.verified, true);
  const replay = await b.call("verify-wallet", { method: "POST", body });
  assert.equal(replay.body.code, "NO_NONCE");
  const forged = await siwe(b, { nonce: "a".repeat(24) });
  assert.equal((await b.call("verify-wallet", { method: "POST", body: forged })).body.code, "BAD_NONCE");
});

test("re-audit N5: extra hosts (a custom domain) come from ALLOWED_HOSTS", async () => {
  _internal.resetLimits();
  const custom = { origin: "https://thesis.example.com", "sec-fetch-site": "same-origin" };
  assert.equal((await browser().call("start", { method: "POST", body: { qieId: "nobody" }, headers: custom })).status, 403);
  process.env.ALLOWED_HOSTS = "thesis.example.com";
  try {
    assert.equal((await browser().call("start", { method: "POST", body: { qieId: "nobody" }, headers: custom })).status, 404);
  } finally {
    delete process.env.ALLOWED_HOSTS;
  }
});

test("leaderboard badges: QIE Pass verification for up to 10 addresses, validated and capped", async () => {
  _internal.resetLimits();
  const b = browser();
  const a1 = user.address, a2 = "0x000000000000000000000000000000000000dEaD";
  const ok = await b.call("verified", { headers: {} , method: "GET" });
  assert.equal(ok.status, 400);
  const res = await handler({ httpMethod: "GET", queryStringParameters: { action: "verified", addresses: `${a1},${a2}` }, headers: { "x-nf-client-connection-ip": "203.0.113.200" } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { [a1]: true, [a2]: true });
  const tooMany = await handler({ httpMethod: "GET", queryStringParameters: { action: "verified", addresses: Array(11).fill(a1).join(",") }, headers: {} });
  assert.equal(tooMany.statusCode, 400);
  const bad = await handler({ httpMethod: "GET", queryStringParameters: { action: "verified", addresses: "0xnope" }, headers: {} });
  assert.equal(bad.statusCode, 400);
});

test("audit L1: bad dates, other sites and other chains are refused", async () => {
  const b = browser();
  const bad = await siwe(b);
  bad.message = bad.message.replace(/Issued At: .*/, "Issued At: not-a-date");
  bad.signature = await user.signMessage({ message: bad.message });
  assert.equal((await b.call("verify-wallet", { method: "POST", body: bad })).status, 401);
  assert.equal((await b.call("verify-wallet", { method: "POST", body: await siwe(b, { domain: "evil.example", uri: "https://evil.example" }) })).body.code, "WRONG_SITE");
  assert.equal((await b.call("verify-wallet", { method: "POST", body: await siwe(b, { chainId: 1 }) })).body.code, "WRONG_CHAIN");
  assert.equal((await b.call("verify-wallet", { method: "POST", body: await siwe(b, { expirationTime: new Date(Date.now() - 1000) }) })).body.code, "STALE");
});

test("audit M4: starting a sign-in needs a fresh, valid proof-of-work (nothing reaches QIE otherwise)", async () => {
  _internal.resetLimits();
  const b = browser();
  const before = fake.starts;
  assert.equal((await b.call("start", { method: "POST", body: { qieId: "alice" }, pow: false })).body.code, "BAD_PROOF");
  const ch = (await b.call("challenge")).body;
  assert.equal(ch.bits, _internal.POW_BITS);
  assert.equal((await b.call("start", { method: "POST", body: { qieId: "alice", pow: { challenge: ch.challenge, nonce: "0" } }, pow: false })).body.code, "BAD_PROOF");
  const forged = _internal.seal("tq_login", { r: "x", exp: Date.now() + 60e3 }); // a sealed value of another type
  assert.equal((await b.call("start", { method: "POST", body: { qieId: "alice", pow: { challenge: forged, nonce: solve(forged, ch.bits) } }, pow: false })).body.code, "BAD_PROOF");
  assert.equal(fake.starts, before);
  const good = { challenge: ch.challenge, nonce: solve(ch.challenge, ch.bits) };
  assert.equal((await b.call("start", { method: "POST", body: { qieId: "alice", pow: good }, pow: false })).status, 202);
  assert.equal((await b.call("start", { method: "POST", body: { qieId: "alice", pow: good }, pow: false })).body.code, "BAD_PROOF", "a proof works once");
});

test("audit M3: IPv6 is limited per /64, not per address", async () => {
  _internal.resetLimits();
  assert.equal(_internal.ipBucket("2001:db8:aa:bb:1::2"), _internal.ipBucket("2001:0db8:00aa:00bb:ffff:1:2:3"));
  assert.notEqual(_internal.ipBucket("2001:db8:aa:bb::1"), _internal.ipBucket("2001:db8:aa:bc::1"));
  assert.equal(_internal.ipBucket("::ffff:198.51.100.4"), "198.51.100.4");
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await browser(`2001:db8:aa:bb::${i + 1}`).call("start", { method: "POST", body: { qieId: `v6-${i}` } })).status);
  assert.deepEqual(codes, [404, 404, 404, 404, 404, 404, 429]);
});

test("audit M3: counters are atomic under parallel requests (compare-and-swap)", async () => {
  const store = fakeStore();
  const got = await Promise.all(Array.from({ length: 40 }, () => _internal.bump(store, "k", 1)));
  assert.equal(Number(store.m.get("k").data), got.filter((n) => Number.isFinite(n)).length);
  assert.equal(got.filter((n) => Number.isFinite(n)).length, 40, "every write lands, one at a time");
  assert.equal(new Set(got.filter((n) => Number.isFinite(n))).size, got.filter((n) => Number.isFinite(n)).length, "no two requests saw the same count");
});

test("audit L1/L2: a nonce is single use server-side; logout revokes a copied session cookie", async () => {
  const store = fakeStore();
  _internal.useStore(store);
  try {
    _internal.resetLimits();
    const b = browser();
    const body = await siwe(b);
    const keep = b.jar.tq_nonce;
    assert.equal((await b.call("verify-wallet", { method: "POST", body })).status, 200);
    b.jar.tq_nonce = keep; // a client that kept the cookie
    assert.equal((await b.call("verify-wallet", { method: "POST", body })).body.code, "NONCE_USED");
    // Session revocation.
    const u = browser();
    await u.call("start", { method: "POST", body: { qieId: "alice" } });
    for (const r of fake.requests.values()) if (!r.collected) r.status = "approved";
    assert.equal((await u.call("status")).body.status, "completed");
    const copied = u.jar.tq_session;
    await u.call("logout", { method: "POST", body: {} });
    const thief = browser();
    thief.jar.tq_session = copied;
    assert.equal((await thief.call("me")).status, 401);
  } finally {
    _internal.useStore(null);
  }
});

test("responses carry nosniff; weak secrets and unknown upstream codes don't get through", async () => {
  const r = await browser().call("me");
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  const saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "a".repeat(40);
  try {
    assert.equal((await browser().call("challenge")).body.code, "NOT_CONFIGURED");
  } finally {
    process.env.SESSION_SECRET = saved;
  }
});
