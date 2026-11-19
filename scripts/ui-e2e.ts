/**
 * Drives the web app in Chromium against a local stack (validator cloning
 * devnet pm-AMM, worker, Postgres, `next start` with DEV_FAUCET_KEYPAIR).
 *
 *   BASE_URL=http://localhost:3100 OUT_DIR=/tmp/shots tsx scripts/ui-e2e.ts
 */
import { mkdirSync } from "node:fs";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium, devices } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = process.env.OUT_DIR ?? "/tmp/thesis-shots";
const SCALE = Number(process.env.SCALE ?? "1");
mkdirSync(OUT, { recursive: true });

const results: { step: string; ok: boolean; detail?: string }[] = [];
const check = (step: string, ok: boolean, detail?: string) => {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail ? ` — ${detail}` : ""}`);
};

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: SCALE });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (m: { type(): string; text(): string }) => {
    if (m.type() === "error" && !/favicon|Failed to load resource.*404/.test(m.text())) consoleErrors.push(m.text());
  });
  page.on("pageerror", (e: Error) => consoleErrors.push(String(e)));

  // 0. Landing: renders in the light theme by default; "Launch app" opens the feed
  await page.goto(BASE + "/");
  await page.waitForSelector('[data-testid="launch-app"]');
  const firstTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  check("light is the default theme", firstTheme === "light", String(firstTheme));
  await page.screenshot({ path: `${OUT}/landing-desktop.png`, fullPage: true });
  const home = await page.request.get(BASE + "/");
  const h = home.headers();
  check(
    "security headers (CSP, frame denial, nosniff)",
    /frame-ancestors 'none'/.test(h["content-security-policy"] ?? "") && h["x-frame-options"] === "DENY" && h["x-content-type-options"] === "nosniff",
    (h["content-security-policy"] ?? "missing").slice(0, 80),
  );
  await page.click('[data-testid="launch-app"]');
  await page.waitForURL(/\/app$/);

  // 1. Feed (and the desktop sidebar collapses to a rail, remembered)
  await page.waitForSelector('[data-testid="thesis-card"]', { timeout: 30_000 });
  const logoAt = async () => {
    const b = await page.locator('aside a[aria-label="Thesis home"]').first().boundingBox();
    return b ? `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)}` : "hidden";
  };
  const logoOpen = await logoAt();
  await page.click('[data-testid="sidebar-toggle"]');
  await page.reload();
  await page.waitForSelector('[data-testid="thesis-card"]');
  const rail = await page.locator('[data-sidebar="collapsed"]').count();
  const logoClosed = await logoAt();
  check("collapsed sidebar keeps the logo and name in place", logoOpen === logoClosed, `open ${logoOpen}, collapsed ${logoClosed}`);
  await page.click('[data-testid="sidebar-toggle"]');
  const open = await page.locator('[data-sidebar="open"]').count();
  check("sidebar collapses, stays collapsed after reload, expands", rail === 1 && open === 1, `rail ${rail}, open ${open}`);
  const cards = await page.locator('[data-testid="thesis-card"]').count();
  check("feed shows thesis cards", cards >= 3, `${cards} cards`);
  const pill = await page.locator('[data-testid="side-pill"]').first().textContent();
  check("cards read as positions (side, leverage)", !!pill && /long|short/i.test(pill), pill ?? "");
  await page.screenshot({ path: `${OUT}/feed-desktop.png`, fullPage: true });

  // 2. Instant wallet
  await page.click('[data-testid="burner-start"]');
  await page.waitForSelector('[data-testid="wallet-chip"]', { timeout: 15_000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="wallet-chip"]')?.textContent?.includes("funding"), null, { timeout: 30_000 });
  const chip = await page.textContent('[data-testid="wallet-chip"]');
  check("instant wallet created and funded", !!chip && !chip.includes("funding"), chip ?? "");

  // 3. Back a thesis from the feed
  await page.locator('[data-testid="thesis-card"] button:has-text("Back")').first().click();
  const quoted = () => {
    const t = document.querySelector('[data-testid="quote"]')?.textContent ?? "";
    const m = t.match(/(\d+\.\d{2})/);
    return !!m && Number(m[1]) > 0;
  };
  await page.waitForFunction(quoted, null, { timeout: 30_000 });
  const quote = (await page.textContent('[data-testid="quote"]')) ?? "";
  const details = (await page.locator('[data-testid="quote"] ~ div').first().textContent()) ?? "";
  check("exact quote by simulation", /\d+\.\d{2}/.test(quote) && /pays/.test(details), (quote + " | " + details).replace(/\s+/g, " ").trim());
  await page.screenshot({ path: `${OUT}/feed-trade.png` });
  await page.click('[data-testid="trade-submit"]');
  const backed = await page.waitForSelector('[data-testid="tx-confirmed"], [data-testid="tx-failed"]', { timeout: 90_000 });
  const backedText = (await backed.textContent()) ?? "";
  check("back trade confirmed onchain", (await backed.getAttribute("data-testid")) === "tx-confirmed", backedText.replace(/\s+/g, " ").slice(0, 120));

  // 4. Create a protected thesis
  await page.goto(BASE + "/new");
  await page.waitForFunction(() => /Opening odds: \d/.test(document.body.innerText), null, { timeout: 30_000 });
  await page.fill("textarea", "UI test: SOL runs into the weekend.");
  await page.check('input[type="checkbox"]');
  await page.waitForTimeout(500);
  const odds = await page.locator("text=Opening odds").first().textContent();
  await page.screenshot({ path: `${OUT}/create-form.png`, fullPage: true });
  await page.click('[data-testid="create-submit"]');
  const done = await page
    .waitForSelector('[data-testid="view-thesis"]', { timeout: 240_000 })
    .then(() => true)
    .catch(() => false);
  const stepsText = (await page.textContent('[data-testid="create-steps"]').catch(() => "")) ?? "";
  check("create flow: markets, thesis, cover, text", done, stepsText.replace(/\s+/g, " ").slice(0, 300));
  check("opening odds preview shown", !!odds && /\d/.test(odds), odds ?? "");
  await page.screenshot({ path: `${OUT}/create-done.png`, fullPage: true });

  // 5. Thesis page
  if (done) {
    await page.click('[data-testid="view-thesis"]');
    await page.waitForSelector('[data-testid="panel-conviction"]', { timeout: 30_000 });
    const hasProt = await page.locator('[data-testid="panel-protection"]').count();
    check("thesis page shows conviction and protection panels", hasProt === 1);
    await page.waitForTimeout(6_000); // let the indexer catch the trades
    await page.reload();
    await page.waitForSelector('[data-testid="panel-conviction"]');
    await page.screenshot({ path: `${OUT}/thesis-desktop.png`, fullPage: true });
    const thesisUrl = page.url();
    const pda = thesisUrl.split("/t/")[1];
    const og = await page.request.get(`${BASE}/api/og/thesis/${pda}`);
    const ogBytes = (await og.body()).length;
    check("share card image renders", og.ok() && (og.headers()["content-type"] ?? "").includes("image/png") && ogBytes > 10_000, `${og.status()} ${ogBytes} bytes`);
    await page.click('[data-testid="share-button"]');
    await page.waitForSelector('[data-testid="share-menu"] img');
    check("share menu offers the image", (await page.locator('[data-testid="share-download"]').count()) === 1);
    await page.screenshot({ path: `${OUT}/share-menu.png` });
    await page.keyboard.press("Escape");

    // 5b. Sell back part of the cover bought while posting (Sell tab, exact quote)
    const prot = page.locator('[data-testid="panel-protection"]');
    await prot.locator('[data-testid="mode-sell"]').waitFor({ timeout: 30_000 }).catch(() => {});
    if (await prot.locator('[data-testid="mode-sell"]').count()) {
      await prot.locator('[data-testid="mode-sell"]').click();
      await prot.locator('input[inputmode="decimal"]').fill("0.5");
      await page.waitForFunction(() => /receive/.test(document.querySelector('[data-testid="panel-protection"]')?.textContent ?? ""), null, { timeout: 30_000 });
      await prot.locator('[data-testid="trade-submit"]').click();
      const sold = await page.waitForSelector('[data-testid="tx-confirmed"]:has-text("Sell"), [data-testid="tx-failed"]', { timeout: 90_000 });
      check("sell tab: sells cover back to the pool", (await sold.getAttribute("data-testid")) === "tx-confirmed", ((await sold.textContent()) ?? "").replace(/\s+/g, " ").slice(0, 100));
    } else {
      check("sell tab: sells cover back to the pool", false, "no Sell tab on the protection panel");
    }

    // 5c. Each market has its own page
    const detail = await (await page.request.get(`${BASE}/api/theses/${pda}`)).json();
    const protMarket = detail.protection?.touch_market as string | undefined;
    if (protMarket) {
      await page.goto(`${BASE}/m/${protMarket}`);
      const ok = await page.waitForSelector('[data-testid="panel-protection"]', { timeout: 30_000 }).then(() => true).catch(() => false);
      check("market page renders the cover market", ok && (await page.locator(`a[href="/t/${pda}"]`).count()) > 0);
      await page.goto(thesisUrl);
      await page.waitForSelector('[data-testid="panel-conviction"]');
    }

    // 5d. The prove endpoint is rate limited per IP
    let limited = 0;
    for (let i = 0; i < 35; i++) {
      const r = await page.request.post(`${BASE}/api/prove/${protMarket ?? pda}`, {
        data: { prover: protMarket ?? pda },
        headers: { "x-forwarded-for": "203.0.113.77" },
      });
      if (r.status() === 429) limited++;
    }
    check("prove endpoint rate-limits a flood from one IP", limited > 0, `${limited} of 35 refused`);

    // 6. Profile and stats
    const wallet = (await page.evaluate(() => JSON.parse(localStorage.getItem("thesis-burner-v1") ?? "null"))) ? "burner" : "";
    await page.click('[data-testid="wallet-chip"]');
    await page.click('[data-testid="wallet-menu-profile"]');
    await page.waitForURL(/\/profile$/);
    await page.waitForSelector("text=Thesis history");
    await page.waitForTimeout(1500);
    const posted = await page.locator("text=Theses posted").locator("..").textContent();
    check("profile shows the new thesis", !!posted && /1/.test(posted), `${wallet} ${posted}`);
    const positions = await page.waitForSelector('[data-testid="positions"] li', { timeout: 20_000 }).then(() => true).catch(() => false);
    check("profile lists open positions (balances read onchain)", positions, positions ? `${await page.locator('[data-testid="positions"] li').count()} rows` : "none");
    const sol = await page.textContent('[data-testid="balance-sol"]');
    check("profile shows wallet balances", !!sol && /\d+\.\d{3}/.test(sol), `SOL ${sol}`);

    // 6b. Name signed by the wallet, then shown on the profile
    await page.fill('[data-testid="profile-display-name"]', "e2e trader");
    await page.click('[data-testid="profile-save"]');
    await page.waitForSelector('[data-testid="profile-saved"]', { timeout: 20_000 });
    await page.waitForFunction(() => /e2e trader/.test(document.querySelector('[data-testid="profile-name"]')?.textContent ?? ""), null, { timeout: 15_000 });
    check("profile: wallet-signed display name saved", true);
    await page.screenshot({ path: `${OUT}/profile.png`, fullPage: true });

    // 6b2. Theme lives in Profile: switch to dark, persists across reloads
    await page.click('[data-testid="theme-dark"]');
    await page.reload();
    await page.waitForSelector('[data-testid="settings"]');
    const kept = await page.evaluate(() => document.documentElement.dataset.theme);
    check("theme switch in Profile persists", kept === "dark", String(kept));

    // 6b3. Telegram alerts: signing gets a one-time bot link
    if (await page.locator('[data-testid="telegram-connect"]').count()) {
      await page.click('[data-testid="telegram-connect"]');
      const href = await page.locator('[data-testid="telegram-open"]').getAttribute("href", { timeout: 15_000 }).catch(() => null);
      check("telegram: wallet-signed connect returns a one-time bot link", !!href && /^https:\/\/t\.me\/\w+\?start=[\w-]{10,}$/.test(href), href ?? "");
    }

    // 6c. The logo goes to the home page
    await page.click('aside a[aria-label="Thesis home"]');
    await page.waitForURL(BASE + "/");
    check("logo goes to the home page", (await page.locator('[data-testid="launch-app"]').count()) > 0);
    await page.goto(BASE + "/stats");
    await page.waitForSelector("text=Trading wallets");
    await page.screenshot({ path: `${OUT}/stats.png`, fullPage: true });
    const st = await (await page.request.get(`${BASE}/api/stats`)).json();
    check("stats count this run's trades", Number(st.trades) > 0 && Number(st.volume_usdc) > 0 && Number(st.wallets) > 0, `trades ${st.trades}, volume ${st.volume_usdc}, wallets ${st.wallets}`);

    // 6d. Protect: an open cover pool near the level is offered (no new market rent)
    await page.goto(BASE + "/protect");
    const nearby = await page.waitForSelector('[data-testid="protect-nearby"]', { timeout: 30_000 }).then(() => true).catch(() => false);
    check("protect offers the existing cover pool near the level", nearby);
    await page.screenshot({ path: `${OUT}/protect.png`, fullPage: true });

    // 7. Mobile
    const mobile = await browser.newContext({ ...devices["iPhone 13"] });
    const m = await mobile.newPage();
    await m.goto(BASE + "/");
    await m.screenshot({ path: `${OUT}/landing-mobile.png`, fullPage: true });
    await m.goto(BASE + "/app");
    await m.waitForSelector('[data-testid="thesis-card"]');
    await m.screenshot({ path: `${OUT}/feed-mobile.png`, fullPage: true });
    await m.goto(thesisUrl);
    await m.waitForSelector('[data-testid="panel-conviction"]');
    const tabsHidden = !(await m.locator('[data-testid="tab-bar"]').isVisible());
    const backShown = await m.locator('[data-testid="mobile-back"]').isVisible();
    check("detail page on mobile: no tab bar, back button", tabsHidden && backShown, `tabs hidden ${tabsHidden}, back ${backShown}`);
    await m.waitForTimeout(1500);
    await m.screenshot({ path: `${OUT}/thesis-mobile.png`, fullPage: true });
    await m.click('[data-testid="mobile-back"]');
    await m.waitForURL(/\/app$/, { timeout: 10_000 }).catch(() => {});
    check("mobile back button returns to the feed", /\/app$/.test(m.url()), m.url());
    await mobile.close();
  }

  check("no browser console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed; screenshots in ${OUT}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
