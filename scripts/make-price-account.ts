/**
 * Writes a solana-test-validator `--account` JSON for a crafted Pyth
 * PriceUpdateV2 (owner: Pyth receiver), for local end-to-end tests only.
 *
 *   tsx scripts/make-price-account.ts <out.json> <spot-multiplier> <publish-delay-secs>
 *
 * Price = current devnet SOL/USD print x multiplier; publish_time = now + delay.
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { writeFileSync } from "node:fs";
import { decodePriceUpdateV2, PYTH_RECEIVER } from "@thesis/chain";

const SOL_USD = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");

async function main() {
  const [out, mult, delay] = process.argv.slice(2);
  const conn = new Connection(process.env.SOURCE_RPC ?? "https://api.devnet.solana.com", "confirmed");
  const data = (await conn.getAccountInfo(SOL_USD))!.data;
  const live = decodePriceUpdateV2(data);
  const price = BigInt(Math.round(Number(live.price) * Number(mult)));
  const publish = Math.floor(Date.now() / 1000) + Number(delay);

  // Rewrite price, conf, publish_time and prev_publish_time in a copy of the real account.
  const crafted = Buffer.from(data);
  const at = 40 + 1 + 32; // Full verification: tag only
  crafted.writeBigInt64LE(price, at);
  crafted.writeBigUInt64LE(price / 20_000n, at + 8); // conf = 0.005% of price
  crafted.writeBigInt64LE(BigInt(publish), at + 20);
  crafted.writeBigInt64LE(BigInt(publish - 1), at + 28);
  const check = decodePriceUpdateV2(crafted);
  if (check.price !== price || check.publishTime !== publish) throw new Error("layout mismatch");

  const key = Keypair.generate().publicKey;
  writeFileSync(
    out,
    JSON.stringify({
      pubkey: key.toBase58(),
      account: {
        lamports: 2_000_000,
        data: [crafted.toString("base64"), "base64"],
        owner: PYTH_RECEIVER.toBase58(),
        executable: false,
        rentEpoch: 0,
        space: crafted.length,
      },
    }),
  );
  console.log(JSON.stringify({ pubkey: key.toBase58(), livePrice: live.price.toString(), price: price.toString(), publish }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
