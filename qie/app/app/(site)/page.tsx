import { ArrowRight, ArrowUpRight, BadgeCheck, Check, Coins, Gauge, Layers, Plus, Sigma, Timer, Trophy, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/Brand";
import { CodeTabs } from "@/components/landing/CodeTabs";
import { DotField } from "@/components/landing/DotField";
import { LiveLine } from "@/components/landing/LiveStats";
import { Reveal } from "@/components/landing/Reveal";
import { ProductWindow } from "@/components/landing/ProductWindow";
import { SiteNav } from "@/components/landing/SiteNav";
import { CALLS_ADDRESS, EXPLORER as EXPLORER_URL, NETWORK, QUSDC_URL } from "@/lib/config";

export const metadata: Metadata = {
  title: { absolute: "Thesis on QIE — prove you called it" },
};

const EXPLORER = `${EXPLORER_URL}/address/${CALLS_ADDRESS}#code`;

const STACK = ["QIE Blockchain", "QIE Oracle", "Native QIE stakes", "QUSDC stablecoin", "QIE Wallet", "Solidity 0.8.24", "Onchain opening odds", "Round-by-round settlement", "Verified contract"];

const CODE = [
  {
    label: "prove.ts",
    code: `import { THESIS_CALLS_ABI } from "./abi";

// Anyone can resolve a call. The contract verifies the oracle round itself.
await wallet.writeContract({
  address: THESIS_CALLS,         // ${CALLS_ADDRESS}
  abi: THESIS_CALLS_ABI,
  functionName: "proveTouch",
  args: [callId, roundId],       // checks every round up to it, in order
});

// Or let the contract scan every new round itself:
await wallet.writeContract({ address: THESIS_CALLS, abi: THESIS_CALLS_ABI, functionName: "sync", args: [callId, 0n] });`,
  },
  {
    label: "ThesisCalls.sol",
    code: `function proveTouch(uint256 id, uint80 roundId) external nonReentrant {
    Call storage c = _call(id);
    if (c.touched || c.settled) revert AlreadyFinal();
    if (block.timestamp > uint256(c.end) + c.grace) revert ProofTooLate();
    if (roundId <= c.checkedRound) revert RoundOutsideWindow();
    if (roundId - c.checkedRound > PROVE_SCAN_MAX) revert SyncRequired();
    _scan(id, c, roundId - c.checkedRound); // every round in order: the FIRST touch settles YES
    if (!c.settled) revert NoTouch();
}`,
  },
  {
    label: "checks (simplified)",
    code: `feed      == the call's QIE Oracle feed         // BTC, ETH or SOL / USDT
price     >  0                                  // a usable round
start <= updatedAt <= end                       // inside the window
first such round decides                        // rounds are scanned in order
crossed(price, strike, direction)               // at or past the target
// before every bet and before NO: every unchecked round is scanned`,
  },
];

const FAQ: [string, ReactNode][] = [
  ["What exactly is a thesis?", "Your trade call, made public and tradable. You post the position (long or short on BTC, ETH or SOL, a take profit and a deadline); Thesis turns it into a market the crowd backs or challenges in QIE or QUSDC (you pick which), and records the outcome against your profile."],
  ["Is this a perp exchange?", "No. You keep trading wherever you trade. Thesis is the layer on top: it prices your call with a prediction market on QIE and settles it from the QIE Oracle. Nothing is lent to you and there is no liquidation."],
  ["What is a touch market?", "A market that asks whether price reaches a level at any moment before the deadline, not only at the close. If a QIE Oracle round prints at or past your target once, the call resolves YES, even if price falls back later."],
  ["Who decides whether a call hit?", "Nobody decides. The contract reads the QIE Oracle's rounds itself: the first round inside the window at or past the target settles YES. Before every bet and before a NO settlement it scans every round it hasn't checked, so a touch can't be missed. Bets placed while the latest oracle price was the round just before the touching one are refunded in full (fee included) instead of paid, so nobody can profit from betting on a move the oracle hasn't printed yet. A keeper makes settlement prompt, but anyone can prove or settle."],
  [
    "How are the opening odds set?",
    <>
      The contract computes them onchain from the distance to the target, the time left and the asset&apos;s volatility, using
      the reflection-principle probability that price touches the level: <span className="num text-ink">P = 2Φ(−|ln(K/S)| / σ√τ)</span>,
      corrected for the oracle printing in rounds rather than every tick, and counting the time since its latest print. Your seed
      opens both sides of the pot at those odds.
    </>,
  ],
  [
    "How is the skill score calculated?",
    "Each settled call scores 1 if it hit, minus the probability the contract gave it when it was posted (so nobody can choose it). A 20% call that hits earns +0.80; a 90% call that misses costs −0.90. Posting safe or random calls averages zero, so the leaderboard only rewards real edge. Only calls others actually bet on count, and the leaderboard ranks skill per call once you have three. The score is stored onchain.",
  ],
  ["What do creators earn?", "Every bet currently pays a 2% fee: half to the creator of the call, half to the Thesis treasury. A call's fee is fixed when it's posted. Creators claim their share any time from their profile."],
  ["When does betting close?", "In the last 10% of the window (a 48h call closes about 4.8 hours before its deadline), so nobody can pile in once the outcome is all but known. Betting also pauses while the latest oracle price is within 0.25% of the target, or more than 3 hours old."],
  ["Can a quick wick be missed?", "Only between oracle rounds. Calls settle from the QIE Oracle's published rounds, typically 3 to 6 minutes apart and sometimes over an hour in quiet markets, so a wick that starts and ends between two rounds can't count. Every round that is published inside the window does, and the opening odds account for it."],
  ["What if the oracle stops?", "NO only wins once the oracle has printed a price after the deadline, so an outage can't hand NO a win. If no price comes within 3 days of the deadline (or the feed breaks), anyone can void the call and every stake is refunded. A call the oracle can still settle is never voided."],
  ["Is this real money?", `Yes, on QIE ${NETWORK === "mainnet" ? "mainnet" : NETWORK}: each call is staked in QIE or in QUSDC (QIE's stablecoin), its creator's choice, and seeds, bets and payouts are in that token. Gas is paid in QIE. Start small; this is a hackathon build and not financial advice.`],
];

function Container({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={"mx-auto w-full max-w-[1160px] scroll-mt-24 px-5 lg:px-8 " + className}>
      {children}
    </section>
  );
}

function H2({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={"font-display text-[34px] font-semibold leading-[1.08] tracking-[-0.04em] sm:text-[44px] " + className}>{children}</h2>;
}

export default function LandingPage() {
  return (
    <div className="font-display overflow-x-clip">
      <SiteNav />

      {/* Hero: the colour field */}
      <section className="relative overflow-hidden bg-field text-white">
        <DotField className="sweep pointer-events-none absolute -right-10 top-16 hidden h-[560px] w-auto md:block" />
        <div className="relative mx-auto max-w-[1160px] px-5 pb-16 pt-32 sm:pt-36 lg:px-8">
          <h1 className="rise text-[54px] font-semibold leading-[0.98] tracking-[-0.045em] sm:text-[76px] lg:text-[88px]">
            Prove you
            <br />
            called it.
          </h1>
          <p className="rise mt-7 max-w-[560px] text-[17px] font-medium leading-relaxed text-white/90" style={{ ["--d" as string]: "120ms" }}>
            Anyone can claim they called the move. On Thesis your call is a live market on QIE: the contract prices it the
            moment you post, the crowd backs or challenges it in QIE or QUSDC, the QIE Oracle settles it, and your record is
            scored against those odds onchain, for good.
          </p>
          <div className="rise mt-9 flex flex-wrap items-center gap-3" style={{ ["--d" as string]: "240ms" }}>
            <Link href="/app/" className="inline-flex items-center gap-1.5 rounded-lg bg-white px-5 py-3 text-[15px] font-medium text-black transition-colors hover:bg-white/90">
              Launch app <ArrowUpRight size={16} />
            </Link>
            <Link href="/leaderboard/" className="inline-flex items-center gap-2 rounded-lg bg-black/30 px-5 py-3 text-[15px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/40" data-testid="hero-leaderboard">
              <Trophy size={16} /> See the leaderboard
            </Link>
          </div>
        </div>
      </section>
      <div className="relative" style={{ background: "linear-gradient(var(--color-field) 0 58%, var(--color-bg) 58% 100%)" }}>
        <div className="rise mx-auto max-w-[1160px] px-5 lg:px-8" style={{ ["--d" as string]: "380ms" }}>
          <ProductWindow />
        </div>
      </div>

      {/* Stack strip */}
      <div className="mt-16 overflow-hidden border-y border-line py-4">
        <div className="marquee gap-12 pr-12">
          {[...STACK, ...STACK].map((s, i) => (
            <span key={i} className="num flex shrink-0 items-center gap-2 text-[13px] text-muted">
              <span className="h-1 w-1 rounded-full bg-brand" />
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* Settlement numbers */}
      <Container className="py-28 lg:py-32">
        <Reveal>
          <H2 className="text-center">Settled by math, not moderators</H2>
        </Reveal>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          <Reveal className="h-full">
          <StatCard chip="Oracle" big="Every round" icon={<Gauge size={44} strokeWidth={1.25} />}>
            The contract checks every QIE Oracle round inside the window, before each bet and before it settles NO.
          </StatCard>
          </Reveal>
          <Reveal className="h-full" delay={110}>
          <div className="lift relative flex h-full min-h-[380px] flex-col overflow-hidden rounded-3xl bg-field p-7 text-white">
            <DotField cell={8} seed={3} touchAt={0.6} className="pointer-events-none absolute -bottom-6 left-0 h-[260px] w-auto opacity-60" />
            <span className="num relative w-fit rounded-full bg-black/25 px-2.5 py-1 text-[11px] uppercase tracking-[0.08em]">Proof</span>
            <p className="relative mt-4 text-[19px] font-semibold leading-snug tracking-[-0.02em]">Every call resolves from one oracle round</p>
            <div className="relative mx-auto mt-8 grid grid-cols-3 gap-2.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className={"grid h-11 w-11 place-items-center rounded-xl " + (i < 5 ? "bg-white/90 text-field" : "bg-black/25 text-white")}>
                  {i < 5 ? <Check size={18} strokeWidth={2.6} /> : <LogoMark size={18} className="text-white" />}
                </span>
              ))}
            </div>
            <div className="relative mt-auto text-[56px] font-semibold leading-none tracking-[-0.04em]">0 admins</div>
          </div>
          </Reveal>
          <Reveal className="h-full" delay={220}>
          <StatCard chip="Grace" big="5 min" icon={<Timer size={44} strokeWidth={1.25} />}>
            A touch settles YES at once. After the deadline and a five-minute grace window, anyone can settle NO once the oracle
            prints past it; with no print in 3 days, the call is void and refunded.
          </StatCard>
          </Reveal>
        </div>
        <LiveLine />
      </Container>

      {/* Band: two markets */}
      <section id="markets" className="relative scroll-mt-24 overflow-hidden bg-field text-white">
        <DotField cell={8} seed={21} touchAt={0.8} className="pointer-events-none absolute -right-16 bottom-0 h-[380px] w-auto opacity-40" />
        <div className="relative mx-auto grid max-w-[1160px] items-center gap-12 px-5 py-24 lg:grid-cols-2 lg:px-8 lg:py-28">
          <Reveal>
            <H2>Every call is a market</H2>
            <p className="mt-5 max-w-md text-[17px] font-medium leading-relaxed text-white/90">
              Your take profit becomes a pot the crowd backs or challenges in QIE or QUSDC, opened at the odds the contract computes.
              The oracle settles it, your record keeps it, and you earn on every bet.
            </p>
            <Link href="/new/" className="mt-8 inline-flex items-center gap-1.5 rounded-lg bg-black px-5 py-3 text-[15px] font-medium text-white hover:bg-black/80">
              Post a trade <ArrowRight size={16} />
            </Link>
          </Reveal>
          <div className="relative h-[440px]">
            <MiniCard className="float left-0 top-0 -rotate-[8deg] sm:left-[2%]" title="Long SOL" tone="#3ecf8e" lines={[["entry", "$73.04"], ["take profit", "$76.69"], ["deadline", "48h"]]} />
            <MiniCard className="float left-[19%] top-[132px] -rotate-[8deg] [--d:-2s] sm:left-[26%]" title="Conviction · TP" tone="#ff6a3d" lines={[["SOL touches", "$76.69"], ["crowd YES", "64.0%"], ["pot", "1,840 QUSDC"]]} />
            <MiniCard className="float left-[38%] top-[264px] -rotate-[8deg] [--d:-4s] sm:left-[50%]" title="Your record" tone="#7aa2ff" lines={[["opened at", "40.4%"], ["skill if it hits", "+0.60"], ["fees earned", "18.40 QUSDC"]]} />
          </div>
        </div>
      </section>

      {/* How it works */}
      <Container id="how" className="py-28 lg:py-32">
        <Reveal className="text-center">
          <span className="chip">How it works</span>
          <H2 className="mt-5">From open position to settled market</H2>
          <p className="mx-auto mt-4 max-w-xl text-[17px] text-muted">Three steps, all onchain. Nothing to sign up for.</p>
        </Reveal>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          <Reveal className="h-full" delay={0}><StepCard n="01" title="Post your trade" body="Asset, side, take profit and deadline, plus a line on why. The market opens at fair odds the contract computes from QIE Oracle volatility.">
            <div className="grid grid-cols-2 gap-1 text-xs">
              <span className="rounded-lg bg-yes py-1.5 text-center font-semibold text-yes-ink">Long</span>
              <span className="rounded-lg border border-line py-1.5 text-center text-muted">Short</span>
            </div>
            <div className="num mt-2 grid grid-cols-3 gap-1 text-[11px] text-muted">
              <span className="rounded-lg border border-line px-2 py-1.5">SOL</span>
              <span className="rounded-lg border border-line px-2 py-1.5 text-yes">TP 76.69</span>
              <span className="rounded-lg border border-line px-2 py-1.5">48h</span>
            </div>
            <div className="num mt-2 text-xs text-muted">opening odds 40.4% · +5.0% to TP</div>
          </StepCard></Reveal>
          <Reveal className="h-full" delay={110}><StepCard n="02" title="The crowd prices it" body="Backers stake YES on your take profit, challengers stake NO, in QIE or QUSDC. The pot is the crowd's live probability, and you earn on every bet.">
            <div className="num flex justify-between text-xs">
              <span className="text-yes">YES 64%</span>
              <span className="text-muted">NO 36%</span>
            </div>
            <div className="mt-2 flex h-2 gap-1">
              <span className="w-[64%] rounded-full bg-yes-mark" />
              <span className="flex-1 rounded-full bg-panel-3" />
            </div>
            <svg viewBox="0 0 200 40" className="mt-3 h-10 w-full" aria-hidden="true">
              <path d="M0 32 L20 30 L40 31 L60 26 L80 27 L100 20 L120 22 L140 15 L160 16 L180 10 L200 8" fill="none" stroke="var(--color-yes-mark)" strokeWidth="2" />
            </svg>
          </StepCard></Reveal>
          <Reveal className="h-full" delay={220}><StepCard n="03" title="The oracle proves it" body="The first QIE Oracle round at your take profit inside the window settles it YES. The contract checks every round itself; anyone can trigger it.">
            <ul className="num space-y-1.5 text-xs">
              {["QIE Oracle round", "SOL / USDT feed", "every round checked", "inside window", "past the target"].map((k) => (
                <li key={k} className="flex items-center gap-2 text-muted">
                  <Check size={13} className="text-yes" /> {k}
                </li>
              ))}
            </ul>
          </StepCard></Reveal>
        </div>
      </Container>

      {/* Proof */}
      <div className="border-y border-line bg-panel">
        <Container id="proof" className="grid items-center gap-12 py-24 lg:grid-cols-[0.9fr_1.1fr] lg:py-28">
          <Reveal>
            <span className="chip">Permissionless</span>
            <H2 className="mt-5">Prove it yourself</H2>
            <p className="mt-4 max-w-md text-[17px] leading-relaxed text-muted">
              Resolution is one call anyone can send. No committee, no dispute window, no admin key: if the oracle round is
              inside the window and past the target, the call is touched.
            </p>
            <a href={EXPLORER} target="_blank" rel="noreferrer" className="mt-8 inline-flex items-center gap-1.5 rounded-lg border border-line-2 px-4 py-2.5 text-sm hover:bg-panel-2">
              Verified contract on QIE Explorer <ArrowUpRight size={14} />
            </a>
          </Reveal>
          <Reveal delay={120}>
            <CodeTabs tabs={CODE} />
          </Reveal>
        </Container>
      </div>

      {/* Bento */}
      <Container className="py-28 lg:py-32">
        <Reveal className="text-center">
          <H2>Built for traders who keep score</H2>
          <p className="mx-auto mt-4 max-w-xl text-[17px] text-muted">Start at a fair price, settle without trust, and let the record speak.</p>
        </Reveal>
        <Reveal delay={100} className="mt-14 grid gap-4 lg:grid-cols-3">
          <Bento className="lg:col-span-2" icon={<Layers size={18} />} title="One round is enough" tone="guard">
            A touch is a touch: the first QIE Oracle round at or past your target settles the call YES, whatever happens
            next. The contract scans every round, so nobody has to race to prove it, and bets placed in the oracle round just before a touch are
            refunded, so nobody can race the oracle either.
            <WickArt />
          </Bento>
          <Bento icon={<Sigma size={18} />} title="Fair from the first trade">
            Opening odds come from volatility, distance and time, computed by the contract.
            <div className="num rounded-xl border border-line bg-bg px-4 py-3 text-center text-sm text-ink">P = 2Φ(−|ln K/S| / σ√τ)</div>
          </Bento>
          <Bento icon={<BadgeCheck size={18} />} title="A record you can't delete">
            Hits, misses and the odds you opened at, built from onchain outcomes.
            <div className="flex gap-1.5">
              {[1, 1, 0, 1, 1, 0, 1, 1].map((h, i) => (
                <span key={i} className={"h-5 flex-1 rounded " + (h ? "bg-yes-mark" : "bg-panel-3")} />
              ))}
            </div>
          </Bento>
          <Bento icon={<Coins size={18} />} title="Get paid to be followed">
            Creators claim half of the fee (currently 2%) on every bet on their call.
            <div>
              <div className="flex h-2 gap-1">
                <span className="w-1/2 rounded-full bg-line-2" />
                <span className="w-1/2 rounded-full bg-brand" />
              </div>
              <div className="num mt-2 flex text-[11px] text-faint">
                <span className="w-1/2">treasury 1%</span>
                <span className="w-1/2 text-ink">you 1%</span>
              </div>
            </div>
          </Bento>
          <Bento icon={<Wallet size={18} />} title="QIE Wallet, one click">
            Connect QIE Wallet (or any browser wallet), switch to QIE in one tap, and trade in QIE or QUSDC. No sign-up.
            <Link href="/app/" className="inline-flex w-fit items-center gap-1 rounded-lg bg-ink px-3.5 py-2 text-sm font-medium text-bg">
              Launch app <ArrowRight size={14} />
            </Link>
          </Bento>
        </Reveal>
      </Container>

      {/* FAQ */}
      <Container id="faq" className="grid gap-12 pb-28 lg:grid-cols-[0.8fr_1.2fr] lg:pb-32">
        <Reveal>
          <span className="chip">FAQ</span>
          <H2 className="mt-5">Questions, answered</H2>
        </Reveal>
        <Reveal delay={100} className="divide-y divide-line border-y border-line">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-5">
              <summary className="flex items-center justify-between gap-6 text-[17px] font-medium tracking-[-0.01em]">
                {q}
                <Plus size={18} className="faq-plus shrink-0 text-faint transition-transform" />
              </summary>
              <div className="mt-3 max-w-xl font-sans leading-relaxed text-muted">{a}</div>
            </details>
          ))}
        </Reveal>
      </Container>

      {/* CTA */}
      <Container className="pb-24">
        <Reveal>
        <div className="relative overflow-hidden rounded-3xl bg-field px-6 py-20 text-center text-white sm:px-12">
          <DotField cell={8} seed={8} touchAt={0.7} className="pointer-events-none absolute -right-10 bottom-0 h-[300px] w-auto opacity-60" />
          <div className="relative">
            <H2 className="sm:text-[56px]">Take your call live.</H2>
            <p className="mx-auto mt-4 max-w-md text-[17px] font-medium text-white/90">A QIE wallet, some QIE or QUSDC, and a market in under a minute.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/app/" className="inline-flex items-center gap-1.5 rounded-lg bg-white px-5 py-3 text-[15px] font-medium text-black hover:bg-white/90">
                Launch app <ArrowUpRight size={16} />
              </Link>
              <a href={QUSDC_URL} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg bg-black/20 px-5 py-3 text-[15px] font-medium hover:bg-black/30">
                Get QUSDC
              </a>
            </div>
          </div>
        </div>
        </Reveal>
      </Container>

      {/* Footer */}
      <footer className="border-t border-line">
        <Container className="grid gap-10 py-14 md:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <Link href="/" className="flex items-center gap-2 text-ink">
              <LogoMark size={22} />
              <span className="text-[19px] font-semibold tracking-[-0.03em]">Thesis</span>
            </Link>
            <p className="mt-4 max-w-xs font-sans text-sm leading-relaxed text-muted">Trade calls as markets on QIE, settled by an oracle round anyone can prove.</p>
          </div>
          <FooterCol title="Product" links={[["Markets", "/app/"], ["Post a trade", "/new/"], ["Leaderboard", "/leaderboard/"], ["Traction", "/stats/"], ["Docs", "/docs/"]]} />
          <FooterCol title="Protocol" links={[["Thesis contract", EXPLORER], ["QIE Blockchain", "https://www.qie.digital"], ["QUSDC", QUSDC_URL]]} />
        </Container>
        <Container className="num flex flex-wrap justify-between gap-3 border-t border-line py-6 text-xs text-faint">
          <span>© 2026 Thesis</span>
          <span>QIE {NETWORK} · {NETWORK === "mainnet" ? "real QIE and QUSDC" : "test tokens only"} · not financial advice</span>
        </Container>
      </footer>
    </div>
  );
}

function StatCard({ chip, big, icon, children }: { chip: string; big: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="lift flex h-full min-h-[380px] flex-col items-center rounded-3xl border border-line bg-panel p-7 text-center">
      <span className="chip">{chip}</span>
      <div className="mt-5 text-[60px] font-semibold leading-none tracking-[-0.05em] text-ink">{big}</div>
      <div className="my-auto py-6">
        <div className="grid h-28 w-28 place-items-center rounded-full border border-line-2 bg-[radial-gradient(circle_at_30%_25%,var(--color-panel-3),var(--color-panel))] text-muted shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
          {icon}
        </div>
      </div>
      <p className="font-sans text-[15px] leading-relaxed text-muted">{children}</p>
    </div>
  );
}

function StepCard({ n, title, body, children }: { n: string; title: string; body: string; children: ReactNode }) {
  return (
    <div className="lift flex h-full flex-col rounded-3xl border border-line bg-panel p-7">
      <div className="flex h-[156px] flex-col justify-center rounded-2xl border border-line bg-bg p-5">{children}</div>
      <span className="num mt-7 text-xs text-faint">{n}</span>
      <h3 className="mt-2 text-xl font-semibold tracking-[-0.025em]">{title}</h3>
      <p className="mt-2 font-sans leading-relaxed text-muted">{body}</p>
    </div>
  );
}

function Bento({ className = "", icon, title, tone, children }: { className?: string; icon: ReactNode; title: string; tone?: "guard"; children: ReactNode }) {
  return (
    <div className={"lift flex flex-col rounded-3xl border border-line bg-panel p-7 " + className}>
      <div className={"grid h-10 w-10 place-items-center rounded-xl " + (tone === "guard" ? "bg-guard/10 text-guard" : "bg-panel-3 text-ink")}>{icon}</div>
      <h3 className="mt-6 text-xl font-semibold tracking-[-0.025em]">{title}</h3>
      <div className="mt-2 flex flex-1 flex-col justify-between gap-5 font-sans leading-relaxed text-muted">{children}</div>
    </div>
  );
}

function MiniCard({ className, title, tone, lines }: { className: string; title: string; tone: string; lines: [string, string][] }) {
  return (
    <div className={"absolute w-52 rounded-2xl border border-white/10 bg-[#09090b] p-4 text-white shadow-2xl sm:w-60 sm:p-5 " + className}>
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <span className="h-2 w-2 rounded-full" style={{ background: tone }} />
        {title}
      </div>
      <dl className="num mt-4 space-y-2 text-[12px]">
        {lines.map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <dt className="text-white/45">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** A wick through the take-profit line: the round that settles the call YES. */
function WickArt() {
  return (
    <svg viewBox="0 0 480 110" className="h-auto w-full rounded-xl border border-line bg-bg" aria-hidden="true">
      <line x1="0" x2="480" y1="36" y2="36" stroke="var(--color-guard-mark)" strokeWidth="1.25" strokeDasharray="4 4" />
      <text x="472" y="28" textAnchor="end" fontSize="11" fill="var(--color-guard)" className="num">
        take profit $76.69
      </text>
      <path d="M0 80 L40 74 L80 84 L120 70 L160 78 L200 66 L240 72 L280 60 L296 14 L312 62 L352 70 L392 80 L432 76 L480 84" fill="none" stroke="var(--color-ink)" strokeWidth="1.75" strokeLinejoin="round" />
      <circle cx="292" cy="36" r="5" fill="var(--color-guard-mark)" stroke="var(--color-bg)" strokeWidth="2" />
    </svg>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="num text-xs uppercase tracking-[0.12em] text-faint">{title}</div>
      <ul className="mt-4 space-y-2.5 font-sans text-sm">
        {links.map(([l, h]) => (
          <li key={l}>
            {h.startsWith("http") ? (
              <a href={h} target="_blank" rel="noreferrer" className="text-muted hover:text-ink">
                {l}
              </a>
            ) : (
              <Link href={h} className="text-muted hover:text-ink">
                {l}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
