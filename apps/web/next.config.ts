import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript sources.
  transpilePackages: ["@thesis/chain", "@thesis/db"],
  serverExternalPackages: ["pg"],
  // Anchor's browser bundle references fs (only for its Node wallet).
  turbopack: { resolveAlias: { fs: { browser: "./lib/empty.js" } } },
};

export default config;
