import { Transaction } from "@solana/web3.js";
import { decodePriceUpdateV2, provable, SOL_USD_PRICE_ACCOUNT } from "@thesis/chain";
import { configPda, connection, fetchConfig, fetchTouchMarket, program } from "@/lib/chain";
import { bad, env, json, pubkey } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/prove/:market {prover} — the "Prove it" button.
 *
 * Reads the onchain Pyth price account (itself a verified PriceUpdateV2) and,
 * if it proves the touch under the same rules as `prove_touch`, returns an
 * unsigned transaction for the prover's wallet to sign. Otherwise 409 with
 * the reason. A Hermes path that posts the exact crossing print can be added
 * once a Hermes key is available.
 */
export async function POST(req: Request, { params }: { params: Promise<{ market: string }> }) {
  const { market } = await params;
  const marketKey = pubkey(market);
  if (!marketKey) return bad("not a valid address");
  const body = (await req.json().catch(() => null)) as { prover?: string } | null;
  const prover = pubkey(body?.prover);
  if (!prover) return bad("prover must be a valid address");

  const [m, config] = await Promise.all([fetchTouchMarket(marketKey), fetchConfig()]);
  if (!m) return bad("market not found", 404);
  if (!config) return bad("program not initialised", 503);

  const priceAccount = pubkey(env.pythPriceAccount) ?? SOL_USD_PRICE_ACCOUNT;
  const info = await connection.getAccountInfo(priceAccount);
  if (!info) return bad("price account not found", 503);
  const tick = decodePriceUpdateV2(info.data);
  const verdict = provable(m.view, tick, config.max_conf_bps);
  if (!verdict.ok) {
    return json(
      { provable: false, reason: verdict.reason, price: tick.price.toString(), publishTime: tick.publishTime },
      409,
    );
  }

  const ix = await program.methods
    .proveTouch()
    .accountsPartial({ prover, config: configPda, touchMarket: marketKey, priceUpdate: priceAccount })
    .instruction();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: prover, blockhash, lastValidBlockHeight }).add(ix);
  return json({
    provable: true,
    price: tick.price.toString(),
    publishTime: tick.publishTime,
    transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"),
  });
}
