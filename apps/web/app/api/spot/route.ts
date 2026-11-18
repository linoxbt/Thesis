import { decodePriceUpdateV2, SOL_USD_PRICE_ACCOUNT } from "@thesis/chain";
import { connection } from "@/lib/chain";
import { bad, env, json, pubkey } from "@/lib/server";

export const dynamic = "force-dynamic";

/** GET /api/spot — the latest SOL/USD print from the onchain Pyth account. */
export async function GET() {
  const account = pubkey(env.pythPriceAccount) ?? SOL_USD_PRICE_ACCOUNT;
  const info = await connection.getAccountInfo(account);
  if (!info) return bad("price account not found", 503);
  const p = decodePriceUpdateV2(info.data);
  return json(
    {
      account: account.toBase58(),
      price: p.price.toString(),
      conf: p.conf.toString(),
      expo: p.expo,
      publishTime: p.publishTime,
      fullyVerified: p.fullyVerified,
    },
    200,
    5,
  );
}
