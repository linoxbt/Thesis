// Deploys qie/app to Netlify: the static export (out/) plus the QIE Pass
// function (netlify/functions/qie-pass.mjs, bundled with esbuild).
//   NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… node scripts/deploy-netlify.mjs
// Run `npx next build` first. Uses Netlify's file-digest deploy, which uploads
// only files Netlify doesn't already have.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SITE = process.env.NETLIFY_SITE_ID ?? "c3c94038-082f-4368-8cf6-747775fe78ad";
const TOKEN = process.env.NETLIFY_AUTH_TOKEN ?? "set-by-proxy";
const API = "https://api.netlify.com/api/v1";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "out");
if (!fs.existsSync(out)) throw new Error("out/ missing: run `npx next build` first");

// Security headers with per-page script hashes (rewrites out/_headers).
execFileSync("node", [path.join(root, "scripts/csp.mjs")], { stdio: "inherit" });

const auth = { Authorization: `Bearer ${TOKEN}` };
async function api(method, url, body, headers = {}) {
  const res = await fetch(url.startsWith("http") ? url : API + url, { method, headers: { ...auth, ...headers }, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// 1. Static files: path -> sha1.
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

// 2. The functions, each bundled (wasm and fonts inlined) and zipped. The
// share function gets the contract address and site URL fixed at bundle time.
const env = Object.fromEntries(
  [".env.production", ".env.production.local"]
    .map((f) => path.join(root, f))
    .filter((f) => fs.existsSync(f))
    .flatMap((f) => fs.readFileSync(f, "utf8").split("\n"))
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const callsAddress = process.env.NEXT_PUBLIC_CALLS_ADDRESS ?? env.NEXT_PUBLIC_CALLS_ADDRESS;
if (!callsAddress) throw new Error("NEXT_PUBLIC_CALLS_ADDRESS is not set (.env.production)");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qie-fn-"));
export function bundleFunction(name, outDir = tmp, defines = {}) {
  execFileSync(
    "npx",
    [
      "-y",
      "esbuild@0.25.0",
      path.join(root, `netlify/functions/${name}.mjs`),
      "--bundle",
      "--platform=node",
      "--target=node20",
      "--format=cjs",
      "--loader:.wasm=binary",
      "--loader:.woff=binary",
      ...Object.entries(defines).map(([k, v]) => `--define:process.env.${k}=${JSON.stringify(v)}`),
      `--outfile=${path.join(outDir, `${name}.js`)}`,
      "--log-level=warning",
    ],
    { stdio: "inherit", cwd: root },
  );
  execFileSync("zip", ["-qj", path.join(outDir, `${name}.zip`), path.join(outDir, `${name}.js`)]);
  return fs.readFileSync(path.join(outDir, `${name}.zip`));
}
const fns = {
  "qie-pass": bundleFunction("qie-pass"),
  share: bundleFunction("share", tmp, { THESIS_CALLS: callsAddress, THESIS_SITE: process.env.SITE_URL ?? "https://thesis-qie.netlify.app" }),
};
const fnSha = Object.fromEntries(Object.entries(fns).map(([n, z]) => [n, crypto.createHash("sha256").update(z).digest("hex")]));

// 3. Create the deploy, upload what Netlify asks for, wait until it's live.
const deploy = await api("POST", `/sites/${SITE}/deploys`, JSON.stringify({ files, functions: fnSha }), { "Content-Type": "application/json" });
console.log(`deploy ${deploy.id}: ${Object.keys(files).length} files, ${deploy.required?.length ?? 0} to upload, functions to upload: ${deploy.required_functions?.length ?? 0}`);
for (const sha of deploy.required ?? []) {
  await api("PUT", `/deploys/${deploy.id}/files${encodeURI(Object.keys(files).find((k) => files[k] === sha))}`, fs.readFileSync(byHash[sha]), { "Content-Type": "application/octet-stream" });
}
for (const [name, sha] of Object.entries(fnSha)) {
  if (deploy.required_functions?.includes(sha)) await api("PUT", `/deploys/${deploy.id}/functions/${name}?runtime=js`, fns[name], { "Content-Type": "application/octet-stream" });
}
for (let i = 0; i < 60; i++) {
  const d = await api("GET", `/deploys/${deploy.id}`);
  if (d.state === "ready") {
    console.log(`live: ${d.ssl_url}`);
    process.exit(0);
  }
  if (d.state === "error") throw new Error(`deploy failed: ${d.error_message}`);
  await new Promise((r) => setTimeout(r, 3000));
}
throw new Error("deploy did not become ready in time");
