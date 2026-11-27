// Bundles the Netlify functions exactly as they ship (one CommonJS file each,
// wasm and fonts inlined), for the deploy script and the function tests.
//
//   import { bundleFunctions } from "./bundle-functions.mjs";
//   const { dir, files } = await bundleFunctions({ callsAddress, site });
//
// The share function gets the contract address and site URL fixed at bundle
// time; qie-pass reads its settings from the environment at run time.
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

export const FUNCTIONS = ["qie-pass", "share"];

export async function bundleFunctions({ callsAddress, site = "https://thesis-qie.netlify.app", outDir } = {}) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(callsAddress ?? "")) throw new Error(`bundleFunctions: bad contract address ${callsAddress}`);
  const dir = outDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "qie-fn-"));
  const defines = {
    "qie-pass": {},
    share: { "process.env.THESIS_CALLS": JSON.stringify(callsAddress), "process.env.THESIS_SITE": JSON.stringify(site) },
  };
  const files = {};
  for (const name of FUNCTIONS) {
    const outfile = path.join(dir, `${name}.js`);
    await build({
      entryPoints: [path.join(root, `netlify/functions/${name}.mjs`)],
      bundle: true,
      platform: "node",
      target: "node20",
      format: "cjs",
      loader: { ".wasm": "binary", ".woff": "binary" },
      define: defines[name],
      outfile,
      logLevel: "warning",
    });
    files[name] = outfile;
  }
  return { dir, files };
}
