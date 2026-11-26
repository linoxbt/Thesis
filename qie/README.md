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
   Oracle and computes the opening odds onchain with the reflection
   principle, `P(touch) = 2·Φ(−|ln(K/S)| / σ√τ)` (fixed point, Solady math),
   with a discrete-monitoring correction (the oracle prints in rounds, not
   every tick). The window τ runs from the latest print, so the unseen time
   since then counts. The target must be at least 1% away from the latest
   price, and further the older that print is (z·σ·√age). The creator's seed
   opens the YES and NO pools at those odds.
2. **Back or challenge.** `bet(id, yes, amount)` in QUSDC. A 2% fee (fixed per
   call): half to the call's creator, half to the treasury. Winners split the
   whole pot. Betting closes in the last 10% of the window, and pauses while
   the target is within z·σ·√age of the latest print.
3. **Settle from the oracle.** The first QIE Oracle round inside the window
   at or past the target settles YES. The contract scans the rounds itself, in
   order, before every bet, proof and NO settlement, so nobody can bet after a
   touch or prove a later round instead of the first. Bets placed while the
   round just before the touching one was the latest are refunded in full (fee
   included): they could have been betting on a move the oracle hadn't printed
   yet. A call that touches in the first round after posting is void. NO wins
   only once the oracle has printed past the deadline. If it never does (or
   the feed breaks), `voidCall` refunds everyone after 3 days; it settles the
   call instead whenever the oracle can.
4. **Skill.** Each settled call that others traded (5 QUSDC of outside bets,
   refunds excluded) adds `(1 if hit, else 0) − opening odds` to the creator's
   onchain score. A 20% call that hits earns +0.80; a 90% call that misses
   costs −0.90; fair calls at random average zero. The leaderboard ranks skill
   per scored call once a creator has three.

Anyone can call `proveTouch`, `sync`, `settle` or `voidCall`; the keeper
(`contracts/scripts/keeper.js`) just makes it prompt.

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
| `contracts/test/` | 36 contract tests (incl. the audit's attack cases and an invariant fuzz), 9 keeper tests, and a test on a QIE mainnet fork against the live oracle |
| `contracts/scripts/deploy.js` | mainnet deploy (QUSDC + feeds) |
| `contracts/scripts/keeper.js` | proves touches, keeps calls synced, settles or voids, posts 7-day volatility and round gaps |
| `contracts/scripts/params.js` | launch parameters and measured feed settings |
| `contracts/scripts/dev-chain.js` | a local stand-in for QIE (mock feeds at live prices) |
| `app/` | the web app: static Next.js + viem, reads everything from chain |
| `app/netlify/functions/qie-pass.mjs` | QIE Pass sign-in (Sign in with QIE ID) and the wallet badge, server side |

## Run it

```bash
cd qie/contracts && npm ci && npx hardhat test test/ThesisCalls.test.js test/keeper.test.js   # 45 tests
FORK=1 npx hardhat test test/fork.test.js                # against the live QIE Oracle
QIE_DEPLOYER_KEY=0x… npx hardhat run scripts/deploy.js --network qieMainnet
KEEPER_KEY=0x… CALLS_ADDRESS=0x… node scripts/keeper.js

cd qie/app && NEXT_PUBLIC_CALLS_ADDRESS=0x… NEXT_PUBLIC_DEPLOY_BLOCK=… npm run build   # static site in out/ (+ hashed CSP)
npm test                                                     # QIE Pass function tests
node e2e/ui.e2e.cjs                                          # 33 browser checks (local chain)
```

## Trust and limits

- Settlement trusts the QIE Oracle's published rounds. Rounds are typically
  2 to 6 minutes apart and sometimes hours apart in quiet markets, so a move
  between two rounds can't count (the opening odds account for this).
- The QIE Pass session is for display (name, badge): every transaction is
  signed by the user's own wallet, and nothing trusts the session.
- The owner can tune limits within hard bounds, pause new calls and bets
  (claims and settlement always work), and withdraw the treasury's fees only.
  Pot money can only go to winners.
