"use client";

import "@/lib/client/polyfills";
import "@/lib/client/wallet-adapter.css";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { useEffect, type ReactNode } from "react";
import { RPC_URL } from "@/lib/client/config";
import { TxProvider } from "@/lib/client/tx";
import { BurnerProvider } from "@/lib/client/wallet";

/**
 * Wallets: any Wallet Standard wallet (Phantom, Solflare, Backpack...) is
 * detected automatically, so the adapter list is empty. On devnet a burner
 * wallet is offered as well.
 */
export function Providers({ children }: { children: ReactNode }) {
  // A background refresh (balances, quotes) that rejects must not surface as an
  // uncaught error; user actions report their own failures in a toast.
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      console.warn("[thesis] background request failed:", e.reason);
      e.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);
  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <BurnerProvider>
            <TxProvider>{children}</TxProvider>
          </BurnerProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
