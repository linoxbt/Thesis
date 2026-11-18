"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import type { Transaction } from "@solana/web3.js";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { ActiveWallet } from "./wallet";

/** Every transaction shows pending, confirmed or failed, with an explorer link. */
export interface TxItem {
  id: number;
  label: string;
  status: "signing" | "pending" | "confirmed" | "failed";
  signature?: string;
  error?: string;
}

interface TxState {
  items: TxItem[];
  run(label: string, wallet: ActiveWallet, build: () => Promise<Transaction>): Promise<string>;
  dismiss(id: number): void;
}

const Ctx = createContext<TxState | null>(null);
let nextId = 1;

/** Turns program errors into a sentence a trader can act on. */
export function explainError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  // SendTransactionError keeps its logs on `logs`; our own errors attach them too.
  const err = e as { logs?: string[]; transactionLogs?: string[] } | null;
  const logs = err?.logs ?? err?.transactionLogs ?? [];
  const anchor = [...logs, msg].join("\n").match(/Error Message: ([^.\n]+)/);
  if (anchor) return anchor[1];
  if (/User rejected/i.test(msg)) return "You rejected the transaction in your wallet.";
  if (/insufficient (funds|lamports)|custom program error: 0x1\b/i.test([...logs, msg].join("\n"))) return "Not enough SOL or USDC in this wallet.";
  if (/SlippageExceeded|6007/.test(msg)) return "The price moved before your trade landed. Try again.";
  if (/blockhash/i.test(msg)) return "The network was slow and the transaction expired. Try again.";
  return msg.split("\n")[0].slice(0, 200);
}

export function TxProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const [items, setItems] = useState<TxItem[]>([]);
  const update = (id: number, patch: Partial<TxItem>) =>
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const run = useCallback(
    async (label: string, wallet: ActiveWallet, build: () => Promise<Transaction>) => {
      const id = nextId++;
      setItems((xs) => [{ id, label, status: "signing" as const }, ...xs].slice(0, 6));
      try {
        const tx = await build();
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.feePayer = wallet.publicKey;
        const signed = await wallet.signTransaction(tx);
        const signature = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 3 });
        update(id, { status: "pending", signature });
        const res = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
        if (res.value.err) {
          const t = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
          throw Object.assign(new Error(JSON.stringify(res.value.err)), { logs: t?.meta?.logMessages ?? [] });
        }
        update(id, { status: "confirmed" });
        return signature;
      } catch (e) {
        update(id, { status: "failed", error: explainError(e) });
        throw e;
      }
    },
    [connection],
  );

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  return <Ctx.Provider value={{ items, run, dismiss }}>{children}</Ctx.Provider>;
}

export function useTx(): TxState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTx outside TxProvider");
  return ctx;
}
