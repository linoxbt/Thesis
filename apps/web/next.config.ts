import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript sources.
  transpilePackages: ["@thesis/chain", "@thesis/db"],
  serverExternalPackages: ["pg"],
};

export default config;
