# QIE Hackathon 3.0 submission: Thesis on QIE

Deadline: **30 November 2026, 23:59 CET** (demos Dec 1–5).

## Form fields

| Field | Value |
|---|---|
| Project | Thesis on QIE: prove you called it |
| Track | **Consumer Apps & Social** (creator reputation, creator earnings, community calls) |
| GitHub | https://github.com/linoxbt/Thesis (QIE edition in `qie/`; README: `qie/README.md`) |
| Live demo | https://thesis-qie.netlify.app |
| Contract (QIE mainnet, verified) | `0xd9047bd3613ee9202659711bC4Cd26866660Ff84` — https://mainnet.qie.digital/address/0xd9047bd3613ee9202659711bC4Cd26866660Ff84#code |

## QIE components (bonus scoring)

- **QIE Blockchain:** the `ThesisCalls` contract on mainnet (chain 1990).
- **QIE Oracle:** BTC, ETH and SOL feeds price every call, verify touches round by round (`getRoundData`), and supply 7-day volatility.
- **QIE (native coin):** a stake option for every call: seeds, bets, payouts and fees in QIE, sent with the transaction (no approval step).
- **QIE Stable Coin (QUSDC):** the other stake option: seeds, bets, payouts and fees in QUSDC.
- **QIE Wallet:** detected via EIP-6963 (`me.qiewallet`), network switch, signing.

## One-paragraph pitch

Anyone can claim they called the move. Thesis makes callers prove it. Post a
call ("SOL touches $73.10 by Saturday") and the contract prices it from the
QIE Oracle the moment it lands; the crowd backs it or challenges it in QIE or
QUSDC, whichever the caller chose;
the oracle settles it, with no admin and no one racing to submit proofs. Every
result updates the caller's skill score onchain, measured against the odds the
call was given, so hitting a long shot counts and calling the obvious doesn't.
Callers earn half of every trade fee on their calls.

## 2-minute demo

1. **Home (15 s):** live QIE Oracle prices; live calls with crowd odds and pots.
2. **Post (30 s):** pick SOL, Long, +3%, 48h; the contract's own opening odds
   appear before signing ("55.7%… hit it and your skill gains 0.44"). Stake
   in QIE (one confirm) or QUSDC (approve, then post); share.
3. **Back / challenge (25 s):** on a call page, the oracle-round chart with
   entry and target lines; back it in the call's token; the quote; your position.
4. **Resolution (25 s):** "Check the oracle": the first round at or past the
   target settles YES; winners claim. The contract scans every round itself,
   in order, before bets, proofs and NO; bets placed in the round just before
   the touch are refunded, so the outcome can't be raced or missed.
5. **Leaderboard (15 s):** skill = hits beyond the odds, stored onchain.
6. **Verified contract (10 s):** the source on mainnet.qie.digital.

## Before submitting (owner)

- [ ] **Accept ownership of v5:** open the app with `0x747D…8404` → Profile →
      *Accept ownership* (the deployer stays owner until you do).
- [x] **Keeper:** runs on Railway (*thesis* → *qie-keeper*) with its own wallet
      `0x0055…52D4` (keeper role only; ~0.0087 QIE for gas, about 15 actions).
      It only works on calls that count toward skill or hold real outside
      money. Top it up when the Stats page shows its gas as low. To change it:
      set `KEEPER_KEY` on Railway, then `setKeeper(<address>)` as owner.
- [ ] **Rotate the QIE Pass secret key** (the old one was shared in a chat),
      then update `QIE_PASS_SECRET_KEY` on Netlify.
- [ ] **Pause the old contracts** from your owner wallet (`setPaused(true)`):
      v4 `0xf083…8b1C` (5 practice calls from the team wallet; they still
      settle and can be claimed after pausing), v3 `0xc534…7c85` (5 practice
      calls) and v1 `0x40fB…eF66` (no calls). v2 (`0x6945…2AEf`) is already
      paused; v5 replaced them all.
- [ ] **First calls on v5:** none yet (the deploy used the team's QIE). Post a
      few from your wallet and share them so others trade: traction is a
      judging criterion and decides the second half of the prize.
- [ ] Record the demo on the live site.
