# Thesis on QIE

**Prove you called it.** Post a call on BTC, ETH or SOL ("SOL touches $73.10
by Saturday"). The contract prices it the moment you post, the crowd backs it
(YES) or challenges it (NO) in **QUSDC**, and the **QIE Oracle** settles it.
Every result scores the caller's skill onchain: hitting a long shot counts for
more than calling the obvious.

This is the QIE edition of Thesis, a project first built on Solana
(`programs/`, `apps/web` in this repository). The QIE edition is a native
rebuild for QIE's EVM: new Solidity contracts, settlement by the QIE Oracle,
QUSDC stakes, QIE Wallet, and pari-mutuel pools in place of the Solana
version's AMM.

## How it works

1. **Post.** `createCall(feed, above, strike, end, seed, text)` reads the QIE
   Oracle, checks the target is at least 1% away from the latest price, and
   computes the opening odds onchain with the reflection principle:
   `P(touch) = 2·Φ(−|ln(K/S)| / σ√τ)` (fixed point, Solady math). The
   creator's seed opens the YES and NO pools at those odds.
2. **Back or challenge.** `bet(id, yes, amount)` in QUSDC. A 2% fee: half to
   the call's creator, half to the treasury. Winners split the whole pot.
3. **Settle from the oracle.** Any QIE Oracle round published inside the
   window at or past the target settles YES. The contract scans the rounds
   itself before every bet and before settling NO, so nobody can bet after a
   touch, and NO wins only once every round up to the deadline is checked.
   Anyone can call `proveTouch`, `sync` or `settle`; the keeper just makes it
   prompt.
4. **Skill.** Each settled call adds `(1 if hit, else 0) − opening odds` to
   the creator's onchain score. A 20% call that hits earns +0.80; a 90% call
   that misses costs −0.90; fair calls at random average zero.

## QIE components used

| Component | How |
|---|---|
| QIE Blockchain (EVM, chain 1990) | the `ThesisCalls` contract |
| QIE Oracle | BTC, ETH, SOL feeds: opening price, touch proofs (`getRoundData`), volatility |
| QIE Stable Coin (QUSDC) | seeds, bets, payouts, fees |
| QIE Wallet | EIP-6963 discovery (`me.qiewallet`), network switch, signing |

## Layout

| Path | What |
|---|---|
| `contracts/contracts/ThesisCalls.sol` | the market contract |
| `contracts/contracts/TouchMath.sol` | onchain opening odds |
| `contracts/test/` | 17 unit tests, plus a test on a QIE mainnet fork against the live oracle |
| `contracts/scripts/deploy.js` | mainnet deploy (QUSDC + feeds) |
| `contracts/scripts/keeper.js` | proves touches, settles, posts 7-day realised volatility |
| `contracts/scripts/dev-chain.js` | a local stand-in for QIE (mock feeds at live prices) |
| `app/` | the web app: static Next.js + viem, reads everything from chain |

## Run it

```bash
cd qie/contracts && npm ci && npx hardhat test          # 17 tests
FORK=1 npx hardhat test test/fork.test.js                # against the live QIE Oracle
QIE_DEPLOYER_KEY=0x… npx hardhat run scripts/deploy.js --network qieMainnet
KEEPER_KEY=0x… CALLS_ADDRESS=0x… node scripts/keeper.js

cd qie/app && NEXT_PUBLIC_CALLS_ADDRESS=0x… npx next build   # static site in out/
node e2e/ui.e2e.cjs                                         # 15 browser checks (local chain)
```

## Trust and limits

- Settlement trusts the QIE Oracle's published rounds. Rounds arrive minutes
  to an hour apart, so a move between two rounds can't count.
- The owner can tune limits within hard bounds, pause new calls and bets
  (claims and settlement always work), and withdraw the treasury's fees only.
  Pot money can only go to winners.
