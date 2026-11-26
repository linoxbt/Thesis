// Writes out/_headers after `next build`: security headers for every path, and
// a Content-Security-Policy per page whose script-src allows exactly that
// page's inline scripts (by SHA-256 hash), instead of 'unsafe-inline'.
//   node scripts/csp.mjs        (run by deploy-netlify.mjs; idempotent)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "out");
if (!fs.existsSync(out)) throw new Error("out/ missing: run `npx next build` first");

const RPCS = [1, 2, 3, 4, 5].map((n) => `https://rpc${n}mainnet.qie.digital`).join(" ");
const policy = (hashes) =>
  [
    "default-src 'self'",
    `script-src 'self' https://loader.qie.digital ${hashes.join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://widget.qie.digital https://api.web3modal.org https://*.walletconnect.com https://*.walletconnect.org https://*.reown.com",
    "font-src 'self' data: https://fonts.reown.com",
    "frame-src https://widget.qie.digital https://verify.walletconnect.com https://verify.walletconnect.org",
    `connect-src 'self' https://mcp.qie.digital wss://relay.walletconnect.com wss://relay.walletconnect.org https://*.walletconnect.com https://*.walletconnect.org https://api.web3modal.org https://*.reown.com https://www.walletlink.org wss://www.walletlink.org https://*.coinbase.com ${RPCS}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

const COMMON = [
  "X-Frame-Options: DENY",
  "X-Content-Type-Options: nosniff",
  "Referrer-Policy: strict-origin-when-cross-origin",
  'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(self "https://widget.qie.digital")',
  "Strict-Transport-Security: max-age=31536000; includeSubDomains",
];

/** Inline <script> bodies (no src) in an HTML file, hashed as CSP sources. */
function inlineHashes(html) {
  const hashes = new Set();
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (!m[1]) continue;
    hashes.add(`'sha256-${crypto.createHash("sha256").update(m[1], "utf8").digest("base64")}'`);
  }
  return [...hashes].sort();
}

const pages = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".html")) pages.push(p);
  }
})(out);

const lines = ["/*", ...COMMON.map((h) => "  " + h), ""];
let maxLen = 0;
let all = new Set();
for (const file of pages.sort()) {
  const rel = "/" + path.relative(out, file).split(path.sep).join("/");
  const hashes = inlineHashes(fs.readFileSync(file, "utf8"));
  hashes.forEach((h) => all.add(h));
  const csp = policy(hashes);
  maxLen = Math.max(maxLen, csp.length);
  // A page is served at its file path and, for index.html, at its directory (with and without the slash).
  const routes = rel.endsWith("/index.html") ? [rel.slice(0, -"index.html".length), rel.slice(0, -"/index.html".length) || "/", rel] : [rel, rel.replace(/\.html$/, "")];
  for (const r of [...new Set(routes)]) lines.push(r, `  Content-Security-Policy: ${csp}`, "");
}
// Anything else (e.g. the 404 page for an unknown path): every page's inline scripts.
const fallback = policy([...all].sort());
lines.splice(COMMON.length + 1, 0, `  Content-Security-Policy: ${fallback}`);
fs.writeFileSync(path.join(out, "_headers"), lines.join("\n") + "\n");
console.log(`csp: ${pages.length} pages, ${all.size} inline script hashes, longest policy ${maxLen} chars, fallback ${fallback.length}`);
