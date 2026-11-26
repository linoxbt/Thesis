import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Traction", description: "Live onchain traction of Thesis on QIE." };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
