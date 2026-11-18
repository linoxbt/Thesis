"use client";

import "@/lib/client/polyfills";
import "@solana/wallet-adapter-react-ui/styles.css";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import type { ReactNode } from "react";
import { RPC_URL } from "@/lib/client/config";
import { TxProvider } from "@/lib/client/tx";
import { BurnerProvider } from "@/lib/client/wallet";

/**
 * Wallets: any Wallet Standard wallet (Phantom, Solflare, Backpack...) is
 * detected automatically, so the adapter list is empty. On devnet a burner
 * wallet is offered as well.
 */
export function Providers({ children }: { children: ReactNode }) {
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
