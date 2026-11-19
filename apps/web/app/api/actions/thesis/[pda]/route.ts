import { PublicKey } from "@solana/web3.js";
import { thesisDetail } from "@thesis/db";
import { actionError, actionJson, ACTION_HEADERS, buildTrade, loadThesis, parseUsdc } from "@/lib/blink";
import { db, env, hasDb, limited, pubkey } from "@/lib/server";
import { fmtLev, positionOf } from "@/lib/position";

export const dynamic = "force-dynamic";

const usd = (v: number) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (ts: number) => new Date(ts * 1000).toUTCString().slice(5, 22) + " UTC";
const MAX_USDC = 250;

export const OPTIONS = async () => new Response(null, { headers: ACTION_HEADERS });

/** GET: the call as a blink: Back or Challenge the take profit. */
export async function GET(req: Request, { params }: { params: Promise<{ pda: string }> }) {
  const { pda } = await params;
  const key = pubkey(pda);
  if (!key) return actionError("not a valid address");
  const t = await loadThesis(key).catch(() => null);
  if (!t) return actionError("thesis not found", 404);
  const origin = new URL(req.url).origin;
  const px = (v: bigint) => Number(v) * 10 ** t.expo;
  const pos = positionOf(t.direction, px(t.spotAtOpen), px(t.strike), t.liqStrike !== null ? px(t.liqStrike) : null);
  const head = `${pos.side === "long" ? "Long" : "Short"} SOL${pos.lev !== null ? " " + fmtLev(pos.lev) : ""}`;
  let text: string | null = null;
  let yes: number | null = null;
  if (hasDb()) {
    const d = await thesisDetail(db(), pda).catch(() => null);
    text = (d?.thesis as { text?: string } | undefined)?.text ?? null;
    const c = d?.conviction as { yes_price_bps?: number | null; initial_price_bps?: number } | undefined;
    yes = c ? (c.yes_price_bps ?? c.initial_price_bps ?? null) : null;
  }
  const status = t.settled ? "Settled." : t.touched ? "Take profit already hit; settles at the deadline." : !t.open ? "Window closed." : null;
  const base = `/api/actions/thesis/${pda}`;
  return actionJson({
    type: "action",
    icon: `${origin}/api/og/thesis/${pda}`,
    title: `${head}: take profit ${usd(pos.tp)} by ${when(t.endTs)}`,
    description: [
      text ? `"${text.slice(0, 140)}"` : null,
      `Back it if SOL touches ${usd(pos.tp)} in time; challenge it if not.${yes !== null ? ` Crowd odds: ${(yes / 100).toFixed(0)}% YES.` : ""}`,
      "Settled by a Pyth price anyone can submit.",
      env.cluster === "devnet" ? "Devnet: test USDC." : null,
    ]
      .filter(Boolean)
      .join(" "),
    label: "Back",
    disabled: !t.open,
    ...(status ? { error: { message: status } } : {}),
    links: {
      actions: [
        { type: "transaction", label: "Back $5", href: `${base}?side=yes&amount=5` },
        { type: "transaction", label: "Challenge $5", href: `${base}?side=no&amount=5` },
        {
          type: "transaction",
          label: "Back",
          href: `${base}?side=yes&amount={amount}`,
          parameters: [{ type: "number", name: "amount", label: "USDC to back it with", required: true, min: 1, max: MAX_USDC }],
        },
        {
          type: "transaction",
          label: "Challenge",
          href: `${base}?side=no&amount={amount}`,
          parameters: [{ type: "number", name: "amount", label: "USDC to challenge it with", required: true, min: 1, max: MAX_USDC }],
        },
      ],
    },
  });
}

/** POST {account}: an unsigned trade for that wallet. */
export async function POST(req: Request, { params }: { params: Promise<{ pda: string }> }) {
  const slow = await limited(req, "blink", 30, 60);
  if (slow) return actionError("too many requests; wait a minute", 429);
  const { pda } = await params;
  const key = pubkey(pda);
  if (!key) return actionError("not a valid address");
  const q = new URL(req.url).searchParams;
  const side = q.get("side");
  if (side !== "yes" && side !== "no") return actionError("side must be yes or no");
  const amount = parseUsdc(q.get("amount"));
  if (amount === null || amount > BigInt(MAX_USDC) * 1_000_000n) return actionError(`amount must be between 1 and ${MAX_USDC} USDC`);
  const body = (await req.json().catch(() => null)) as { account?: string } | null;
  const trader = pubkey(body?.account);
  if (!trader) return actionError("account must be a valid wallet address");
  const t = await loadThesis(key).catch(() => null);
  if (!t) return actionError("thesis not found", 404);
  if (!t.open) return actionError(t.touched ? "The take profit was already hit." : "This call is closed.");
  try {
    const { transaction, output } = await buildTrade(t, new PublicKey(trader), side, amount);
    const usdc = (Number(amount) / 1e6).toFixed(2);
    return actionJson({
      type: "transaction",
      transaction,
      message: `${side === "yes" ? "Backed" : "Challenged"} with $${usdc}: ${(Number(output) / 1e6).toFixed(2)} ${side === "yes" ? "YES" : "NO"}, paying $1 each ${side === "yes" ? "if the take profit is hit" : "if it isn't"}.`,
    });
  } catch (e) {
    return actionError((e as Error).message.split("\n")[0], 422);
  }
}
