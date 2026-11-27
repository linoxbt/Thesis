// Constructor arguments of the mainnet deployment (for `hardhat verify`).
const { LAUNCH_PARAMS } = require("./params");
const dep = require("../deployments/qieMainnet.json");
module.exports = [dep.treasury, dep.keeper, 5000, LAUNCH_PARAMS];
