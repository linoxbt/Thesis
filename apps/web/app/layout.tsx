import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { Providers } from "@/components/Providers";
import { TxToasts } from "@/components/TxToasts";

export const metadata: Metadata = {
  title: "Thesis — post your trade, the crowd bets on it",
  description: "Post your trade. The crowd bets on it. Your downside is covered by a price proof anyone can submit.",
};

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#0b0d10" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <Providers>
          <Header />
          <main className="mx-auto max-w-5xl px-4 pb-24 pt-4">{children}</main>
          <TxToasts />
        </Providers>
      </body>
    </html>
  );
}
