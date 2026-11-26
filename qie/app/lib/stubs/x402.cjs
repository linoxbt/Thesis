// Stand-in for the optional @x402/* payment libraries that Reown AppKit's
// Coinbase dependency (@coinbase/cdp-sdk) can import. Thesis never uses x402
// payments, so they aren't installed; anything that does reach for them gets
// a clear error instead of a broken build.
const fail = () => {
  throw new Error("x402 payments are not available in this app");
};
module.exports = new Proxy(
  {},
  {
    get: (_, key) => (key === "__esModule" ? false : key === "default" ? module.exports : fail),
  },
);
