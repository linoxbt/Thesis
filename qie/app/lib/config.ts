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
  mainnet: {
    id: 1990,
    name: "QIE Blockchain Mainnet",
    rpcs: [1, 2, 3, 4, 5].map((n) => `https://rpc${n}mainnet.qie.digital`),
    explorer: "https://mainnet.qie.digital",
  },
  testnet: { id: 1983, name: "QIE Testnet", rpcs: ["https://rpc4testnet.qie.digital", "https://rpc1testnet.qie.digital"], explorer: "https://testnet.qie.digital" },
  // Only a local build knows the local chain's address (the build check for
  // production refuses any bundle that mentions it).
  local: { id: 31337, name: "Local (Hardhat)", rpcs: process.env.NEXT_PUBLIC_QIE_NETWORK === "local" ? ["http://127.0.0.1:8545"] : [], explorer: "" },
} as const;

const net = NETS[NETWORK];
/** RPC endpoints in order of preference; reads fail over between them. */
export const RPC_URLS: readonly string[] = process.env.NEXT_PUBLIC_RPC_URL ? [process.env.NEXT_PUBLIC_RPC_URL] : net.rpcs;
export const RPC_URL = RPC_URLS[0];
export const EXPLORER = net.explorer;
export const IS_MAINNET = NETWORK === "mainnet";

export const qie = defineChain({
  id: net.id,
  name: net.name,
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: { default: { http: [...RPC_URLS] } },
  blockExplorers: net.explorer ? { default: { name: "QIE Explorer", url: net.explorer } } : undefined,
});

export const CALLS_ADDRESS = (process.env.NEXT_PUBLIC_CALLS_ADDRESS ?? "0x0000000000000000000000000000000000000000") as Address;
export const DEPLOYED = CALLS_ADDRESS !== "0x0000000000000000000000000000000000000000";

export const explorerTx = (hash: string) => (EXPLORER ? `${EXPLORER}/tx/${hash}` : "#");
export const explorerAddress = (a: string) => (EXPLORER ? `${EXPLORER}/address/${a}` : "#");
export const QUSDC_URL = "https://www.stable.qie.digital/";

/** First block to read contract events from (the deploy block); 0 on a local chain. */
export const DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK ?? (NETWORK === "mainnet" ? "12204250" : "0"));

/** Reown (WalletConnect) project ID, from dashboard.reown.com. Public by design; without it the Reown option is hidden. */
export const REOWN_PROJECT_ID = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";

/** QIE ID widget (buy a .qie ID on this site; partner earns on each sale). */
export const QIE_ID_WIDGET_ID = process.env.NEXT_PUBLIC_QIE_ID_WIDGET_ID ?? "qie-live-4aec64940f8c0fb529b7";
export const QIE_ID_WIDGET_URL = "https://widget.qie.digital/";
export const QIE_ID_HOSTED_URL = `${QIE_ID_WIDGET_URL}?widgetId=${QIE_ID_WIDGET_ID}`;
