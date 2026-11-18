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

  // 0. Landing: renders, theme toggles and persists, "Launch app" opens the feed
  await page.goto(BASE + "/");
  await page.waitForSelector('[data-testid="launch-app"]');
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click('[data-testid="theme-toggle"]');
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.reload();
  const kept = await page.evaluate(() => document.documentElement.dataset.theme);
  check("landing: theme toggles and persists", !!before && before !== after && kept === after, `${before} -> ${after}, after reload ${kept}`);
  await page.screenshot({ path: `${OUT}/landing-desktop.png`, fullPage: true });
  await page.click('[data-testid="launch-app"]');
  await page.waitForURL(/\/app$/);

  // 1. Feed
  await page.waitForSelector('[data-testid="thesis-card"]', { timeout: 30_000 });
  const cards = await page.locator('[data-testid="thesis-card"]').count();
  check("feed shows thesis cards", cards >= 3, `${cards} cards`);
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

    // 6. Profile and stats
    const wallet = (await page.evaluate(() => JSON.parse(localStorage.getItem("thesis-burner-v1") ?? "null"))) ? "burner" : "";
    await page.click('[data-testid="wallet-chip"]');
    await page.click("text=My profile");
    await page.waitForSelector("text=Thesis history");
    await page.waitForTimeout(1500);
    const posted = await page.locator("text=Theses posted").locator("..").textContent();
    check("profile shows the new thesis", !!posted && /1/.test(posted), `${wallet} ${posted}`);
    await page.screenshot({ path: `${OUT}/profile.png`, fullPage: true });
    await page.goto(BASE + "/stats");
    await page.waitForSelector("text=Trading wallets");
    await page.screenshot({ path: `${OUT}/stats.png`, fullPage: true });
    check("stats page renders", true);

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
    await m.waitForTimeout(1500);
    await m.screenshot({ path: `${OUT}/thesis-mobile.png`, fullPage: true });
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
