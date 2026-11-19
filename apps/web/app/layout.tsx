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
import { TxToasts } from "@/components/TxToasts";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? process.env.URL ?? "https://thesis-calls.netlify.app"),
  title: { default: "Thesis — prove you called it", template: "%s · Thesis" },
  description:
    "Post a SOL trade call. The crowd prices it the moment you post, a Pyth price anyone can submit settles it, and your record is scored against those odds onchain. Liquidation cover included.",
  applicationName: "Thesis",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4f2ec",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <Script id="theme" strategy="beforeInteractive">
          {THEME_SCRIPT}
        </Script>
        <Providers>
          {children}
          <TxToasts />
        </Providers>
      </body>
    </html>
  );
}
