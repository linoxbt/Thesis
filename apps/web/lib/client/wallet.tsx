"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { IS_DEVNET } from "./config";

/** What every screen needs from a wallet, burner or real. */
export interface ActiveWallet {
  publicKey: PublicKey;
  kind: "burner" | "adapter";
  signTransaction(tx: Transaction): Promise<Transaction>;
}

const KEY = "thesis-burner-v1";

interface BurnerState {
  burner: Keypair | null;
  funding: "idle" | "funding" | "funded" | "error";
  fundError?: string;
  createBurner(): Promise<void>;
  refund(): Promise<void>;
  forget(): void;
}

const BurnerCtx = createContext<BurnerState | null>(null);

async function requestFaucet(wallet: PublicKey): Promise<void> {
  const r = await fetch("/api/faucet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: wallet.toBase58() }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `faucet returned ${r.status}`);
}

/**
 * Devnet burner wallet: a keypair kept in this browser's localStorage and
 * funded by the faucet, so a judge can trade in one tap without installing
 * anything. Never offered on mainnet.
 */
export function BurnerProvider({ children }: { children: ReactNode }) {
  const [burner, setBurner] = useState<Keypair | null>(null);
  const [funding, setFunding] = useState<BurnerState["funding"]>("idle");
  const [fundError, setFundError] = useState<string>();

  useEffect(() => {
    if (!IS_DEVNET) return;
    const raw = localStorage.getItem(KEY);
    if (raw) setBurner(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))));
  }, []);

  const fund = useCallback(async (kp: Keypair) => {
    setFunding("funding");
    setFundError(undefined);
    try {
      await requestFaucet(kp.publicKey);
      setFunding("funded");
    } catch (e) {
      setFunding("error");
      setFundError((e as Error).message);
    }
  }, []);

  const createBurner = useCallback(async () => {
    if (!IS_DEVNET) return;
    const kp = Keypair.generate();
    localStorage.setItem(KEY, JSON.stringify(Array.from(kp.secretKey)));
    setBurner(kp);
    await fund(kp);
  }, [fund]);

  const refund = useCallback(async () => {
    if (burner) await fund(burner);
  }, [burner, fund]);

  const forget = useCallback(() => {
    localStorage.removeItem(KEY);
    setBurner(null);
    setFunding("idle");
  }, []);

  const value = useMemo(
    () => ({ burner, funding, fundError, createBurner, refund, forget }),
    [burner, funding, fundError, createBurner, refund, forget],
  );
  return <BurnerCtx.Provider value={value}>{children}</BurnerCtx.Provider>;
}

export function useBurner(): BurnerState {
  const ctx = useContext(BurnerCtx);
  if (!ctx) throw new Error("useBurner outside BurnerProvider");
  return ctx;
}

/** The connected wallet: a real wallet if one is connected, else the burner. */
export function useActiveWallet(): ActiveWallet | null {
  const adapter = useWallet();
  const { burner } = useBurner();
  return useMemo(() => {
    if (adapter.publicKey && adapter.signTransaction) {
      const sign = adapter.signTransaction;
      return { publicKey: adapter.publicKey, kind: "adapter", signTransaction: (tx) => sign(tx) };
    }
    if (burner) {
      return {
        publicKey: burner.publicKey,
        kind: "burner",
        signTransaction: async (tx) => {
          tx.partialSign(burner);
          return tx;
        },
      };
    }
    return null;
  }, [adapter.publicKey, adapter.signTransaction, burner]);
}

export { useConnection };
