// Constructor arguments of the mainnet deployment (for `hardhat verify`).
const { LAUNCH_PARAMS, QUSDC } = require("./params");
const dep = require("../deployments/qieMainnet.json");
module.exports = [QUSDC, dep.treasury, dep.keeper, 5000, LAUNCH_PARAMS];
