// Browser test of the QIE app against a local chain (qie/contracts scripts/dev-chain.js).
//   (cd qie/contracts && npx hardhat node) & (cd qie/contracts && npx hardhat run scripts/dev-chain.js --network localhost)
//   (cd qie/app && NEXT_PUBLIC_QIE_NETWORK=local npx next build && npx serve out -l 3200) &
//   node qie/app/e2e/ui.e2e.cjs
// A stand-in wallet announces itself like QIE Wallet (EIP-6963 rdns me.qiewallet)
// and forwards to the local node, whose test accounts are unlocked.
const { chromium } = require("playwright");
const { createPublicClient, encodeFunctionData, http, parseAbi } = require("viem");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.BASE_URL ?? "http://localhost:3200";
const RPC = "http://127.0.0.1:8545";
const OUT = process.env.OUT_DIR ?? "/tmp/qie-e2e";
const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "contracts", "deployments", "localhost.json"), "utf8"));
const ACCOUNT = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720"; // hardhat account #9 (funded by dev-chain)
const CALLS_ABI = require("../../contracts/scripts/keeper-abi.json");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (step, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail ? ` — ${detail}` : ""}`);
};
const rpc = async (method, params = []) => {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
  return j.result;
};
const client = createPublicClient({ transport: http(RPC) });

async function pushPrice(feed, price) {
  const block = await client.getBlock();
  const data = encodeFunctionData({ abi: parseAbi(["function push(int256,uint256)"]), args: [price, block.timestamp] });
  const owner = (await rpc("eth_accounts"))[0];
  const hash = await rpc("eth_sendTransaction", [{ from: owner, to: feed, data }]);
  await client.waitForTransactionReceipt({ hash });
}

/** Picks "QIE Wallet" in Reown's wallet picker (AppKit; Playwright reaches into its shadow DOM). */
async function pickQieWalletInReown(page) {
  const item = page.locator("w3m-modal").getByText("QIE Wallet", { exact: true }).first();
  await item.waitFor({ state: "visible", timeout: 30_000 });
  await item.click();
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.exposeBinding("__wallet", async (_src, method, params) => {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [ACCOUNT];
    if (method === "eth_chainId") return "0x7a69";
    if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
    if (method === "eth_sendTransaction") return rpc(method, [{ ...params[0], from: ACCOUNT }]);
    return rpc(method, params ?? []);
  });
  await ctx.addInitScript(() => {
    const provider = {
      request: ({ method, params }) => window.__wallet(method, params),
      on: () => {},
      removeListener: () => {},
    };
    window.qie = provider;
    const announce = () =>
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "test", name: "QIE Wallet", icon: "", rdns: "me.qiewallet" }, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  });
  // QIE ID lookups (mainnet-only): a stand-in for QIE's lookup service that knows
  // tester.qie (the test wallet) and other.qie (someone else).
  const NAMES = { "tester.qie": ACCOUNT, "other.qie": "0x1111111111111111111111111111111111111111" };
  await ctx.route("https://mcp.qie.digital/**", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } });
    const body = JSON.parse(route.request().postData() ?? "{}");
    const { name: tool, arguments: a } = body.params ?? {};
    let sc = {};
    if (tool === "qie_resolve_name") sc = { status: "ok", name: a.name, address: NAMES[a.name] ?? null };
    if (tool === "qie_reverse_lookup") sc = { status: "ok", address: a.address, name: Object.keys(NAMES).find((k) => NAMES[k].toLowerCase() === a.address.toLowerCase()) ?? null };
    await route.fulfill({ status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { structuredContent: sc, content: [] } }) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/favicon|404|502 \(Bad Gateway\)/.test(m.text()) && errors.push(m.text())); // 502: the deliberate "QIE Pass down" stub

  // 0. Landing
  await page.goto(BASE + "/");
  await page.waitForSelector('[data-testid="launch-app"]');
  check("landing renders", /Prove you/.test((await page.textContent("h1")) ?? ""));
  await page.waitForSelector('[data-testid="live-stats"]', { timeout: 30_000 });
  check("landing shows live contract stats", /calls/.test((await page.textContent('[data-testid="live-stats"]')) ?? ""));
  await page.screenshot({ path: `${OUT}/landing.png`, fullPage: true });

  // 1. Markets: oracle prices and the demo calls
  await page.click('[data-testid="launch-app"]');
  await page.waitForSelector('[data-testid="thesis-card"]', { timeout: 30_000 });
  const prices = await page.textContent('[data-testid="oracle-prices"]');
  check("home shows live oracle prices", /BTC \$[\d,]+/.test(prices ?? "") && /SOL \$\d/.test(prices ?? ""), (prices ?? "").replace(/\s+/g, " "));
  check("markets list the calls", (await page.locator('[data-testid="thesis-card"]').count()) >= 2);
  check("sidebar and tab bar shell", (await page.locator('[data-testid="sidebar-toggle"]').count()) >= 1);
  check("no network badge in the header", (await page.locator('[data-testid="network-badge"]').count()) === 0);
  await page.screenshot({ path: `${OUT}/home.png`, fullPage: true });

  // 2. Sign in. The QIE Pass server function is stubbed (static test server):
  // a simulated QIE that shows a code, then the user declines or approves in QIE Wallet.
  const fn = { outcome: "pending", polls: 0, session: null, verifyWallet: "down" };
  await ctx.route("**/.netlify/functions/qie-pass?**", async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (action === "start") {
      const { qieId } = JSON.parse(route.request().postData() ?? "{}");
      if (!/^tester(\.qie)?$/.test(qieId)) return json(404, { code: "QIE_ID_NOT_FOUND", message: "That QIE ID isn't registered. Check the spelling and try again." });
      fn.polls = 0;
      return json(202, { qieId: "tester.qie", code: "482913", expiresAt: new Date(Date.now() + 120e3).toISOString() });
    }
    if (action === "status") {
      if (++fn.polls < 2 || fn.outcome === "pending") return json(200, { status: "pending" });
      if (fn.outcome === "rejected") return json(200, { status: "rejected" });
      fn.session = { address: ACCOUNT, qieId: "tester.qie", verified: true, expiresAt: Date.now() + 7 * 864e5 };
      return json(200, { status: "completed", ...fn.session });
    }
    if (action === "me") return fn.session ? json(200, fn.session) : json(401, { code: "NO_SESSION" });
    if (action === "logout") return (fn.session = null), json(200, { ok: true });
    if (action === "verify-wallet") return fn.verifyWallet === "down" ? json(502, { code: "QIE_UNREACHABLE" }) : json(200, { address: ACCOUNT, verified: false });
    return json(404, {});
  });
  await page.click('[data-testid="connect"]');
  await page.waitForSelector('[data-testid="signin-modal"]');
  check("sign-in offers QIE Pass and Wallet, no tabs", (await page.isVisible('[data-testid="signin-qiepass"]')) && (await page.isVisible('[data-testid="signin-wallet"]')) && (await page.locator('[data-testid="signin-modal"] [role="tab"]').count()) === 0);
  await page.click('[data-testid="signin-qiepass"]');
  // a) an unknown QIE ID
  await page.fill('[data-testid="qieid-input"]', "ghost");
  await page.click('[data-testid="qieid-submit"]');
  await page.waitForSelector('[data-testid="signin-error"]');
  check("unknown QIE ID gets a clear message", /isn't registered/.test((await page.textContent('[data-testid="signin-error"]')) ?? ""));
  // b) the code is shown; the user declines in QIE Wallet
  fn.outcome = "rejected";
  await page.fill('[data-testid="qieid-input"]', "tester");
  await page.click('[data-testid="qieid-submit"]');
  await page.waitForSelector('[data-testid="qieid-code"]');
  check("shows the 6-character code with a countdown", (await page.textContent('[data-testid="qieid-code"]')) === "482913" && /left/.test((await page.textContent('[data-testid="qieid-countdown"]')) ?? ""));
  await page.screenshot({ path: `${OUT}/signin-code.png` });
  await page.waitForSelector('[data-testid="qieid-ended"]', { timeout: 20_000 });
  check("a declined sign-in says so and offers Start again", /declined/.test((await page.textContent('[data-testid="qieid-ended-message"]')) ?? ""));
  // c) start again; the user approves: signed in, QIE Pass verified
  fn.outcome = "approved";
  await page.click('[data-testid="qieid-restart"]');
  await page.waitForSelector('[data-testid="account-qiepass"]', { timeout: 20_000 });
  check("approving in QIE Wallet signs in with the QIE ID", /tester\.qie/.test((await page.textContent('[data-testid="account"]')) ?? ""));
  // d) the session survives a reload (server session cookie)
  await page.reload();
  await page.waitForSelector('[data-testid="account-qiepass"]', { timeout: 20_000 });
  check("stays signed in after a reload", true);

  // 3. Back the SOL call with 5 QUSDC
  await page.goto(BASE + "/call/?id=0"); // old links redirect to the trade page
  await page.waitForURL(/\/t\/\?id=0/);
  await page.waitForSelector('[data-testid="bet-box"]');
  await page.fill('[data-testid="bet-amount"]', "5");
  await page.waitForFunction(() => /pays [\d.]+ QUSDC/.test(document.querySelector('[data-testid="bet-quote"]')?.textContent ?? ""));
  await page.click('[data-testid="bet-submit"]');
  // Signed in with QIE ID: the first transaction links the wallet through Reown's picker.
  await pickQieWalletInReown(page);
  check("Reown's picker lists QIE Wallet (detected) for the first transaction", true);
  const backed = await page.waitForSelector('[data-testid="tx-confirmed"], [data-testid="tx-failed"]', { timeout: 60_000 });
  check("backs a call (approve-if-needed + bet)", (await backed.getAttribute("data-testid")) === "tx-confirmed", ((await backed.textContent()) ?? "").replace(/\s+/g, " ").slice(0, 80));
  await page.waitForSelector('[data-testid="position"]', { timeout: 20_000 });
  check("position shows the stake", /4\.90 YES/.test((await page.textContent('[data-testid="position"]')) ?? ""));
  await page.waitForSelector('[data-testid="activity"]', { timeout: 30_000 });
  check("activity lists the bet from contract events", /backed · YES/.test((await page.textContent('[data-testid="activity"]')) ?? ""));
  await page.screenshot({ path: `${OUT}/call.png`, fullPage: true });

  // 4. Post a call
  await page.goto(BASE + "/new/");
  await page.click('[data-testid="asset-ETH"]');
  await page.fill('[data-testid="seed"]', "10");
  await page.waitForFunction(() => /Opening odds: [\d.]+%/.test(document.querySelector('[data-testid="preview"]')?.textContent ?? ""), null, { timeout: 20_000 });
  const preview = (await page.textContent('[data-testid="preview"]')) ?? "";
  check("post form previews the onchain odds", /Opening odds: [\d.]+%/.test(preview), preview.slice(0, 90));
  await page.screenshot({ path: `${OUT}/new.png`, fullPage: true });
  await page.click('[data-testid="post-submit"]');
  const posted = await page.waitForSelector('[data-testid="posted"]', { timeout: 60_000 }).then(() => true).catch(() => false);
  check("posts a call onchain", posted);
  if (posted) {
    await page.click('[data-testid="view-call"]');
    await page.waitForSelector('[data-testid="call-title"]');
    check("the new call has its page", /ETH \/ USDT/.test((await page.textContent('[data-testid="call-title"]')) ?? ""));
  }

  // 4b. Share: the dialog draws the call's card image
  await page.goto(BASE + "/t/?id=0");
  await page.waitForSelector('[data-testid="share-button"]');
  await page.click('[data-testid="share-button"]');
  await page.waitForSelector('[data-testid="share-card"]', { timeout: 20_000 });
  const cardW = await page.$eval('[data-testid="share-card"]', (img) => img.naturalWidth);
  check("share dialog shows the generated 1200×630 card, with Download image", cardW === 1200 && (await page.isVisible('[data-testid="share-download"]')));
  await page.screenshot({ path: `${OUT}/share.png` });
  await page.keyboard.press("Escape");

  // 5. SOL touches its target on the oracle; "Check the oracle" settles YES; the winner claims.
  // Three minutes pass first: stakes placed in the minute (or two) before a touch are refunded, not paid.
  await rpc("evm_increaseTime", [180]);
  await rpc("evm_mine");
  const call0 = await client.readContract({ address: dep.ThesisCalls, abi: CALLS_ABI, functionName: "getCall", args: [0n] });
  await pushPrice(dep.feeds.SOL.address, (call0.strike * 1002n) / 1000n);
  await page.goto(BASE + "/t/?id=0");
  await page.waitForSelector('[data-testid="sync"]');
  await page.click('[data-testid="sync"]');
  await page.waitForSelector('[data-testid="resolution"]', { timeout: 60_000 });
  check("checking the oracle settles a touched call YES", /YES — touched/.test((await page.textContent('[data-testid="resolution"]')) ?? ""));
  check("and says what it found", /Touch found/.test((await page.textContent('[data-testid="sync-result"]').catch(() => "")) ?? ""));
  await page.waitForSelector('[data-testid="claim"]', { timeout: 30_000 });
  await page.click('[data-testid="claim"]');
  const claimed = await page.waitForSelector('[data-testid="tx-confirmed"]:has-text("Claim")', { timeout: 60_000 }).then(() => true).catch(() => false);
  check("the winner claims the payout", claimed);
  await page.screenshot({ path: `${OUT}/settled.png`, fullPage: true });

  // 5b. Sign out, then sign in with the wallet directly (QIE Pass check down: still works, no badge)
  await page.click('[data-testid="account"]');
  await page.click("text=Sign out");
  await page.click('[data-testid="connect"]');
  await page.click('[data-testid="signin-wallet"]');
  await pickQieWalletInReown(page);
  await page.waitForSelector('[data-testid="account"]', { timeout: 20_000 });
  check("wallet sign-in works too (no QIE Pass badge)", !(await page.isVisible('[data-testid="account-qiepass"]')) && /tester\.qie/.test((await page.textContent('[data-testid="account"]')) ?? ""));

  // 6. Leaderboard and profile
  await page.goto(BASE + "/leaderboard/");
  await page.waitForSelector('[data-testid="leaderboard-row"]', { timeout: 30_000 });
  const top = (await page.locator('[data-testid="leaderboard-row"]').first().textContent()) ?? "";
  check("leaderboard scores the hit (skill = 1 − opening odds)", /\+0\.\d\d/.test(top), top.replace(/\s+/g, " "));
  await page.screenshot({ path: `${OUT}/leaderboard.png`, fullPage: true });
  await page.goto(BASE + "/profile/");
  await page.waitForSelector('[data-testid="positions"]', { timeout: 30_000 });
  await page.waitForSelector('[data-testid="positions"] tbody tr', { timeout: 30_000 });
  const posRows = await page.locator('[data-testid="positions"] tbody tr').allTextContents();
  check(
    "profile lists positions with entry → TP and mark; settled ones show P&L",
    posRows.length >= 2 && posRows.every((r) => /→/.test(r)) && posRows.some((r) => /hit/.test(r) && /P&L/.test(r)),
    posRows.map((r) => r.replace(/\s+/g, " ").slice(0, 60)).join(" | "),
  );
  await page.screenshot({ path: `${OUT}/profile.png`, fullPage: true });
  await page.goto(BASE + "/stats/");
  await page.waitForSelector('[data-testid="stats"]', { timeout: 30_000 });
  check("stats count the touch and the trades", /Touches proven\s*1/.test((await page.textContent('[data-testid="stats"]')) ?? ""));

  // 6b. Bad links: a non-numeric id is "no such call", not a forever-loading page; unknown paths get the styled 404
  await page.goto(BASE + "/t/?id=abc");
  await page.waitForSelector('[data-testid="not-found"]', { timeout: 20_000 });
  check("an invalid call id says so", true);
  const r404 = await page.goto(BASE + "/no-such-page");
  check("unknown paths get the styled 404", r404?.status() === 404 && /Nothing here/.test((await page.textContent("h1")) ?? ""));

  // 6c. Link previews
  await page.goto(BASE + "/");
  const og = await page.$eval('meta[property="og:image"]', (m) => m.getAttribute("content")).catch(() => null);
  check("pages carry an Open Graph / X card image", !!og && /og\.png/.test(og), og ?? "");

  // 7. Mobile
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(BASE + "/app/");
  await m.waitForSelector('[data-testid="thesis-card"]');
  check("mobile shows the tab bar", await m.isVisible('[data-testid="tab-bar"]'));
  await m.screenshot({ path: `${OUT}/home-mobile.png`, fullPage: true });
  await m.goto(BASE + "/");
  await m.screenshot({ path: `${OUT}/landing-mobile.png`, fullPage: true });

  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} passed; screenshots in ${OUT}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
