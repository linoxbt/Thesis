import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/sora/400.css";
import "@fontsource/sora/500.css";
import "@fontsource/sora/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { Providers } from "@/components/Providers";
import { THEME_SCRIPT } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: { default: "Thesis on QIE — prove you called it", template: "%s · Thesis on QIE" },
  description:
    "Post a BTC, ETH or SOL call on QIE. The contract prices it the moment you post, the crowd backs or challenges it in QUSDC, the QIE Oracle settles it, and your skill score lives onchain.",
  applicationName: "Thesis on QIE",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f4f2ec" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <Script id="theme" strategy="beforeInteractive">
          {THEME_SCRIPT}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
