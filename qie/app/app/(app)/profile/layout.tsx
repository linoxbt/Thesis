import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Profile", description: "Your calls, positions, skill and earnings on Thesis." };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
