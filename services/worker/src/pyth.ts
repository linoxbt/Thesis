import { PublicKey } from "@solana/web3.js";

/** Pyth receiver program (devnet and mainnet). */
export const PYTH_RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

/** One price observation, in Pyth units (real price = price * 10^expo). */
export interface PriceTick {
  feedId: Buffer;
  price: bigint;
  conf: bigint;
  expo: number;
  publishTime: number;
  fullyVerified: boolean;
  /**
   * A PriceUpdateV2 account holding exactly this price, usable as the
   * `price_update` of `prove_touch`. Set by sources that read an onchain
   * account; a Hermes source would post the update first and set it then.
   */
  proofAccount?: PublicKey;
}

const DISCRIMINATOR = Buffer.from([34, 241, 35, 99, 157, 126, 244, 205]);

/** Decodes a PriceUpdateV2 account (same layout as programs/thesis/src/pyth.rs). */
export function decodePriceUpdateV2(data: Buffer): Omit<PriceTick, "proofAccount"> {
  if (data.length < 8 + 32 + 1 || !data.subarray(0, 8).equals(DISCRIMINATOR)) {
    throw new Error("not a PriceUpdateV2 account");
  }
  let at = 40;
  const level = data[at];
  if (level !== 0 && level !== 1) throw new Error(`bad verification level ${level}`);
  at += level === 0 ? 2 : 1;
  const feedId = Buffer.from(data.subarray(at, at + 32));
  at += 32;
  return {
    feedId,
    price: data.readBigInt64LE(at),
    conf: data.readBigUInt64LE(at + 8),
    expo: data.readInt32LE(at + 16),
    publishTime: Number(data.readBigInt64LE(at + 20)),
    fullyVerified: level === 1,
  };
}
