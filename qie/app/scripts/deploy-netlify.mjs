// Deploys qie/app to Netlify (production): builds the static export with the
// mainnet settings from .env.production, checks the build points where it
// should, bundles the functions, uploads, waits until live, then smoke-tests
// the live site and restores the previous deploy if anything fails.
//
//   NETLIFY_AUTH_TOKEN=… node scripts/deploy-netlify.mjs
//
// Afterwards only the live deploy and the one before it are kept (older ones
// would keep serving older functions at their permalinks).
// Refuses to run if a local env file could override the production settings,
// or if qie/ has uncommitted or unpushed changes (DEPLOY_ALLOW_DIRTY=1 skips
// the git check). Uses Netlify's file-digest deploy, which uploads only files
// Netlify doesn't already have.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { bundleFunctions, FUNCTIONS } from "./bundle-functions.mjs";

const SITE_ID = process.env.NETLIFY_SITE_ID ?? "c3c94038-082f-4368-8cf6-747775fe78ad";
const SITE_URL = (process.env.SITE_URL ?? "https://thesis-qie.netlify.app").replace(/\/$/, "");
// In the hosted dev environment an HTTPS proxy injects the Netlify credential;
// anywhere else the token must be given.
const TOKEN = process.env.NETLIFY_AUTH_TOKEN ?? (process.env.HTTPS_PROXY ? "injected-by-proxy" : null);
if (!TOKEN) throw new Error("set NETLIFY_AUTH_TOKEN");
const API = "https://api.netlify.com/api/v1";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "out");
class DeployError extends Error {}
const fail = (m) => {
  throw new DeployError(m);
};
const bail = (e) => {
  console.error(`deploy: ${e instanceof DeployError ? e.message : (e?.stack ?? e)}`);
  process.exit(1);
};
process.on("uncaughtException", bail);
process.on("unhandledRejection", bail);

// 0. Preconditions: production settings only, and code that's committed and pushed.
// Only .env.production may configure the build: any other .env* file (.env,
// .env.local, …) could add or override settings, e.g. the local chain.
for (const f of fs.readdirSync(root).filter((f) => /^\.env(\..+)?$/.test(f) && f !== ".env.production")) {
  fail(`${f} exists and could change the production build; move it away first`);
}
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env.production"), "utf8")
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const callsAddress = env.NEXT_PUBLIC_CALLS_ADDRESS;
if (env.NEXT_PUBLIC_QIE_NETWORK !== "mainnet" || !/^0x[0-9a-fA-F]{40}$/.test(callsAddress ?? "")) fail(".env.production must set NEXT_PUBLIC_QIE_NETWORK=mainnet and NEXT_PUBLIC_CALLS_ADDRESS");
if (!process.env.DEPLOY_ALLOW_DIRTY) {
  const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
  if (git("status", "--porcelain", "--", "..")) fail("qie/ has uncommitted changes (commit them, or DEPLOY_ALLOW_DIRTY=1)");
  const head = git("rev-parse", "HEAD");
  if (!git("branch", "-r", "--contains", head)) fail(`HEAD ${head.slice(0, 7)} isn't pushed (push it, or DEPLOY_ALLOW_DIRTY=1)`);
}
// CI must have passed for this commit (skip with DEPLOY_SKIP_CI=1). If GitHub
// can't be reached from here, say so and go on: the build is checked below.
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (!process.env.DEPLOY_SKIP_CI) {
  const runs = await fetch(`https://api.github.com/repos/linoxbt/Thesis/actions/workflows/qie.yml/runs?head_sha=${commit}&per_page=20`, {
    headers: { accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(15_000),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (!runs) console.warn(`deploy: couldn't check CI for ${commit.slice(0, 7)} on GitHub; going on (the build is still checked)`);
  else {
    const done = (runs.workflow_runs ?? []).filter((r) => r.status === "completed");
    if (!done.length) fail(`CI hasn't finished for ${commit.slice(0, 7)} yet (or DEPLOY_SKIP_CI=1)`);
    if (!done.some((r) => r.conclusion === "success")) fail(`CI didn't pass for ${commit.slice(0, 7)} (or DEPLOY_SKIP_CI=1)`);
  }
}

// 1. Build with only .env.production: no NEXT_PUBLIC_* from the shell.
const buildEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NEXT_PUBLIC_")));
execFileSync("pnpm", ["run", "build"], { cwd: root, stdio: "inherit", env: { ...buildEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" } });

// 2. Check the build: it points at the mainnet contract, never a local chain.
const js = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith(".js")) js.push(fs.readFileSync(p, "utf8"));
  }
})(path.join(out, "_next"));
const bundle = js.join("\n");
if (!bundle.includes(callsAddress)) fail(`the build doesn't contain the contract address ${callsAddress}`);
// Our local-chain RPC, or the demo chain's contract address (Hardhat's first deploy).
if (/127\.0\.0\.1:8545|0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512/i.test(bundle)) fail("the build points at a local chain");

// 3. Static files: path -> sha1.
const files = {};
const byHash = {};
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else {
      const rel = "/" + path.relative(out, p).split(path.sep).join("/");
      const sha = crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex");
      files[rel] = sha;
      byHash[sha] = p;
    }
  }
})(out);

// 4. Functions, bundled exactly as tested (scripts/bundle-functions.mjs), zipped.
const { dir: fnDir, files: fnFiles } = await bundleFunctions({ callsAddress, site: SITE_URL });
const fns = {};
for (const name of FUNCTIONS) {
  execFileSync("zip", ["-qj", path.join(fnDir, `${name}.zip`), fnFiles[name]]);
  fns[name] = fs.readFileSync(path.join(fnDir, `${name}.zip`));
}
const fnSha = Object.fromEntries(Object.entries(fns).map(([n, z]) => [n, crypto.createHash("sha256").update(z).digest("hex")]));

const auth = { Authorization: `Bearer ${TOKEN}` };
async function api(method, url, body, headers = {}) {
  const res = await fetch(url.startsWith("http") ? url : API + url, { method, headers: { ...auth, ...headers }, body, signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

try {
  // 5. Create the deploy, upload what Netlify asks for, wait until it's live.
  const previous = (await api("GET", `/sites/${SITE_ID}`)).published_deploy?.id ?? null;
  const deploy = await api("POST", `/sites/${SITE_ID}/deploys`, JSON.stringify({ files, functions: fnSha, title: `qie ${commit.slice(0, 7)}` }), { "Content-Type": "application/json" });
  console.log(`deploy ${deploy.id}: ${Object.keys(files).length} files, ${deploy.required?.length ?? 0} to upload, functions to upload: ${deploy.required_functions?.length ?? 0}`);
  for (const sha of deploy.required ?? []) {
    await api("PUT", `/deploys/${deploy.id}/files${encodeURI(Object.keys(files).find((k) => files[k] === sha))}`, fs.readFileSync(byHash[sha]), { "Content-Type": "application/octet-stream" });
  }
  for (const [name, sha] of Object.entries(fnSha)) {
    if (deploy.required_functions?.includes(sha)) await api("PUT", `/deploys/${deploy.id}/functions/${name}?runtime=js`, fns[name], { "Content-Type": "application/octet-stream" });
  }
  let state = null;
  for (let i = 0; i < 100 && state !== "ready"; i++) {
    const d = await api("GET", `/deploys/${deploy.id}`);
    state = d.state;
    if (state === "error") fail(`deploy ${deploy.id} failed: ${d.error_message}`);
    if (state !== "ready") await new Promise((r) => setTimeout(r, 3000));
  }
  if (state !== "ready") fail(`deploy ${deploy.id} is still "${state}" after 5 minutes: it may yet go live; check it on Netlify before deploying again`);

  // 6. It's the live deploy now; smoke-test the live site (once more after a
  // pause if anything fails, so one slow RPC answer doesn't roll back a good
  // deploy); any failure or error restores the previous deploy.
  const live = (await api("GET", `/sites/${SITE_ID}`)).published_deploy?.id;
  let problems = live === deploy.id ? await smoke().catch((e) => [`smoke test error: ${e.message}`]) : [`the live deploy is ${live}, not ${deploy.id}`];
  if (problems.length) {
    await new Promise((r) => setTimeout(r, 10_000));
    problems = await smoke().catch((e) => [`smoke test error: ${e.message}`]);
  }
  if (problems.length) {
    console.error(`deploy: smoke tests failed:\n  - ${problems.join("\n  - ")}`);
    if (previous) {
      await api("POST", `/sites/${SITE_ID}/deploys/${previous}/restore`);
      const again = await smoke().catch((e) => [`smoke test error: ${e.message}`]);
      console.error(`deploy: restored the previous deploy ${previous}${again.length ? ` (it fails too: ${again.join("; ")})` : " (it passes the smoke tests)"}`);
    }
    fail("deploy rolled back");
  }
  console.log(`live and checked: ${SITE_URL}`);
  // Older deploys stay reachable at <id>--site.netlify.app and run their own
  // (older) functions with today's secrets: keep only this one and the one
  // before it (for a rollback).
  const keep = new Set([deploy.id, previous].filter(Boolean));
  const old = [];
  for (let page = 1; page < 10; page++) {
    const d = await api("GET", `/sites/${SITE_ID}/deploys?per_page=100&page=${page}`);
    old.push(...d.filter((x) => !keep.has(x.id) && x.state === "ready")); // never one still in progress
    if (d.length < 100) break;
  }
  for (const d of old) await api("DELETE", `/deploys/${d.id}`).catch((e) => console.warn(`couldn't delete deploy ${d.id}: ${e.message}`));
  if (old.length) console.log(`deleted ${old.length} older deploy(s)`);
} finally {
  fs.rmSync(fnDir, { recursive: true, force: true });
}

async function smoke() {
  const problems = [];
  const get = (p, opts = {}) => fetch(SITE_URL + p, { redirect: "manual", signal: AbortSignal.timeout(30_000), ...opts });
  const home = await get("/");
  if (home.status !== 200) problems.push(`/ answered ${home.status}`);
  if (!home.headers.get("content-security-policy")?.includes("script-src")) problems.push("/ has no content-security-policy");
  const html = await home.text();
  if (!html.includes("Thesis")) problems.push("/ doesn't look like the app");
  // A shared link must unfurl into its call (when there is a call).
  const share = await get("/s/0");
  if (share.status === 200) {
    const page = await share.text();
    if (!/og:title/.test(page) || !/\/t\/\?id=0/.test(page)) problems.push("/s/0 doesn't carry the call's preview tags");
  } else if (!(share.status === 302 && /\/app\/$/.test(share.headers.get("location") ?? ""))) {
    problems.push(`/s/0 answered ${share.status} → ${share.headers.get("location")}`);
  }
  // A link with tracking parameters must still unfurl (and never loop).
  const tracked = await fetch(SITE_URL + "/s/0?fbclid=x&utm_source=y", { redirect: "follow", signal: AbortSignal.timeout(30_000) }).catch((e) => ({ status: `error ${e.cause?.code ?? e.message}`, text: async () => "" }));
  if (share.status === 200 && (tracked.status !== 200 || !/og:title/.test(await tracked.text()))) problems.push(`/s/0 with tracking parameters answered ${tracked.status}`);
  // Junk on the image redirects to its canonical URL, which serves a PNG.
  const img = await fetch(SITE_URL + "/.netlify/functions/share/0?img=1&junk=1", { redirect: "follow", signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (share.status === 200 && (!img || img.status !== 200 || img.headers.get("content-type") !== "image/png")) problems.push(`the card image answered ${img?.status}`);
  const me = await get("/.netlify/functions/qie-pass?action=me");
  if (me.status !== 401) problems.push(`qie-pass ?action=me answered ${me.status} (expected 401 without a session)`);
  if (me.headers.get("x-content-type-options") !== "nosniff") problems.push("qie-pass responses lack x-content-type-options");
  return problems;
}
