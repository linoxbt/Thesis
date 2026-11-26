"use client";

import type { ReactNode } from "react";
import { DataProvider } from "@/lib/data";
import { WalletProvider } from "@/lib/wallet";
import { QieIdWidget } from "./QieIdWidget";
import { SignInDialog } from "./SignIn";
import { TxToasts } from "./TxToasts";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <DataProvider>
        {children}
        <TxToasts />
        <SignInDialog />
        <QieIdWidget />
      </DataProvider>
    </WalletProvider>
  );
}
