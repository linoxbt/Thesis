import type { Address, EIP1193Provider } from "viem";
import { EXPLORER, qie, REOWN_PROJECT_ID, RPC_URL } from "./config";

/** Wallets listed first, by their IDs in Reown's directory: QIE Wallet, then the most used. */
const FEATURED = [
  "7eb95f5e01a3c45f7f0111f736d73e5c88aa5f268256c6a38b7f631216f620fb", // QIE Wallet (me.qiewallet)
  "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96", // MetaMask
  "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0", // Trust Wallet
  "971e689d0a5be527bac79629b4ee9b925e82208e5168b733496a09c0faed0709", // OKX Wallet
];

type AppKit = Awaited<ReturnType<typeof create>>;
let kit: Promise<AppKit> | null = null;

async function create() {
  const [{ createAppKit }, { EthersAdapter }] = await Promise.all([import("@reown/appkit"), import("@reown/appkit-adapter-ethers")]);
  const network = {
    id: qie.id,
    caipNetworkId: `eip155:${qie.id}` as const,
    chainNamespace: "eip155" as const,
    name: qie.name,
    nativeCurrency: qie.nativeCurrency,
    rpcUrls: { default: { http: [RPC_URL] } },
    blockExplorers: EXPLORER ? { default: { name: "QIE Explorer", url: EXPLORER } } : undefined,
  };
  const k = createAppKit({
    adapters: [new EthersAdapter()],
    networks: [network],
    defaultNetwork: network,
    projectId: REOWN_PROJECT_ID,
    metadata: {
      name: "Thesis on QIE",
      description: "Prove you called it: trade calls as markets on QIE.",
      url: window.location.origin,
      icons: [`${window.location.origin}/icon.svg`],
    },
    // Wallets only: connectMethodsOrder ["wallet"] means the picker draws just the
    // wallet list, so Email and Google never show whatever the Reown dashboard says.
    // Installed wallets (EIP-6963) are detected and listed alongside these.
    featuredWalletIds: FEATURED,
    enableWallets: true,
    features: { connectMethodsOrder: ["wallet"], analytics: false, email: false, socials: false, swaps: false, onramp: false, history: false, send: false },
    allowUnsupportedChain: false,
    themeMode: "light",
  });
  // Ready once AppKit knows whether a previous wallet is coming back (status
  // settles on connected or disconnected), so callers never open the picker
  // over a reconnect in progress.
  await new Promise<void>((resolve) => {
    const known = () => {
      const st = k.getAccount()?.status;
      return st === "connected" || st === "disconnected";
    };
    if (known()) return resolve();
    const t = setTimeout(done, 3000);
    const unsub = k.subscribeAccount(() => known() && done());
    function done() {
      clearTimeout(t);
      unsub();
      resolve();
    }
  });
  return k;
}

/** Reown AppKit, created on first use (it's large, and only needed to connect). */
function appKit(): Promise<AppKit> {
  if (!REOWN_PROJECT_ID) return Promise.reject(new Error("Reown isn't set up on this site yet."));
  if (!kit) {
    kit = create();
    kit.catch(() => (kit = null));
  }
  return kit;
}

const providerOf = (k: AppKit) => k.getWalletProvider() as EIP1193Provider | undefined;

/**
 * Opens Reown's wallet picker (installed wallets, QIE Wallet app, QR code,
 * 700+ wallets) and resolves with the connected wallet. Rejects with an empty
 * message if the picker is closed without connecting. With `fresh`, a wallet
 * that is already connected is disconnected first, so the user always picks.
 */
export async function connectWallet(opts: { fresh?: boolean } = {}): Promise<{ provider: EIP1193Provider; address: Address }> {
  const k = await appKit();
  // After a reload AppKit reconnects a previous wallet in the background: wait
  // for that rather than open the picker over it.
  await settled(k);
  if (opts.fresh && k.getIsConnectedState()) await k.disconnect().catch(() => {});
  const now = k.getAddress();
  const p = providerOf(k);
  if (k.getIsConnectedState() && now && p) return { provider: p, address: now as Address };
  return new Promise((resolve, reject) => {
    let opened = false;
    let done = false;
    const finish = (f: () => void) => {
      if (done) return;
      done = true;
      unsubAccount();
      unsubState();
      f();
    };
    const unsubAccount = k.subscribeAccount((a) => {
      const prov = providerOf(k);
      if (a.isConnected && a.address && prov) {
        finish(() => resolve({ provider: prov, address: a.address as Address }));
        // Close once now and once after the picker's own transitions settle.
        void k.close();
        setTimeout(() => void k.close(), 600);
      }
    });
    const unsubState = k.subscribeState((s) => {
      if (s.open) opened = true;
      else if (opened) setTimeout(() => !k.getIsConnectedState() && finish(() => reject(new Error(""))), 400);
    });
    k.open({ view: "Connect" }).catch((e: unknown) => finish(() => reject(e instanceof Error ? e : new Error("Reown couldn't open the wallet picker."))));
  });
}

/** Calls `fn(open)` whenever Reown's modal opens or closes; returns an unsubscribe. */
export async function onModalChange(fn: (open: boolean) => void): Promise<() => void> {
  const k = await appKit();
  return k.subscribeState((s) => fn(!!s.open));
}

/** Resolves once AppKit isn't (re)connecting, or after `ms`. */
function settled(k: AppKit, ms = 4000): Promise<void> {
  const busy = () => {
    const st = k.getAccount()?.status;
    return st === "reconnecting" || st === "connecting";
  };
  if (!busy()) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    const unsub = k.subscribeAccount(() => !busy() && done());
    function done() {
      clearTimeout(t);
      unsub();
      resolve();
    }
  });
}

/** After a reload: waits briefly for AppKit to restore a previous connection to `address`. */
export async function restoreWallet(address: string, timeoutMs = 6000): Promise<EIP1193Provider | null> {
  const k = await appKit();
  const match = () => {
    const p = providerOf(k);
    return k.getIsConnectedState() && k.getAddress()?.toLowerCase() === address.toLowerCase() && p ? p : null;
  };
  const hit = match();
  if (hit) return hit;
  return new Promise((resolve) => {
    const t = setTimeout(() => (unsub(), resolve(null)), timeoutMs);
    const unsub = k.subscribeAccount(() => {
      const p = match();
      if (p) {
        clearTimeout(t);
        unsub();
        resolve(p);
      }
    });
  });
}

export async function disconnectWallet() {
  if (!kit) return;
  await (await kit).disconnect().catch(() => {});
}
