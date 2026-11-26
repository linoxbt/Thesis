import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Trade", description: "A trading call on QIE, priced by the contract and settled by the QIE Oracle." };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
