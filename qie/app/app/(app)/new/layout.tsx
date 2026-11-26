import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Post a call", description: "Post a BTC, ETH or SOL call; the contract prices it from the QIE Oracle." };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
