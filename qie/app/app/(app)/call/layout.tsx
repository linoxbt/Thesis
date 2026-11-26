import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Trade", description: "A trading call on Thesis." };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
