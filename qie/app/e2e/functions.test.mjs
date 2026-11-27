// The Netlify functions as they ship: bundled by scripts/bundle-functions.mjs
// (the same step the deploy uses), then called like Netlify calls them.
//   cd qie/app && node --test e2e/functions.test.mjs
// No network: only paths that answer before any RPC read are exercised here.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { bundleFunctions } from "../scripts/bundle-functions.mjs";

process.env.SESSION_SECRET = crypto.randomBytes(32).toString("hex");
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CALLS = "0x00000000000000000000000000000000000000c4";
const { dir, files } = await bundleFunctions({ callsAddress: CALLS, site: "https://thesis-qie.netlify.app" });
const share = require(files.share);
const qiePass = require(files["qie-pass"]);
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("audit H1: the share link rewrite sends the id in the path, and the function reads it there", () => {
  const rules = fs.readFileSync(path.join(root, "public/_redirects"), "utf8");
  assert.match(rules, /^\/s\/:id\s+\/\.netlify\/functions\/share\/:id\s+200$/m);
  const id = (e) => share.callIdFrom({ queryStringParameters: {}, ...e });
  assert.equal(id({ path: "/.netlify/functions/share/7" }), 7);
  assert.equal(id({ path: "/s/12", rawUrl: "https://thesis-qie.netlify.app/s/12" }), 12);
  assert.equal(id({ path: "/.netlify/functions/share", rawUrl: "https://thesis-qie.netlify.app/s/3?x=1" }), 3);
  assert.equal(id({ path: "/.netlify/functions/share", queryStringParameters: { id: "4" } }), 4);
  assert.equal(id({ path: "/.netlify/functions/share/0", queryStringParameters: { id: "1" } }), 0, "the path wins over ?id=");
  assert.equal(id({ path: "/s/abc" }), null);
  assert.equal(id({ path: "/s/1234567890" }), null);
});

test("unknown or malformed ids go to the markets page, with nosniff", async () => {
  const r = await share.handler({ path: "/s/nope", queryStringParameters: {} });
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, "https://thesis-qie.netlify.app/app/");
  assert.equal(r.headers["x-content-type-options"], "nosniff");
});

test("audit M5: junk on the image is redirected to the canonical URL before any render; the page ignores it (no loop)", async () => {
  // Netlify copies a rewritten request's query onto redirects: a page redirect to /s/5 would loop.
  const page = await share.handler({ path: "/.netlify/functions/share/5", queryStringParameters: { fbclid: "x" } });
  assert.notEqual(page.statusCode, 301);
  assert.notEqual(page.headers.location, "https://thesis-qie.netlify.app/s/5");
  const img = await share.handler({ path: "/.netlify/functions/share/5", queryStringParameters: { img: "1", junk: "1" } });
  assert.equal(img.statusCode, 302);
  assert.equal(img.headers.location, "https://thesis-qie.netlify.app/.netlify/functions/share/5?img=1");
});

test("the bundled sign-in function answers with nosniff and refuses cross-site POSTs", async () => {
  const me = await qiePass.handler({ httpMethod: "GET", queryStringParameters: { action: "me" }, headers: {} });
  assert.equal(me.statusCode, 401);
  assert.equal(me.headers["x-content-type-options"], "nosniff");
  const ch = await qiePass.handler({ httpMethod: "GET", queryStringParameters: { action: "challenge" }, headers: {} });
  assert.equal(ch.statusCode, 200);
  assert.ok(JSON.parse(ch.body).bits >= 16);
  const cross = await qiePass.handler({ httpMethod: "POST", queryStringParameters: { action: "start" }, headers: { "content-type": "application/json", origin: "https://evil.example", "sec-fetch-site": "cross-site" }, body: "{}" });
  assert.equal(cross.statusCode, 403);
});
