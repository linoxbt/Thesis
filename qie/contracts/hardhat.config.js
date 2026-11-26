require("@nomicfoundation/hardhat-toolbox");

// Deployer key from the environment only (never committed): QIE_DEPLOYER_KEY=0x…
const accounts = process.env.QIE_DEPLOYER_KEY ? [process.env.QIE_DEPLOYER_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true } },
  // Source verification on the QIE explorers (Blockscout-style API; no key needed).
  etherscan: {
    apiKey: { qieMainnet: "none", qieTestnet: "none" },
    customChains: [
      { network: "qieMainnet", chainId: 1990, urls: { apiURL: "https://mainnet.qie.digital/api", browserURL: "https://mainnet.qie.digital" } },
      { network: "qieTestnet", chainId: 1983, urls: { apiURL: "https://testnet.qie.digital/api", browserURL: "https://testnet.qie.digital" } },
    ],
  },
  sourcify: { enabled: false },
  networks: {
    qieTestnet: { url: process.env.QIE_TESTNET_RPC ?? "https://rpc4testnet.qie.digital", chainId: 1983, accounts },
    qieMainnet: { url: process.env.QIE_MAINNET_RPC ?? "https://rpc1mainnet.qie.digital", chainId: 1990, accounts },
  },
};
