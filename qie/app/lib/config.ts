import { defineChain, type Address } from "viem";

/**
 * Which QIE network the app talks to, set at build time:
 *   NEXT_PUBLIC_QIE_NETWORK   mainnet (default) | testnet | local
 *   NEXT_PUBLIC_CALLS_ADDRESS the ThesisCalls contract
 *   NEXT_PUBLIC_RPC_URL       optional RPC override
 */
export type QieNetwork = "mainnet" | "testnet" | "local";
export const NETWORK = (process.env.NEXT_PUBLIC_QIE_NETWORK ?? "mainnet") as QieNetwork;

const NETS = {
  mainnet: { id: 1990, name: "QIE Blockchain Mainnet", rpc: "https://rpc1mainnet.qie.digital", explorer: "https://mainnet.qie.digital" },
  testnet: { id: 1983, name: "QIE Testnet", rpc: "https://rpc4testnet.qie.digital", explorer: "https://testnet.qie.digital" },
  local: { id: 31337, name: "Local (Hardhat)", rpc: "http://127.0.0.1:8545", explorer: "" },
} as const;

const net = NETS[NETWORK];
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? net.rpc;
export const EXPLORER = net.explorer;
export const IS_MAINNET = NETWORK === "mainnet";

export const qie = defineChain({
  id: net.id,
  name: net.name,
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: net.explorer ? { default: { name: "QIE Explorer", url: net.explorer } } : undefined,
});

export const CALLS_ADDRESS = (process.env.NEXT_PUBLIC_CALLS_ADDRESS ?? "0x0000000000000000000000000000000000000000") as Address;
export const DEPLOYED = CALLS_ADDRESS !== "0x0000000000000000000000000000000000000000";

export const explorerTx = (hash: string) => (EXPLORER ? `${EXPLORER}/tx/${hash}` : "#");
export const explorerAddress = (a: string) => (EXPLORER ? `${EXPLORER}/address/${a}` : "#");
export const QIE_WALLET_URL = "https://www.qie.digital";
export const QUSDC_URL = "https://www.stable.qie.digital/";

/** First block to read contract events from (the deploy block); 0 on a local chain. */
export const DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK ?? (NETWORK === "mainnet" ? "12187275" : "0"));
export const ORACLE_URL = "https://www.qie.digital";

/** Reown (WalletConnect) project ID, from dashboard.reown.com. Public by design; without it the Reown option is hidden. */
export const REOWN_PROJECT_ID = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";
