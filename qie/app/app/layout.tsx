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
import type { ReactNode } from "react";
import { Providers } from "@/components/Providers";
import { THEME_SCRIPT } from "@/components/ThemeToggle";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://thesis-qie.netlify.app";
const DESCRIPTION =
  "Post a BTC, ETH or SOL call on QIE. The contract prices it the moment you post, the crowd backs or challenges it in QUSDC, the QIE Oracle settles it, and your skill score lives onchain.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Thesis on QIE — prove you called it", template: "%s · Thesis on QIE" },
  description: DESCRIPTION,
  applicationName: "Thesis on QIE",
  openGraph: {
    type: "website",
    siteName: "Thesis on QIE",
    title: "Thesis on QIE — prove you called it",
    description: DESCRIPTION,
    url: "/",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Thesis: prove you called it. Trading calls as markets on QIE." }],
  },
  twitter: { card: "summary_large_image", title: "Thesis on QIE — prove you called it", description: DESCRIPTION, images: ["/og.png"] },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f4f2ec" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* A plain inline script in the static HTML: runs before first paint, and
            scripts/csp.mjs hashes it (next/script would inject it at runtime,
            which a hash-based CSP blocks). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
