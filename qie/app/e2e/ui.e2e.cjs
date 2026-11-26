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
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/favicon|404/.test(m.text()) && errors.push(m.text()));

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
  check("network badge visible", /QIE local/i.test((await page.textContent('[data-testid="network-badge"]')) ?? ""));
  await page.screenshot({ path: `${OUT}/home.png`, fullPage: true });

  // 2. Connect (QIE Wallet found via EIP-6963)
  // Already-approved wallets reconnect silently (eth_accounts); otherwise press Connect.
  const first = await page.waitForSelector('[data-testid="connect"], [data-testid="account"]');
  if ((await first.getAttribute("data-testid")) === "connect") await page.click('[data-testid="connect"]');
  await page.waitForSelector('[data-testid="account"]');
  check("connects through QIE Wallet discovery", /0xa0Ee/i.test((await page.textContent('[data-testid="account"]')) ?? ""));

  // 3. Back the SOL call with 5 QUSDC
  await page.goto(BASE + "/call/?id=0"); // old links redirect to the trade page
  await page.waitForURL(/\/t\/\?id=0/);
  await page.waitForSelector('[data-testid="bet-box"]');
  await page.fill('[data-testid="bet-amount"]', "5");
  await page.waitForFunction(() => /pays [\d.]+ QUSDC/.test(document.querySelector('[data-testid="bet-quote"]')?.textContent ?? ""));
  await page.click('[data-testid="bet-submit"]');
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

  // 5. SOL touches its target on the oracle; "Check the oracle" settles YES; the winner claims
  const call0 = await client.readContract({ address: dep.ThesisCalls, abi: parseAbi(["function getCall(uint256) view returns ((address creator,address feed,bool above,bool touched,bool settled,bool yesWon,uint16 openBps,uint64 start,uint64 end,int256 strike,int256 spotAtOpen,uint80 touchRound,int256 touchPrice,uint80 checkedRound,bool scanDone,uint256 yesPool,uint256 noPool,uint256 volume))"]), functionName: "getCall", args: [0n] });
  await pushPrice(dep.feeds.SOL.address, (call0.strike * 1002n) / 1000n);
  await page.goto(BASE + "/t/?id=0");
  await page.waitForSelector('[data-testid="sync"]');
  await page.click('[data-testid="sync"]');
  await page.waitForSelector('[data-testid="resolution"]', { timeout: 60_000 });
  check("checking the oracle settles a touched call YES", /YES — touched/.test((await page.textContent('[data-testid="resolution"]')) ?? ""));
  await page.waitForSelector('[data-testid="claim"]', { timeout: 30_000 });
  await page.click('[data-testid="claim"]');
  const claimed = await page.waitForSelector('[data-testid="tx-confirmed"]:has-text("Claim")', { timeout: 60_000 }).then(() => true).catch(() => false);
  check("the winner claims the payout", claimed);
  await page.screenshot({ path: `${OUT}/settled.png`, fullPage: true });

  // 6. Leaderboard and profile
  await page.goto(BASE + "/leaderboard/");
  await page.waitForSelector('[data-testid="leaderboard-row"]', { timeout: 30_000 });
  const top = (await page.locator('[data-testid="leaderboard-row"]').first().textContent()) ?? "";
  check("leaderboard scores the hit (skill = 1 − opening odds)", /\+0\.\d\d/.test(top), top.replace(/\s+/g, " "));
  await page.screenshot({ path: `${OUT}/leaderboard.png`, fullPage: true });
  await page.goto(BASE + "/profile/");
  await page.waitForSelector('[data-testid="positions"]', { timeout: 30_000 });
  await page.waitForSelector('[data-testid="positions"] li', { timeout: 30_000 });
  check("profile lists positions", (await page.locator('[data-testid="positions"] li').count()) >= 1);
  await page.screenshot({ path: `${OUT}/profile.png`, fullPage: true });
  await page.goto(BASE + "/stats/");
  await page.waitForSelector('[data-testid="stats"]', { timeout: 30_000 });
  check("stats count the touch and the trades", /Touches proven\s*1/.test((await page.textContent('[data-testid="stats"]')) ?? ""));

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
