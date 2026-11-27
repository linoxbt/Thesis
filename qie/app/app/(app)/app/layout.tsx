import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Markets", description: "Live trading calls on QIE: back or challenge them in QIE or QUSDC." };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
