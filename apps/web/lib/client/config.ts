import { PublicKey } from "@solana/web3.js";
import { SOL_USD_PRICE_ACCOUNT } from "@thesis/chain";

export const CLUSTER = (process.env.NEXT_PUBLIC_CLUSTER ?? "devnet") as "devnet" | "mainnet-beta";
export const IS_DEVNET = CLUSTER === "devnet";
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? (IS_DEVNET ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com");
export const PRICE_ACCOUNT = process.env.NEXT_PUBLIC_PYTH_PRICE_ACCOUNT
  ? new PublicKey(process.env.NEXT_PUBLIC_PYTH_PRICE_ACCOUNT)
  : SOL_USD_PRICE_ACCOUNT;
/** Explorer link that works on devnet, mainnet, and a local validator. */
export function explorerTx(sig: string): string {
  if (RPC_URL.includes("127.0.0.1") || RPC_URL.includes("localhost")) {
    return `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`;
  }
  return `https://solscan.io/tx/${sig}${IS_DEVNET ? "?cluster=devnet" : ""}`;
}
export function explorerAccount(addr: string): string {
  if (RPC_URL.includes("127.0.0.1") || RPC_URL.includes("localhost")) {
    return `https://explorer.solana.com/address/${addr}?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`;
  }
  return `https://solscan.io/account/${addr}${IS_DEVNET ? "?cluster=devnet" : ""}`;
}
export const USDC = 1_000_000;
