"use client";

import type { ReactNode } from "react";
import { DataProvider } from "@/lib/data";
import { WalletProvider } from "@/lib/wallet";
import { Shell } from "./Shell";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <DataProvider>
        <Shell>{children}</Shell>
      </DataProvider>
    </WalletProvider>
  );
}
