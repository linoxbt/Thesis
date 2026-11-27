import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { FeedsTable, ParamsTable } from "@/components/docs/LiveTables";
import { SiteNav } from "@/components/landing/SiteNav";
import { CALLS_ADDRESS, EXPLORER, QUSDC_URL } from "@/lib/config";

export const metadata: Metadata = {
  title: "Docs",
  description: "How Thesis works: posting calls, onchain odds, trading, settlement by the QIE Oracle, refunds and voids, skill scores, QIE Pass sign-in, and the contract reference.",
};

const CONTRACT = `${EXPLORER}/address/${CALLS_ADDRESS}#code`;
const REPO = "https://github.com/linoxbt/Thesis";

const TOC: [string, string][] = [
  ["overview", "Overview"],
  ["quick-start", "Quick start"],
  ["calls", "Calls"],
  ["odds", "Opening odds"],
  ["trading", "Backing and challenging"],
  ["settlement", "Settlement"],
  ["refunds", "Refunds and voids"],
  ["skill", "Skill and the leaderboard"],
  ["earnings", "Creator earnings"],
  ["accounts", "Sign-in, wallets and QIE ID"],
  ["sharing", "Sharing"],
  ["reference", "Contract reference"],
  ["trust", "Security and trust"],
  ["faq", "FAQ"],
];

function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="mt-16 scroll-mt-28 border-t border-line pt-10 font-display text-[28px] font-semibold leading-tight tracking-[-0.035em] first:mt-0 first:border-0 first:pt-0 sm:text-[32px]">
      <a href={`#${id}`} className="hover:underline decoration-line-2 underline-offset-8">
        {children}
      </a>
    </h2>
  );
}
const H3 = ({ children }: { children: ReactNode }) => <h3 className="mt-8 font-display text-lg font-semibold tracking-[-0.02em]">{children}</h3>;
const P = ({ children }: { children: ReactNode }) => <p className="mt-4 text-[15.5px] leading-[1.75] text-muted">{children}</p>;
const Strong = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-ink">{children}</strong>;
const C = ({ children }: { children: ReactNode }) => <code className="num rounded bg-panel-3 px-1.5 py-0.5 text-[13px] text-ink">{children}</code>;
const UL = ({ children }: { children: ReactNode }) => <ul className="mt-4 list-disc space-y-2 pl-5 text-[15.5px] leading-[1.7] text-muted marker:text-faint">{children}</ul>;
const OL = ({ children }: { children: ReactNode }) => <ol className="mt-4 list-decimal space-y-2 pl-5 text-[15.5px] leading-[1.7] text-muted marker:text-faint">{children}</ol>;

function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-6 rounded-2xl border border-line bg-panel px-5 py-4 text-[15px] leading-[1.7] text-muted">
      <div className="mb-1 text-sm font-semibold text-ink">{title}</div>
      {children}
    </div>
  );
}

function Pre({ children }: { children: string }) {
  return <pre className="num mt-5 overflow-x-auto rounded-2xl border border-line bg-[#0b0c0f] p-5 text-[13px] leading-relaxed text-[#e9e7e1]">{children}</pre>;
}

function Ref({ rows }: { rows: [string, string][] }) {
  return (
    <div className="mt-5 overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[520px] text-left text-sm">
        <tbody className="divide-y divide-line">
          {rows.map(([k, v]) => (
            <tr key={k} className="align-top">
              <td className="num w-[42%] px-4 py-2.5 text-[13px] text-ink">{k}</td>
              <td className="px-4 py-2.5 text-muted">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FAQ: [string, string][] = [
  ["Is this a perp exchange?", "No. You keep trading wherever you trade. Thesis is the layer on top: your call becomes a market on QIE, priced by the contract and settled by the QIE Oracle. Nothing is lent to you and nothing is liquidated: the stake you put in is the most you can lose."],
  ["Who decides whether a call hit?", "Nobody. The contract reads the QIE Oracle's rounds itself, in order. The first round inside the window at or past the target settles YES; if none does, NO wins once the oracle has printed past the deadline."],
  ["Can a quick wick count?", "Only if the oracle printed it. Settlement uses the QIE Oracle's published rounds (typically a few minutes apart, sometimes longer in quiet markets). A move that starts and ends between two rounds isn't seen, and the opening odds account for that."],
  ["What if I bet just before the price moves?", "If your bet was placed while the latest oracle round was the one just before the touching round, it's refunded in full, fee included. That's what stops anyone profiting from a move the oracle hasn't printed yet, and it costs an honest bettor nothing."],
  ["What happens if the oracle goes down?", "NO can only win after the oracle prints a price past the deadline. If that never happens within the void period (or the feed breaks), anyone can void the call and every stake is refunded."],
  ["Can the team take the money in a pot?", "No. Pot money can only go to winners or back to bettors. The owner can tune limits within hard bounds, pause new calls and bets (claims and settlement always work) and withdraw the treasury's share of fees, nothing else."],
  ["Why does my call need a target further away sometimes?", "When the latest oracle price is older, the market may have moved since. New calls then need a target at least z·σ·√age away, so nobody can post a call the market has already reached. It resets as soon as the oracle prints again."],
  ["Why is my skill score still empty?", "A call counts toward skill once it settles and others have bet enough on it (the scored-volume threshold below). A call only you traded proves nothing, so it doesn't move your score."],
  ["Is this real money?", "Yes. On QIE mainnet, seeds, bets and payouts are in QUSDC and gas is paid in QIE. Start small; this is not financial advice."],
];

export default function DocsPage() {
  return (
    <div className="font-sans">
      <SiteNav />
      <div className="mx-auto flex w-full max-w-[1160px] gap-12 px-5 pb-24 pt-32 lg:px-8">
        {/* Table of contents */}
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav className="sticky top-28 text-sm" aria-label="Docs contents">
            <div className="num mb-3 text-xs uppercase tracking-[0.12em] text-faint">Contents</div>
            <ul className="space-y-1.5">
              {TOC.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`} className="block rounded-md px-2 py-1 text-muted hover:bg-panel-2 hover:text-ink">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
            <Link href="/app/" className="btn btn-primary mt-6 w-full text-sm">
              Open the app
            </Link>
          </nav>
        </aside>

        <article className="min-w-0 max-w-[760px] flex-1" data-testid="docs">
          <span className="label">Documentation</span>
          <h1 className="mt-3 font-display text-[40px] font-semibold leading-[1.05] tracking-[-0.045em] sm:text-[52px]">Thesis docs</h1>
          <p className="mt-4 text-lg leading-relaxed text-muted">
            Everything about how Thesis works: from posting your first call to how the contract prices, settles and scores it.
          </p>

          <details className="mt-6 rounded-2xl border border-line bg-panel px-4 py-3 lg:hidden">
            <summary className="cursor-pointer text-sm font-medium text-ink">Contents</summary>
            <ul className="mt-3 space-y-1.5 text-sm">
              {TOC.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`} className="text-muted hover:text-ink">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </details>

          <div className="mt-12">
            <H2 id="overview">Overview</H2>
            <P>
              Thesis turns a trading call into a live market on the QIE blockchain. A trader posts a call: <Strong>BTC, ETH or SOL</Strong>,
              long or short, a take-profit price and a deadline. The contract prices it the moment it lands, from the QIE Oracle. The
              crowd backs it (YES) or challenges it (NO) with QUSDC. The QIE Oracle settles it, round by round, with no one in between.
              And every call is scored against the odds it opened at, so a trader&apos;s record shows real skill, not luck.
            </P>
            <UL>
              <li>
                <Strong>A call is a touch market.</Strong> It asks whether the price reaches the target at any point before the deadline,
                not only at the close. One oracle round at or past the target is enough.
              </li>
              <li>
                <Strong>Prices and odds are onchain.</Strong> The contract computes the opening odds itself; nobody picks them.
              </li>
              <li>
                <Strong>Settlement is trustless.</Strong> Anyone can trigger it, and the contract checks every oracle round itself.
              </li>
              <li>
                <Strong>The record can&apos;t be edited.</Strong> Hits, misses, the odds each call opened at and the skill score are stored by
                the contract.
              </li>
            </UL>

            <H2 id="quick-start">Quick start</H2>
            <OL>
              <li>
                <Strong>Sign in.</Strong> Use QIE Pass (your QIE ID, approved in QIE Wallet) or connect any wallet. See{" "}
                <a href="#accounts" className="text-ink underline decoration-brand underline-offset-4">
                  Sign-in
                </a>
                .
              </li>
              <li>
                <Strong>Get QUSDC and a little QIE.</Strong> Bets and seeds are in{" "}
                <a href={QUSDC_URL} target="_blank" rel="noreferrer" className="text-ink underline decoration-brand underline-offset-4">
                  QUSDC
                </a>
                ; gas is paid in QIE (a fraction of a cent per transaction).
              </li>
              <li>
                <Strong>Post a call</Strong> from <Link href="/new/" className="text-ink underline decoration-brand underline-offset-4">Post a trade</Link>: pick the asset and
                side, set the take profit and window, add a seed. The opening odds show before you sign.
              </li>
              <li>
                <Strong>Or trade one</Strong> from <Link href="/app/" className="text-ink underline decoration-brand underline-offset-4">Markets</Link>: back it with YES or
                challenge it with NO. The quote shows your payout before you sign.
              </li>
              <li>
                <Strong>Claim.</Strong> When the call settles, winners claim their share of the pot from the call page or their profile.
              </li>
            </OL>

            <H2 id="calls">Calls</H2>
            <P>A call has six parts, all fixed when it&apos;s posted:</P>
            <Ref
              rows={[
                ["Asset", "BTC, ETH or SOL, each priced by its QIE Oracle feed (USDT pairs)."],
                ["Direction", "Long: the call wins if the price touches the target at or above it. Short: at or below."],
                ["Take profit", "The target price. It must be on the right side of the latest oracle price, and far enough from it (see limits)."],
                ["Deadline", "When the window ends. Only oracle rounds published between posting and the deadline count."],
                ["Seed", "Your stake. It opens both sides of the pot at the opening odds, and pays out with whichever side wins."],
                ["Reason", "Optional text shown on the card, up to 280 bytes (emoji and accents take more than one)."],
              ]}
            />
            <H3>Limits</H3>
            <P>
              The contract refuses a call it can&apos;t price fairly. The target must be far enough from the latest oracle price (at least the
              minimum distance, and further when that price is older: <C>z·σ·√age</C>), the window must be inside the allowed range, the
              opening odds must be between the bounds, and the asset&apos;s volatility must have been updated recently. The post form checks
              all of this before you sign, using the same rules. The live values:
            </P>
            <ParamsTable />

            <H2 id="odds">Opening odds</H2>
            <P>
              The contract computes the probability that price touches the target before the deadline, with the reflection principle for a
              driftless random walk in log-price:
            </P>
            <Pre>{`P(touch) = 2 · Φ( −(|ln(K / S)| + β·σ·√Δt) / (σ · √τ) )

  S   latest QIE Oracle price          K   the target
  σ   the asset's annualised volatility (7-day realised, from oracle rounds)
  τ   time from that price's round to the deadline, in years
  Δt  typical gap between oracle rounds;  β = 0.5826 (Broadie–Glasserman–Kou)`}</Pre>
            <UL>
              <li>
                <Strong>Discrete monitoring.</Strong> Settlement only sees the oracle&apos;s rounds, not every tick, so a touch is a little
                less likely than the continuous formula says. The <C>β·σ·√Δt</C> term corrects for that.
              </li>
              <li>
                <Strong>Unseen time counts.</Strong> τ runs from the latest print, not from now: the market has been moving since then,
                unseen.
              </li>
              <li>
                <Strong>Fixed point.</Strong> Computed in 18-decimal fixed point (Solady math), with Φ via Abramowitz &amp; Stegun 7.1.26;
                results match a float reference to within one basis point.
              </li>
            </UL>
            <P>
              Your seed opens the pot at those odds: a 30% call seeded with 10 QUSDC starts with 3 QUSDC on YES and 7 on NO. The crowd
              moves the odds from there.
            </P>

            <H2 id="trading">Backing and challenging</H2>
            <P>
              Each call is a <Strong>pari-mutuel</Strong> market: every bet joins its side&apos;s pool, and when the call settles the winning
              side splits the whole pot in proportion to stake. The crowd odds shown on a call are simply the YES pool&apos;s share of the pot.
            </P>
            <UL>
              <li>
                <Strong>Quotes.</Strong> Before you sign, the contract&apos;s own <C>quote</C> shows what your bet would pay if its side won,
                at the pools as they are. Later bets on either side move it.
              </li>
              <li>
                <Strong>Fee.</Strong> Each bet pays a fee (fixed per call when it&apos;s posted): part to the call&apos;s creator, the rest to
                the treasury. The rest of the bet joins the pool.
              </li>
              <li>
                <Strong>When betting closes.</Strong> In the last part of the window (so nobody piles in once the outcome is all but known),
                while the latest oracle price is within the cutoff of the target, and when the oracle price is too old to trade on.
              </li>
              <li>
                <Strong>Before every bet</Strong> the contract checks every oracle round it hasn&apos;t checked yet. If one already touched
                the target, the call settles YES on the spot and your bet isn&apos;t taken (nothing leaves your wallet but gas).
              </li>
            </UL>

            <H2 id="settlement">Settlement</H2>
            <P>Calls settle from the QIE Oracle&apos;s published rounds, and only from them.</P>
            <OL>
              <li>
                <Strong>YES:</Strong> the <em>first</em> round published inside the window at or past the target. The contract scans rounds
                in order, so whichever round anyone points to, the first touching one decides. It settles at once.
              </li>
              <li>
                <Strong>NO:</Strong> after the deadline and a short grace period, once the contract has checked every round up to the
                deadline <em>and</em> the oracle has printed a round after it. An oracle outage can&apos;t hand NO a win.
              </li>
            </OL>
            <P>Anyone can trigger settlement, from the call page or directly on the contract:</P>
            <Ref
              rows={[
                ["sync(id, maxRounds)", "Checks up to maxRounds unchecked oracle rounds; a touch found settles YES. “Check the oracle” in the app."],
                ["proveTouch(id, roundId)", "Checks every unchecked round up to roundId, in order; settles on the first touching one."],
                ["settle(id)", "After deadline + grace: settles NO once every round to the deadline is checked and the oracle has printed past it."],
                ["voidCall(id)", "After the void period: settles the call if the oracle still can, otherwise voids it (see below)."],
                ["claim(id)", "Pays a settled call's winnings, or refunds, to the caller."],
              ]}
            />
            <P>
              A keeper runs these automatically: it proves touches as soon as they print, keeps open calls&apos; round checks caught up,
              settles calls after their deadline, and posts each feed&apos;s volatility. Outcomes never depend on it: anyone can do the
              same.
            </P>

            <H2 id="refunds">Refunds and voids</H2>
            <H3>Bets in the round before a touch</H3>
            <P>
              Every bet is tagged with the oracle round that was latest when it was placed. If the very next round is the one that touches
              the target, those bets could have been made on a move the oracle hadn&apos;t printed yet. They are <Strong>refunded in full,
              fee included</Strong>, instead of being paid. The fees of the latest round&apos;s bets stay in escrow until the next round
              passes without a touch.
            </P>
            <H3>Void calls</H3>
            <UL>
              <li>
                <Strong>Touched right after posting.</Strong> If the first oracle round after a call is posted (or a round within a minute of
                it) already touches the target, the call was posted into a move the oracle hadn&apos;t printed. It&apos;s void.
              </li>
              <li>
                <Strong>The oracle went silent.</Strong> If, by the void period after the deadline, the oracle has never printed past the
                deadline (or the feed has stopped working), anyone can void the call. A call the oracle can still settle is settled instead.
              </li>
            </UL>
            <P>
              In a void call every stake, including the creator&apos;s seed, is refunded (fees already credited are kept), and the call
              doesn&apos;t count toward anyone&apos;s skill.
            </P>

            <H2 id="skill">Skill and the leaderboard</H2>
            <P>Each scored call adds to its creator&apos;s onchain skill score:</P>
            <Pre>{`skill += (1 if the call hit, else 0) − opening odds

  a 20% call that hits      +0.80
  a 90% call that misses    −0.90
  a 50% call that hits      +0.50`}</Pre>
            <UL>
              <li>
                <Strong>Edge, not volume.</Strong> Safe calls earn almost nothing and random calls average zero, so only calling moves
                better than the market expected climbs the board. The odds are set by the contract, so nobody can choose favourable ones.
              </li>
              <li>
                <Strong>Only traded calls count.</Strong> A call scores once others have bet the scored-volume threshold on it (refunded bets
                excluded). A call nobody else traded cost its creator nothing, so it proves nothing.
              </li>
              <li>
                <Strong>Ranking.</Strong> The leaderboard ranks skill per scored call, once a creator has three; this week and all time.
              </li>
              <li>
                <Strong>Verified creators.</Strong> Creators whose identity is verified with QIE Pass carry a shield, and &quot;Verified
                only&quot; shows just them. Throwaway wallets can&apos;t be verified, so that view can&apos;t be gamed with them.
              </li>
            </UL>

            <H2 id="earnings">Creator earnings</H2>
            <P>
              Creators earn a share of the fee on every bet on their calls, whoever wins. Fees are credited once the bet&apos;s oracle round
              has passed without a touch (or the call settles), and you can withdraw them any time from your profile with{" "}
              <C>claimCreatorFees()</C>. Your seed also pays out with whichever side wins.
            </P>

            <H2 id="accounts">Sign-in, wallets and QIE ID</H2>
            <H3>QIE Pass</H3>
            <OL>
              <li>Choose QIE Pass and enter your QIE ID (for example, yourname.qie).</li>
              <li>The page shows a six-digit code, and QIE Wallet gets a sign-in request, on this device or another one.</li>
              <li>Check the code matches and approve it in QIE Wallet. You&apos;re signed in as your QIE ID, with a verified badge if QIE has verified your identity.</li>
            </OL>
            <P>
              Behind the scenes, the site&apos;s server asks QIE Pass to start the sign-in, collects the result once you approve, and checks
              your wallet&apos;s approval signature itself before opening a session. The first time you send a transaction, you connect the
              wallet that holds your QIE ID.
            </P>
            <H3>Wallets</H3>
            <P>
              &quot;Wallet&quot; opens the standard Reown picker: QIE Wallet first, then every wallet installed in your browser, plus
              hundreds more by QR code or on your phone. You sign a free sign-in message (no transaction).
            </P>
            <H3>QIE ID names</H3>
            <P>
              Addresses show as their QIE ID where they have one. Don&apos;t have one? &quot;Get a QIE ID&quot; opens QIE&apos;s own widget to
              mint a .qie name without leaving the app.
            </P>
            <Note title="What a session is for">
              Your session is for display: your name and badge. Nothing onchain trusts it. Every transaction is signed by your own wallet,
              and Thesis never holds your funds or keys.
            </Note>

            <H2 id="sharing">Sharing</H2>
            <P>
              &quot;Share on X&quot; on a call creates its card: the position, entry, take profit, deadline and the crowd&apos;s odds. On a
              phone the card is attached to the post; on desktop the shared link unfurls into the same card, and you can download it too.
            </P>

            <H2 id="reference">Contract reference</H2>
            <Ref
              rows={[
                ["Network", "QIE Blockchain mainnet (EVM, chain ID 1990)"],
                ["ThesisCalls", CALLS_ADDRESS],
                ["Stake token", "QUSDC (6 decimals)"],
                ["Source", "Verified on the QIE explorer; Solidity 0.8.24"],
              ]}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <a href={CONTRACT} target="_blank" rel="noreferrer" className="btn btn-ghost text-sm">
                Verified source <ArrowUpRight size={14} />
              </a>
              <a href={REPO} target="_blank" rel="noreferrer" className="btn btn-ghost text-sm">
                GitHub <ArrowUpRight size={14} />
              </a>
            </div>
            <H3>Oracle feeds</H3>
            <FeedsTable />
            <H3>Writes</H3>
            <Ref
              rows={[
                ["createCall(feed, above, strike, end, seed, text)", "Posts a call; prices it and seeds both pools. Needs a QUSDC allowance."],
                ["bet(id, yes, amount)", "Backs (yes) or challenges a call. Takes the fee; the rest joins the pool."],
                ["sync(id, maxRounds)", "Checks unchecked oracle rounds; settles YES on a touch."],
                ["proveTouch(id, roundId)", "Checks rounds up to roundId in order; settles on the first touch."],
                ["settle(id)", "Settles NO after the deadline, grace and a print past the deadline."],
                ["voidCall(id)", "After the void period: settles if possible, otherwise voids."],
                ["claim(id)", "Pays winnings or refunds."],
                ["claimCreatorFees()", "Withdraws your creator fees."],
              ]}
            />
            <H3>Reads</H3>
            <Ref
              rows={[
                ["getCall(id) / getCalls(from, count)", "A call's full state: pools, odds, times, outcome."],
                ["previewOpenBps(feed, above, strike, end)", "The opening odds a call would get now (reverts like createCall)."],
                ["quote(id, yes, amount)", "A bet's net stake and payout if its side won, at current pools."],
                ["position(id, user) / claimable(id, user)", "A wallet's stakes, payouts if each side wins, and what it can claim."],
                ["betStatus(id)", "Whether a call takes bets now, and why not."],
                ["minDistanceNow(feed)", "The least target distance a new call needs right now."],
                ["stats(creator) / getCreators(from, count)", "Calls posted, hits, misses, skill and scored calls."],
              ]}
            />
            <H3>Events</H3>
            <P>
              <C>CallCreated</C>, <C>Bet</C>, <C>Touched</C>, <C>Settled</C>, <C>Voided</C>, <C>Synced</C>, <C>Claimed</C>,{" "}
              <C>CreatorFeesClaimed</C>, plus admin events (<C>ParamsSet</C>, <C>FeedSet</C>, <C>VolatilitySet</C>, <C>PausedSet</C>, …).
              The app reads its whole history from these events: there&apos;s no indexer or database.
            </P>

            <H2 id="trust">Security and trust</H2>
            <H3>What you trust</H3>
            <UL>
              <li>
                <Strong>The QIE Oracle</Strong> for prices. Settlement uses its published rounds and nothing else.
              </li>
              <li>
                <Strong>The contract</Strong>, whose source is verified on the explorer. Pot money can only go to winners or back to bettors.
              </li>
              <li>
                <Strong>The owner&apos;s limited powers:</Strong> tuning limits within hard bounds (a call&apos;s fee and timings are fixed when
                it&apos;s posted), pausing new calls and bets (claims and settlement always work), managing feeds and volatility, and
                withdrawing the treasury&apos;s share of fees.
              </li>
            </UL>
            <H3>How it&apos;s checked</H3>
            <UL>
              <li>
                The contract is covered by unit tests, including the attack scenarios from its audits (betting on a stale price, proving a
                later round, sniping before the deadline, oracle outages, broken feeds) and an invariant fuzz test that payouts never exceed
                what the contract holds.
              </li>
              <li>A test on a fork of QIE mainnet runs a full cycle against the live oracle and real QUSDC.</li>
              <li>The sign-in service, the keeper and the app have their own test suites, run on every change.</li>
            </UL>
            <Note title="Limits worth knowing">
              Only oracle-printed prices count, so a move between two rounds can&apos;t settle a call. Betting closes before the deadline
              and pauses right at the target. Calls posted into an unprinted move are void. These are deliberate: they keep the market fair
              for everyone.
            </Note>

            <H2 id="faq">FAQ</H2>
            <div className="mt-6 divide-y divide-line rounded-2xl border border-line">
              {FAQ.map(([q, a]) => (
                <details key={q} className="group px-5 py-4">
                  <summary className="cursor-pointer list-none font-medium text-ink">
                    <span className="mr-2 inline-block text-faint transition-transform group-open:rotate-90">›</span>
                    {q}
                  </summary>
                  <p className="mt-2 pl-5 text-[15px] leading-[1.7] text-muted">{a}</p>
                </details>
              ))}
            </div>

            <div className="mt-16 rounded-3xl border border-line bg-panel p-8 text-center">
              <h2 className="font-display text-2xl font-semibold tracking-[-0.03em]">Prove you called it.</h2>
              <p className="mt-2 text-muted">Post a call, or back one you believe in.</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Link href="/new/" className="btn btn-primary">
                  Post a trade
                </Link>
                <Link href="/app/" className="btn btn-ghost">
                  Browse markets
                </Link>
              </div>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
