import type { NextConfig } from "next";

// Optional @x402/* payment libraries reachable from Reown AppKit's Coinbase
// dependency; Thesis doesn't use them, so they resolve to a stub (lib/stubs/x402.cjs).
const X402_STUB = {
    "@x402/core/client": "./lib/stubs/x402.cjs",
    "@x402/core/schemas": "./lib/stubs/x402.cjs",
    "@x402/core/server": "./lib/stubs/x402.cjs",
    "@x402/core/types": "./lib/stubs/x402.cjs",
    "@x402/evm": "./lib/stubs/x402.cjs",
    "@x402/evm/auth-capture/client": "./lib/stubs/x402.cjs",
    "@x402/evm/batch-settlement/client": "./lib/stubs/x402.cjs",
    "@x402/evm/exact/client": "./lib/stubs/x402.cjs",
    "@x402/evm/exact/server": "./lib/stubs/x402.cjs",
    "@x402/evm/exact/v1/client": "./lib/stubs/x402.cjs",
    "@x402/evm/upto/client": "./lib/stubs/x402.cjs",
    "@x402/evm/upto/server": "./lib/stubs/x402.cjs",
    "@x402/express": "./lib/stubs/x402.cjs",
    "@x402/extensions/bazaar": "./lib/stubs/x402.cjs",
    "@x402/extensions/builder-code": "./lib/stubs/x402.cjs",
    "@x402/fetch": "./lib/stubs/x402.cjs",
    "@x402/svm/exact/client": "./lib/stubs/x402.cjs",
    "@x402/svm/exact/server": "./lib/stubs/x402.cjs",
    "@x402/svm/exact/v1/client": "./lib/stubs/x402.cjs",
    "@x402/svm/upto/client": "./lib/stubs/x402.cjs",
    "@x402/svm/upto/server": "./lib/stubs/x402.cjs",
};

// A static site: every read and write goes straight from the browser to QIE.
const config: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  turbopack: { resolveAlias: X402_STUB },
};

export default config;
