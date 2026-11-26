import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Leaderboard", description: "Traders ranked by onchain skill: hits beyond the odds they opened at." };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
