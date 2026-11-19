# Demo script

Target: a 3-minute video for the submission, recorded on the live devnet app.
Everything shown is real and onchain; nothing is mocked.

**Before recording**
- Open https://thesis-calls.netlify.app in a clean browser profile (no
  instant wallet yet), desktop at 1280×800, light theme. Have a phone ready
  for the share-link shot.
- Check `/api/health` says `indexer: true` and the feed shows live calls.
- Have these tabs ready: the house call that was really touched (below), and
  its proof transaction on Solana Explorer.

## The real touch (the replay)

| | |
|---|---|
| Call | House call (Thesis team): SOL above **$74.51** |
| Trade page | https://thesis-calls.netlify.app/t/FkVWeyR4VMNQySEcbJCMfrmp5G4uX1vwQ1AT2ezsX92H |
| Touched | SOL printed **$74.60** on Pyth, Thu 19 Nov 2026 05:08 UTC |
| Proof tx | https://explorer.solana.com/tx/4C6UUJsg174gAe9ML98A8sPoihi5Ligp86i3Cr5UcsDa7xCrCyLQrMsV2jSysSDKYQUN451TVkfDUpjddBD7sBQz?cluster=devnet |
| Settles | after Fri 20 Nov 2026 20:54 UTC + 2 min grace, by the keeper; the treasury's position is redeemed in the same pass |

Record the settled state after Friday evening too: the page then reads
"Called it" and the share card says CALLED IT.

## Shot list

**0:00 — Hook (landing, 15 s).** "Every trader has a thesis. Thesis puts
yours onchain: the crowd bets on your take profit, and your liquidation gets
cover, settled by a price proof anyone can submit." Scroll once through the
landing; click **Launch app**.

**0:15 — The feed (20 s).** Cards read like perp positions: Long SOL 20x,
entry, take profit, liquidation, live odds. "Each card is two live markets on
pm-AMM: the take profit and the liquidation."

**0:35 — One tap to trade (30 s).** Click **Try it free**: an instant wallet
funds itself with test USDC and SOL. On a card, **Back** $5: point at the exact
quote (simulated against the real program: payout, average price, price
impact, the 2% fee). Confirm; the toast links the transaction.

**1:05 — Post a trade (40 s).** **Post a trade** → Long, 20x, take profit +3%,
protection on, $2 of cover, a one-line reason. "Opening odds are computed
onchain from distance, time and volatility." **Post trade**: the tracker walks
through the conviction market, the protection market, the thesis, the cover.
Then the share card: click **Share on X** to show the image that goes with
the post.

**1:45 — The trade page (25 s).** Conviction and protection panels with odds
charts; the Sell tab (sell back part of the cover); "Saw the touch? Prove it":
anyone can resolve it, no admin.

**2:10 — The replay (30 s).** Open the real touched call. "SOL printed $74.60
on Pyth at 05:08 UTC. Our watcher saw it and submitted the signed price; the
program checked feed, confidence and time window and marked it touched." Show
the proof transaction on Explorer. "At the deadline it settles YES; YES pays
$1, and the creator's record gets a hit."

**2:40 — Profile and stats (15 s).** Profile: open positions read onchain,
hit/miss record, fees earned, Telegram alerts. Stats: wallets, volume, touches
proven.

**2:55 — Close (5 s).** "Thesis: post your trade, the crowd bets on it, your
downside is covered by a proof anyone can submit." Show the URL.

## Talking points (for Q&A or the write-up)

- **Why pm-AMM:** liquidity is guaranteed from the first trade (the seed), and
  its time-decaying pool suits touch markets that end on a deadline.
- **Resolution is permissionless:** `prove_touch` accepts any fully verified
  Pyth SOL/USD print inside the window; `settle` needs no signer of ours.
- **Protection is a price-touch cover, not a liquidation guarantee:** it pays
  if SOL touches the level before the deadline, at window end.
- **Creators earn:** half of the treasury's share of fees on trades through
  their thesis (a quarter of the 2% fee), claimable onchain.
- **Honest limits (devnet):** proofs come from Pyth's onchain account, which
  updates about every 30 minutes on devnet, so a wick between prints can't be
  proven. On mainnet that account updates every few seconds.
