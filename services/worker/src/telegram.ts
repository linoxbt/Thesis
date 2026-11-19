/**
 * Telegram alerts.
 *
 *   TelegramBot     long-polls getUpdates: `/start <code>` links the chat to the
 *                   wallet that asked for the code on its Profile page, `/stop`
 *                   unlinks, `/status` lists linked wallets.
 *   AlertNotifier   each pass, finds touches, settlements and trades for linked
 *                   wallets, records each alert key first (never sent twice),
 *                   then sends it.
 *   OpsAlerts       optional operator chat: keeper SOL running low, start-up.
 *
 * Env: TELEGRAM_BOT_TOKEN (required to enable), TELEGRAM_ADMIN_CHAT_ID
 * (optional), SITE_URL (links in messages), KEEPER_MIN_SOL (default 0.1).
 */
import type { Connection, PublicKey } from "@solana/web3.js";
import {
  claimAlert, consumeLinkCode, releaseAlert, settleAlerts, touchAlerts, tradeAlerts, unlinkChat, type AlertThesis, type Db,
} from "@thesis/db";
import { fmtLev, positionOf } from "@thesis/chain/src/position";
import { log } from "./client";

export interface TelegramApi {
  call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>;
}

export function telegramApi(token: string, fetchImpl: typeof fetch = fetch): TelegramApi {
  return {
    async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
      const r = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
      });
      const body = (await r.json()) as { ok: boolean; result?: T; description?: string };
      if (!body.ok) throw new Error(`telegram ${method}: ${body.description ?? r.status}`);
      return body.result as T;
    },
  };
}

// ---------- message text (pure, unit-tested) ----------

const px = (v: string | number, expo: number) => Number(v) * 10 ** expo;
const usd = (v: number) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** "Long SOL 20x · TP $75.24 · liq $69.39" */
export function tradeLine(t: AlertThesis): string {
  const p = positionOf(t.direction, px(t.spot_at_open, t.expo), px(t.strike, t.expo), t.liq_strike ? px(t.liq_strike, t.expo) : null);
  const head = `${p.side === "long" ? "Long" : "Short"} SOL${p.lev !== null ? " " + fmtLev(p.lev) : ""}`;
  return `${head} · TP ${usd(p.tp)}${p.liq !== null ? ` · liq ${usd(p.liq)}` : ""}`;
}

const link = (site: string, pda: string) => `<a href="${site}/t/${pda}">Open the trade</a>`;

export function touchText(
  site: string,
  r: AlertThesis & { is_conviction: boolean; is_creator: boolean; touch_price: string },
): string {
  const at = usd(px(r.touch_price, r.expo));
  if (r.is_conviction) {
    return [
      r.is_creator ? "🎯 <b>Take profit hit</b>" : "🎯 <b>Take profit hit</b> on a call you backed",
      esc(tradeLine(r)),
      `SOL touched ${at} (Pyth). ${r.is_creator ? "Your call is proven" : "YES wins"}; the market settles at window end.`,
      link(site, r.pda),
    ].join("\n");
  }
  const liq = usd(px(r.liq_strike ?? r.strike, r.expo));
  return [
    "🛡 <b>Liquidation level touched</b>",
    esc(tradeLine(r)),
    `SOL touched ${at}, at or past ${liq}. ${r.is_creator ? "Your cover pays" : "The cover you bought pays"} at window end.`,
    link(site, r.pda),
  ].join("\n");
}

export function settleText(
  site: string,
  r: AlertThesis & { is_conviction: boolean; is_creator: boolean; winning_side: number; sides: string | null },
): string {
  const yesWon = r.winning_side === 1;
  const sides = new Set((r.sides ?? "").split(",").filter(Boolean));
  let head: string;
  let body: string;
  if (r.is_conviction && r.is_creator) {
    head = yesWon ? "✅ <b>Called it</b>" : "❌ <b>Missed it</b>";
    body = yesWon ? "Your take profit was hit in time. Claim your creator fees on the trade page." : "Your take profit wasn't reached by the deadline.";
  } else if (!r.is_conviction) {
    head = yesWon ? "🛡 <b>Cover paid out</b>" : "🛡 <b>Cover expired</b>";
    body = yesWon ? "The liquidation level was touched. Claim your cover payout." : "The liquidation level held; the cover expired unused.";
  } else {
    const won = (yesWon && sides.has("buy_yes")) || (!yesWon && sides.has("buy_no"));
    head = won ? "✅ <b>Your side won</b>" : "Settled";
    body = won
      ? `${yesWon ? "YES" : "NO"} won. Claim your winnings on the trade page.`
      : `${yesWon ? "YES" : "NO"} won this one.`;
  }
  return [head, esc(tradeLine(r)), body, link(site, r.pda)].join("\n");
}

export function tradeText(
  site: string,
  r: AlertThesis & { side: string; usdc_amount: string; is_conviction: boolean; price_after_bps: number | null },
): string {
  const amount = usd(Number(r.usdc_amount) / 1e6);
  const odds = r.price_after_bps != null ? ` (YES now ${(r.price_after_bps / 100).toFixed(0)}%)` : "";
  const head = !r.is_conviction
    ? `🛡 <b>Cover bought</b>: ${amount} on your liquidation level`
    : r.side === "buy_yes"
      ? `🟢 <b>Backed</b>: someone bought ${amount} of YES${odds}`
      : `🔴 <b>Challenged</b>: someone bought ${amount} of NO${odds}`;
  return [head, esc(tradeLine(r)), link(site, r.pda)].join("\n");
}

// ---------- bot ----------

interface Update {
  update_id: number;
  message?: { chat: { id: number }; from?: { username?: string }; text?: string };
}

export class TelegramBot {
  private offset = 0;
  private running = false;

  constructor(
    private api: TelegramApi,
    private db: Db,
    private opts: { siteUrl: string; pollTimeoutSecs?: number },
  ) {}

  async start() {
    this.running = true;
    void this.loop();
  }

  async stop() {
    this.running = false;
  }

  private async loop() {
    while (this.running) {
      try {
        const updates = await this.api.call<Update[]>("getUpdates", {
          offset: this.offset,
          timeout: this.opts.pollTimeoutSecs ?? 25,
          allowed_updates: ["message"],
        });
        for (const u of updates) {
          this.offset = u.update_id + 1;
          await this.handle(u).catch((e) => log("telegram", `update ${u.update_id}: ${(e as Error).message}`));
        }
      } catch (e) {
        log("telegram", `getUpdates: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  /** Exposed for tests. */
  async handle(u: Update) {
    const m = u.message;
    if (!m?.text) return;
    const chat = m.chat.id;
    const [cmd, arg] = m.text.trim().split(/\s+/, 2);
    const reply = (text: string) => this.api.call("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true });
    if (cmd === "/start" && arg) {
      const wallet = await consumeLinkCode(this.db, arg, chat, m.from?.username ?? null);
      if (!wallet) return reply("That link has expired. Open your Profile on Thesis and tap <b>Connect Telegram</b> again.");
      return reply(
        `Linked to wallet <code>${wallet.slice(0, 4)}…${wallet.slice(-4)}</code>.\n` +
          "You'll get alerts when your take profit or liquidation is touched, when your markets settle, and when someone backs or challenges your call.\n" +
          "Send /stop to unlink.",
      );
    }
    if (cmd === "/stop") {
      const gone = await unlinkChat(this.db, chat);
      return reply(gone.length ? "Unlinked. No more alerts here." : "No wallet is linked to this chat.");
    }
    if (cmd === "/status") {
      const r = await this.db.query<{ wallet: string }>("select wallet from telegram_links where chat_id = $1", [chat]);
      return reply(r.rows.length ? `Linked: ${r.rows.map((x) => `<code>${x.wallet.slice(0, 4)}…${x.wallet.slice(-4)}</code>`).join(", ")}` : "No wallet linked.");
    }
    return reply(`Thesis alerts. Open your Profile at ${this.opts.siteUrl}/profile and tap <b>Connect Telegram</b>.`);
  }
}

// ---------- notifier ----------

export class AlertNotifier {
  private timer?: NodeJS.Timeout;

  constructor(
    private api: TelegramApi,
    private db: Db,
    private opts: { siteUrl: string; intervalMs: number },
  ) {}

  async start() {
    await this.tick().catch((e) => log("alerts", (e as Error).message));
    this.timer = setInterval(() => void this.tick().catch((e) => log("alerts", (e as Error).message)), this.opts.intervalMs);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass. Returns how many alerts were sent. */
  async tick(): Promise<number> {
    const site = this.opts.siteUrl;
    const out: { key: string; chat: string; text: string }[] = [];
    for (const r of await touchAlerts(this.db)) out.push({ key: `touch:${r.touch_market}:${r.wallet}`, chat: r.chat_id, text: touchText(site, r) });
    for (const r of await settleAlerts(this.db)) out.push({ key: `settle:${r.touch_market}:${r.wallet}`, chat: r.chat_id, text: settleText(site, r) });
    for (const r of await tradeAlerts(this.db)) out.push({ key: `trade:${r.signature}:${r.ix_index}:${r.wallet}`, chat: r.chat_id, text: tradeText(site, r) });
    let sent = 0;
    for (const a of out) {
      if (!(await claimAlert(this.db, a.key))) continue;
      try {
        await this.api.call("sendMessage", { chat_id: a.chat, text: a.text, parse_mode: "HTML", disable_web_page_preview: true });
        sent++;
      } catch (e) {
        await releaseAlert(this.db, a.key); // retry next pass
        log("alerts", `${a.key}: ${(e as Error).message}`);
      }
    }
    if (sent) log("alerts", `sent ${sent}`);
    return sent;
  }
}

// ---------- operator alerts ----------

export class OpsAlerts {
  private last = new Map<string, number>();
  private timer?: NodeJS.Timeout;

  constructor(
    private api: TelegramApi,
    private chatId: string,
    private opts: { connection: Connection; keeper: PublicKey; minSol: number; authority?: PublicKey; authorityMinSol?: number; cluster: string },
  ) {}

  /** Sends at most once per key per `everyMs`; a failed send is retried next time. */
  async notify(key: string, text: string, everyMs = 3_600_000) {
    const now = Date.now();
    if (now - (this.last.get(key) ?? -Infinity) < everyMs) return;
    try {
      await this.api.call("sendMessage", { chat_id: this.chatId, text, parse_mode: "HTML" });
      this.last.set(key, now);
    } catch (e) {
      log("ops", (e as Error).message);
    }
  }

  /** Fire-and-forget form for the watcher and keeper. */
  readonly alert = (key: string, text: string) => void this.notify(key, text);

  async check() {
    const { connection, keeper, minSol, authority, authorityMinSol = 0.1 } = this.opts;
    const [k, a] = await connection.getMultipleAccountsInfo(authority ? [keeper, authority] : [keeper]);
    const sol = (k?.lamports ?? 0) / 1e9;
    if (sol < minSol) await this.notify("keeper-sol", `⚠️ Keeper low on SOL: ${sol.toFixed(3)} SOL (min ${minSol}). Top it up or proofs will stop.`);
    if (authority) {
      const float = (a?.lamports ?? 0) / 1e9;
      if (float < authorityMinSol) {
        await this.notify("authority-sol", `⚠️ Authority PDA float low: ${float.toFixed(3)} SOL (min ${authorityMinSol}). Market creation fronts ~0.04 SOL of rent from it; send SOL to <code>${authority.toBase58()}</code>.`);
      }
    }
  }

  async start() {
    await this.notify("start", `▶️ Thesis worker started (${this.opts.cluster}). Keeper <code>${this.opts.keeper.toBase58()}</code>`, 0);
    await this.check().catch(() => {});
    this.timer = setInterval(() => void this.check().catch(() => {}), 600_000);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
  }
}
