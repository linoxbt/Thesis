/**
 * Writes a solana-test-validator `--account` JSON: a USDC token account (ATA)
 * holding 1,000 USDC for <owner>. Local rehearsals only (real USDC can't be minted).
 *
 *   tsx scripts/rehearsal-usdc-account.ts <owner> <out.json>
 */
import { AccountLayout, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { writeFileSync } from "node:fs";

const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const [owner, out] = process.argv.slice(2);
const o = new PublicKey(owner);
const data = Buffer.alloc(AccountLayout.span);
AccountLayout.encode(
  {
    mint: USDC, owner: o, amount: 1_000_000_000n, delegateOption: 0, delegate: PublicKey.default, state: 1,
    isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default,
  },
  data,
);
writeFileSync(out, JSON.stringify({
  pubkey: getAssociatedTokenAddressSync(USDC, o).toBase58(),
  account: { lamports: 2_039_280, data: [data.toString("base64"), "base64"], owner: TOKEN_PROGRAM_ID.toBase58(), executable: false, rentEpoch: 0, space: data.length },
}));
