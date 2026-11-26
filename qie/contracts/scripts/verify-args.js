// Constructor arguments of the mainnet deployment (for `hardhat verify`).
const USDC = 1_000_000n;
module.exports = [
  "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
  "0x747DF176962e1495355562Fe30b65F276f0B8404",
  "0xA47CD56Bbd97203b76757B180f9736d259Da24fe",
  5000,
  {
    feeBps: 200, minSeed: 2n * USDC, maxSeed: 250n * USDC, minStake: 500_000n, minWindow: 1800, maxWindow: 691_200, grace: 300,
    maxOracleAge: 10_800, maxVolAge: 1_209_600, minDistanceBps: 100, maxDistanceBps: 5000, minOpenBps: 100, maxOpenBps: 9900, betCutoffBps: 25,
  },
];
