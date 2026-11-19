import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

/** The RPC origins the browser talks to (HTTP and its websocket twin). */
function rpcOrigins(): string[] {
  const out = ["https://*.solana.com", "wss://*.solana.com"];
  const url = process.env.NEXT_PUBLIC_RPC_URL;
  if (url) {
    try {
      const u = new URL(url);
      out.push(u.origin, `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}`);
      // web3.js opens its websocket on port + 1 for plain-http endpoints (local validator).
      if (u.port) out.push(`${u.protocol === "https:" ? "wss:" : "ws:"}//${u.hostname}:${Number(u.port) + 1}`);
    } catch {
      /* ignore a malformed value; the app will fail loudly elsewhere */
    }
  }
  return out;
}

// Next inlines its bootstrap and the theme script, hence 'unsafe-inline' for
// scripts; everything else is locked to this origin. Wallets are browser
// extensions (Wallet Standard), so no wallet iframes are needed.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${rpcOrigins().join(" ")}${dev ? " ws://localhost:*" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const config: NextConfig = {
  // Workspace packages ship TypeScript sources.
  transpilePackages: ["@thesis/chain", "@thesis/db"],
  serverExternalPackages: ["pg"],
  // Anchor's browser bundle references fs (only for its Node wallet).
  turbopack: { resolveAlias: { fs: { browser: "./lib/empty.js" } } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default config;
