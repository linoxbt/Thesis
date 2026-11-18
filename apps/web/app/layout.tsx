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
  title: { default: "Thesis — calls, made tradable", template: "%s · Thesis" },
  description:
    "Post a trade call on SOL. The crowd backs it or challenges it on a live market, and protection pays out if price touches your level. Settled by a Pyth price anyone can prove.",
  applicationName: "Thesis",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f2ec" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0d10" },
  ],
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
