"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BaseError, ContractFunctionRevertedError, createWalletClient, custom, type Abi, type Address, type EIP1193Provider } from "viem";
import { publicClient } from "./chain";
import { EXPLORER, qie, RPC_URL } from "./config";

interface Announced {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
}

declare global {
  interface Window {
    qie?: EIP1193Provider;
    ethereum?: EIP1193Provider;
  }
}

/** QIE Wallet first (EIP-6963 rdns `me.qiewallet`, then `window.qie`), then any injected wallet. */
function pickProvider(announced: Announced[]): { provider: EIP1193Provider; name: string } | null {
  const q = announced.find((a) => a.info.rdns === "me.qiewallet");
  if (q) return { provider: q.provider, name: "QIE Wallet" };
  if (typeof window !== "undefined" && window.qie) return { provider: window.qie, name: "QIE Wallet" };
  if (announced[0]) return { provider: announced[0].provider, name: announced[0].info.name };
  if (typeof window !== "undefined" && window.ethereum) return { provider: window.ethereum, name: "Browser wallet" };
  return null;
}

const CHAIN_HEX = "0x" + qie.id.toString(16);

/** Contract errors in plain words (custom error names from ThesisCalls). */
const REASONS: Record<string, string> = {
  Paused: "Trading is paused.",
  FeedNotEnabled: "That market isn't available.",
  StaleOracle: "The oracle price is too old right now; try again after the next update.",
  StaleVolatility: "Volatility hasn't been updated recently; try again soon.",
  BadPrice: "The oracle returned no usable price.",
  StrikeWrongSide: "The target must be above the price for a long call, below it for a short.",
  StrikeDistance: "The target is too close to or too far from the current price.",
  BadWindow: "Pick a deadline inside the allowed window.",
  OddsOutOfRange: "That call is too likely or too unlikely to open (odds must be 1%–99%).",
  BadSeed: "The seed is outside the allowed range.",
  TextTooLong: "Keep the reason under 280 characters.",
  CallClosed: "This call is closed for new bets.",
  StakeTooSmall: "That's below the minimum bet.",
  AlreadyFinal: "Already settled.",
  ProofTooLate: "The proof window has closed.",
  RoundOutsideWindow: "That oracle round is outside the call's window.",
  NoTouch: "That oracle round didn't reach the target.",
  TooEarly: "It can't settle yet.",
  NotSettled: "Not settled yet.",
  NothingToClaim: "Nothing to claim.",
  SyncRequired: "The oracle has many new rounds; press “Check the oracle” first.",
  NearStrike: "The price is right at the target: betting pauses until it moves away.",
  Unauthorized: "This wallet isn't allowed to do that.",
};

export function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = revert?.data?.errorName;
    if (name && REASONS[name]) return REASONS[name];
    if (/User rejected|denied|4001/i.test(e.message)) return "You rejected the request in your wallet.";
    if (/insufficient funds/i.test(e.message)) return "Not enough QIE for gas.";
    if (/ERC20InsufficientBalance|exceeds balance/i.test(e.message)) return "Not enough QUSDC.";
    return e.shortMessage;
  }
  return (e as Error)?.message ?? String(e);
}

export interface Toast {
  id: number;
  label: string;
  status: "pending" | "confirmed" | "failed";
  hash?: string;
  error?: string;
}

interface WalletState {
  available: boolean;
  walletName: string | null;
  account: Address | null;
  chainOk: boolean;
  connect(): Promise<void>;
  disconnect(): void;
  /** Sends a contract write and waits for it; shows a toast; throws on failure. */
  write(label: string, call: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }): Promise<string>;
  toasts: Toast[];
  dismiss(id: number): void;
}

const Ctx = createContext<WalletState | null>(null);
const FORGET_KEY = "thesis-qie-disconnected";

export function WalletProvider({ children }: { children: ReactNode }) {
  const [announced, setAnnounced] = useState<Announced[]>([]);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [tick, setTick] = useState(0);

  // EIP-6963 discovery.
  useEffect(() => {
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent<Announced>).detail;
      setAnnounced((xs) => (xs.some((x) => x.info.uuid === d.info.uuid) ? xs : [...xs, d]));
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const t = setTimeout(() => setTick((x) => x + 1), 400); // re-pick after late injections
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(t);
    };
  }, []);

  // Picked after mount, so the first render matches the prebuilt HTML (no wallet on the server).
  const [picked, setPicked] = useState<{ provider: EIP1193Provider; name: string } | null>(null);
  useEffect(() => setPicked(pickProvider(announced)), [announced, tick]);

  // Silent reconnect, and follow the wallet's account and network.
  useEffect(() => {
    const p = picked?.provider;
    if (!p) return;
    const onAccounts = (a: unknown) => setAccount(((a as string[])[0] as Address) ?? null);
    const onChain = (c: unknown) => setChainId(String(c).toLowerCase());
    if (localStorage.getItem(FORGET_KEY) !== "1") {
      p.request({ method: "eth_accounts" }).then((a) => onAccounts(a)).catch(() => {});
    }
    p.request({ method: "eth_chainId" }).then(onChain).catch(() => {});
    p.on?.("accountsChanged", onAccounts as never);
    p.on?.("chainChanged", onChain as never);
    return () => {
      p.removeListener?.("accountsChanged", onAccounts as never);
      p.removeListener?.("chainChanged", onChain as never);
    };
  }, [picked]);

  const ensureChain = useCallback(async () => {
    const p = picked?.provider;
    if (!p) throw new Error("No wallet found. Install QIE Wallet.");
    const current = String(await p.request({ method: "eth_chainId" })).toLowerCase();
    if (current === CHAIN_HEX) return;
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
    } catch (e) {
      if ((e as { code?: number }).code !== 4902) throw e;
      await p.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: CHAIN_HEX, chainName: qie.name, nativeCurrency: qie.nativeCurrency, rpcUrls: [RPC_URL], blockExplorerUrls: EXPLORER ? [EXPLORER] : undefined }],
      });
    }
    setChainId(CHAIN_HEX);
  }, [picked]);

  const connect = useCallback(async () => {
    const p = picked?.provider;
    if (!p) throw new Error("No wallet found. Install QIE Wallet.");
    const a = (await p.request({ method: "eth_requestAccounts" })) as string[];
    localStorage.removeItem(FORGET_KEY);
    setAccount((a[0] as Address) ?? null);
    await ensureChain();
  }, [picked, ensureChain]);

  const disconnect = useCallback(() => {
    localStorage.setItem(FORGET_KEY, "1");
    setAccount(null);
  }, []);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const write = useCallback<WalletState["write"]>(
    async (label, call) => {
      const p = picked?.provider;
      if (!p || !account) throw new Error("Connect your wallet first.");
      const id = Date.now() + Math.random();
      const set = (patch: Partial<Toast>) => setToasts((t) => t.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      setToasts((t) => [...t.slice(-3), { id, label, status: "pending" }]);
      try {
        await ensureChain();
        // Simulate first: a revert shows its reason instead of a failed transaction.
        const { request } = await publicClient.simulateContract({ ...call, account } as never);
        const wallet = createWalletClient({ chain: qie, transport: custom(p), account });
        const hash = await wallet.writeContract(request as never);
        set({ hash });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("The transaction reverted.");
        set({ status: "confirmed" });
        setTimeout(() => dismiss(id), 8000);
        return hash;
      } catch (e) {
        set({ status: "failed", error: explain(e) });
        throw e;
      }
    },
    [picked, account, ensureChain, dismiss],
  );

  const value = useMemo<WalletState>(
    () => ({
      available: !!picked,
      walletName: picked?.name ?? null,
      account,
      chainOk: chainId === CHAIN_HEX,
      connect,
      disconnect,
      write,
      toasts,
      dismiss,
    }),
    [picked, account, chainId, connect, disconnect, write, toasts, dismiss],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}
