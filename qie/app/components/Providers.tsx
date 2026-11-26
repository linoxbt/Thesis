"use client";

import type { ReactNode } from "react";
import { DataProvider } from "@/lib/data";
import { WalletProvider } from "@/lib/wallet";
import { TxToasts } from "./TxToasts";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <DataProvider>
        {children}
        <TxToasts />
      </DataProvider>
    </WalletProvider>
  );
}
