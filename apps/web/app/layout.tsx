import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/500.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/Header";
import { Providers } from "@/components/Providers";
import { TxToasts } from "@/components/TxToasts";

export const metadata: Metadata = {
  title: "Thesis — post your trade, the crowd bets on it",
  description: "Post your trade. The crowd bets on it. Your downside is covered by a price proof anyone can submit.",
};

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#08070e" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
          <TxToasts />
        </Providers>
      </body>
    </html>
  );
}
