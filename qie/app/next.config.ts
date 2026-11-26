import type { NextConfig } from "next";

// A static site: every read and write goes straight from the browser to QIE.
const config: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default config;
