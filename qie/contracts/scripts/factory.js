// Deploys ThesisCalls with its odds library linked: TouchMathLib first (a
// stateless library contract), then ThesisCalls pointing at it. Used by the
// deploy script, the local dev chain and the tests.
const LIB = "contracts/TouchMathLib.sol:TouchMathLib";

async function deployThesisCalls(ethers, args, { signer, libraryAddress } = {}) {
  let lib = libraryAddress;
  if (!lib) {
    const l = await (await ethers.getContractFactory("TouchMathLib", signer)).deploy();
    await l.waitForDeployment();
    lib = await l.getAddress();
  }
  const factory = await ethers.getContractFactory("ThesisCalls", { signer, libraries: { [LIB]: lib } });
  const calls = await factory.deploy(...args);
  await calls.waitForDeployment();
  return { calls, library: lib };
}

module.exports = { deployThesisCalls, LIB };
