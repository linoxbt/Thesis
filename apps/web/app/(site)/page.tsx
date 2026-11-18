import { ArrowRight, ArrowUpRight, BadgeCheck, Check, Coins, Gauge, Plus, Shield, Sigma, Timer, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/Brand";
import { CodeTabs } from "@/components/landing/CodeTabs";
import { DotField } from "@/components/landing/DotField";
import { LiveLine } from "@/components/landing/LiveStats";
import { ProductWindow } from "@/components/landing/ProductWindow";
import { SiteNav } from "@/components/landing/SiteNav";

export const metadata: Metadata = {
  title: { absolute: "Thesis — calls, made tradable" },
};

const PROGRAM_ID = "9yVcFaDEmBk1VU66tXxuvUujZXfiiT3ED1EpioVuug6h";
const EXPLORER = `https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet`;
const SITE = "https://thesis-calls.netlify.app";

const STACK = ["Solana", "Anchor 1.0", "Pyth pull oracle", "Wormhole-verified prices", "pm-AMM", "Onchain opening odds", "Permissionless proofs", "Postgres indexer"];

const CODE = [
  {
    label: "prove.ts",
    code: `import { SOL_USD_PRICE_ACCOUNT } from "@thesis/chain";

// Anyone can resolve a market. The program verifies the price itself.
const ix = await program.methods
  .proveTouch()
  .accountsPartial({
    prover: wallet.publicKey,
    config,                              // PDA ["config"]
    touchMarket,                         // the market to resolve
    priceUpdate: SOL_USD_PRICE_ACCOUNT,  // a verified Pyth PriceUpdateV2
  })
  .instruction();`,
  },
  {
    label: "curl",
    code: `# Ask Thesis to build the transaction; you sign and send it.
curl -X POST ${SITE}/api/prove/<market> \\
  -H 'content-type: application/json' \\
  -d '{"prover":"<your wallet>"}'

# 200 { provable: true, price, publishTime, transaction }
# 409 { reason }   no valid print has crossed the strike yet`,
  },
  {
    label: "checks (simplified)",
    code: `owner(price_update) == PYTH_RECEIVER          // a real Pyth account
verification_level  == Full                   // all guardian signatures
feed_id             == SOL_USD                // the right market
conf <= price * 0.5%                          // a tight print
market.start <= publish_time <= market.end    // inside the window
publish_time <= now + 15s                     // no prints from the future
crossed(price, strike, direction)             // at or past the line`,
  },
];

const FAQ: [string, ReactNode][] = [
  ["What exactly is a thesis?", "A public trade call with a market attached. You say where SOL is going and by when; Thesis turns that into a touch market the crowd can trade, and records the outcome against your profile."],
  ["What is a touch market?", "A market that asks whether price reaches a level at any moment before the deadline, not only at the close. If SOL prints at or past your strike once, the market resolves YES, even if price falls back later."],
  ["Who decides whether a call hit?", "Nobody decides. Resolution needs a signed Pyth price that passes the checks onchain. Our watcher submits proofs automatically, but the instruction is permissionless: anyone holding a valid price update can resolve the market."],
  [
    "How are the opening odds set?",
    <>
      The program computes them onchain from the distance to the strike, the time left and SOL&apos;s volatility, using the
      reflection-principle probability that price touches the level: <span className="num text-ink">P = 2Φ(−|ln(K/S)| / σ√τ)</span>.
    </>,
  ],
  ["What does protection do?", "It's a touch market on your liquidation level. Each protection share pays 1 USDC if SOL touches that level before the deadline, so you can hedge the wick that would stop you out."],
  ["What do creators earn?", "Every trade pays a 2% fee: half to the pm-AMM protocol, half to the Thesis treasury. The creator of the call can claim half of the treasury's share, a quarter of the whole fee, on every trade through their thesis."],
  ["Is this real money?", "Not yet. Thesis runs on Solana devnet with test USDC. One click creates an instant wallet that funds itself, so you can try every flow without installing anything."],
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
        <DotField className="pointer-events-none absolute -right-10 top-16 hidden h-[560px] w-auto md:block" />
        <div className="relative mx-auto max-w-[1160px] px-5 pb-16 pt-32 sm:pt-36 lg:px-8">
          <span className="num inline-flex items-center gap-2 rounded-lg bg-black/85 px-3 py-1.5 text-[11px] uppercase tracking-[0.08em] text-white/80">
            <span className="h-1.5 w-1.5 rounded-full bg-[#ff6a3d]" /> Live on Solana devnet
          </span>
          <h1 className="mt-7 text-[54px] font-semibold leading-[0.98] tracking-[-0.045em] sm:text-[76px] lg:text-[88px]">
            Calls, made
            <br />
            tradable.
          </h1>
          <p className="mt-7 max-w-[560px] text-[17px] font-medium leading-relaxed text-white/90">
            Post a SOL price call and it becomes a live market. The crowd backs it or challenges it, protection covers the
            wick, and a Pyth price anyone can submit settles it.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/app" className="inline-flex items-center gap-1.5 rounded-lg bg-white px-5 py-3 text-[15px] font-medium text-black transition-colors hover:bg-white/90">
              Launch app <ArrowUpRight size={16} />
            </Link>
            <Link href="/protect" className="inline-flex items-center gap-2 rounded-lg bg-black/20 px-5 py-3 text-[15px] font-medium text-white transition-colors hover:bg-black/30" data-testid="hero-protect">
              <Shield size={16} /> Protect a position
            </Link>
          </div>
        </div>
      </section>
      <div className="relative" style={{ background: "linear-gradient(var(--color-field) 0 58%, var(--color-bg) 58% 100%)" }}>
        <div className="mx-auto max-w-[1160px] px-5 lg:px-8">
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
        <H2 className="text-center">Settled by math, not moderators</H2>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          <StatCard chip="Confidence" big="≤0.5%" icon={<Gauge size={44} strokeWidth={1.25} />}>
            A Pyth print counts only if its confidence interval is within half a percent of the price.
          </StatCard>
          <div className="relative flex min-h-[380px] flex-col overflow-hidden rounded-3xl bg-field p-7 text-white">
            <DotField cell={8} seed={3} touchAt={0.6} className="pointer-events-none absolute -bottom-6 left-0 h-[260px] w-auto opacity-60" />
            <span className="num relative w-fit rounded-full bg-black/25 px-2.5 py-1 text-[11px] uppercase tracking-[0.08em]">Proof</span>
            <p className="relative mt-4 text-[19px] font-semibold leading-snug tracking-[-0.02em]">Every market resolves from one signed price</p>
            <div className="relative mx-auto mt-8 grid grid-cols-3 gap-2.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className={"grid h-11 w-11 place-items-center rounded-xl " + (i < 5 ? "bg-white/90 text-field" : "bg-black/25 text-white")}>
                  {i < 5 ? <Check size={18} strokeWidth={2.6} /> : <LogoMark size={18} className="text-white" />}
                </span>
              ))}
            </div>
            <div className="relative mt-auto text-[56px] font-semibold leading-none tracking-[-0.04em]">0 admins</div>
          </div>
          <StatCard chip="Grace" big="120s" icon={<Timer size={44} strokeWidth={1.25} />}>
            After a touch or the deadline, a two-minute grace window, then anyone can settle the market.
          </StatCard>
        </div>
        <LiveLine />
      </Container>

      {/* Band: two markets */}
      <section id="markets" className="relative scroll-mt-24 overflow-hidden bg-field text-white">
        <DotField cell={8} seed={21} touchAt={0.8} className="pointer-events-none absolute -right-16 bottom-0 h-[380px] w-auto opacity-40" />
        <div className="relative mx-auto grid max-w-[1160px] items-center gap-12 px-5 py-24 lg:grid-cols-2 lg:px-8 lg:py-28">
          <div>
            <H2>Every call is two markets</H2>
            <p className="mt-5 max-w-md text-[17px] font-medium leading-relaxed text-white/90">
              A conviction market for the crowd to back or challenge, and a protection market that pays if price touches the
              trader&apos;s liquidation level. Same AMM, same proof.
            </p>
            <Link href="/new" className="mt-8 inline-flex items-center gap-1.5 rounded-lg bg-black px-5 py-3 text-[15px] font-medium text-white hover:bg-black/80">
              Post a call <ArrowRight size={16} />
            </Link>
          </div>
          <div className="relative h-[440px]">
            <MiniCard className="left-0 top-0 -rotate-[8deg] sm:left-[2%]" title="Conviction" tone="#3ecf8e" lines={[["SOL ↑", "$260.00"], ["YES", "64.0%"], ["vol 24h", "$18,240"]]} />
            <MiniCard className="left-[19%] top-[132px] -rotate-[8deg] sm:left-[26%]" title="Protection" tone="#7aa2ff" lines={[["pays if SOL ↓", "$198.00"], ["YES", "12.1%"], ["cover bought", "$2,410"]]} />
            <MiniCard className="left-[38%] top-[264px] -rotate-[8deg] sm:left-[50%]" title="Touch proven" tone="#ff6a3d" lines={[["print", "$260.07"], ["confidence", "0.03%"], ["settles in", "02:00"]]} />
          </div>
        </div>
      </section>

      {/* How it works */}
      <Container id="how" className="py-28 lg:py-32">
        <div className="text-center">
          <span className="chip">How it works</span>
          <H2 className="mt-5">From hot take to settled market</H2>
          <p className="mx-auto mt-4 max-w-xl text-[17px] text-muted">Three steps, all onchain. Nothing to sign up for.</p>
        </div>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          <StepCard n="01" title="Post the call" body="Pick a level and a deadline and say why in a line. The market opens at fair odds computed onchain from volatility.">
            <div className="grid grid-cols-2 rounded-full bg-panel-3 p-1 text-xs">
              <span className="rounded-full bg-ink py-1.5 text-center text-bg">SOL goes up to…</span>
              <span className="py-1.5 text-center text-muted">down to…</span>
            </div>
            <div className="num mt-2 flex justify-between rounded-xl border border-line px-3 py-2 text-sm">
              260.00 <span className="text-faint">7d</span>
            </div>
            <div className="num mt-2 text-xs text-muted">opening odds 40.4%</div>
          </StepCard>
          <StepCard n="02" title="The crowd prices it" body="Backers buy YES, challengers buy NO. The price is the crowd's live probability, and you earn on every trade.">
            <div className="num flex justify-between text-xs">
              <span className="text-yes">YES 64¢</span>
              <span className="text-muted">NO 36¢</span>
            </div>
            <div className="mt-2 flex h-2 gap-1">
              <span className="w-[64%] rounded-full bg-yes-mark" />
              <span className="flex-1 rounded-full bg-panel-3" />
            </div>
            <svg viewBox="0 0 200 40" className="mt-3 h-10 w-full" aria-hidden="true">
              <path d="M0 32 L20 30 L40 31 L60 26 L80 27 L100 20 L120 22 L140 15 L160 16 L180 10 L200 8" fill="none" stroke="var(--color-yes-mark)" strokeWidth="2" />
            </svg>
          </StepCard>
          <StepCard n="03" title="Price proves it" body="The first verified Pyth print at or past the strike resolves the market. Anyone can submit it; our watcher usually does.">
            <ul className="num space-y-1.5 text-xs">
              {["signed update", "SOL/USD feed", "conf 0.03%", "inside window", "past the strike"].map((k) => (
                <li key={k} className="flex items-center gap-2 text-muted">
                  <Check size={13} className="text-yes" /> {k}
                </li>
              ))}
            </ul>
          </StepCard>
        </div>
      </Container>

      {/* Proof */}
      <div className="border-y border-line bg-panel">
        <Container id="proof" className="grid items-center gap-12 py-24 lg:grid-cols-[0.9fr_1.1fr] lg:py-28">
          <div>
            <span className="chip">Permissionless</span>
            <H2 className="mt-5">Prove it yourself</H2>
            <p className="mt-4 max-w-md text-[17px] leading-relaxed text-muted">
              Resolution is one instruction anyone can send. No oracle committee, no dispute window, no admin key: if the
              print is valid, the market is touched.
            </p>
            <a href={EXPLORER} target="_blank" rel="noreferrer" className="mt-8 inline-flex items-center gap-1.5 rounded-lg border border-line-2 px-4 py-2.5 text-sm hover:bg-panel-2">
              Program on Solana Explorer <ArrowUpRight size={14} />
            </a>
          </div>
          <CodeTabs tabs={CODE} />
        </Container>
      </div>

      {/* Bento */}
      <Container className="py-28 lg:py-32">
        <div className="text-center">
          <H2>Built for traders who keep score</H2>
          <p className="mx-auto mt-4 max-w-xl text-[17px] text-muted">Hedge the downside, start at a fair price, and let the record speak.</p>
        </div>
        <div className="mt-14 grid gap-4 lg:grid-cols-3">
          <Bento className="lg:col-span-2" icon={<Shield size={18} />} title="Hedge the wick" tone="guard">
            Buy protection at your liquidation level. If SOL wicks through it, each share pays 1 USDC, whatever happens next.
            <WickArt />
          </Bento>
          <Bento icon={<Sigma size={18} />} title="Fair from the first trade">
            Opening odds come from volatility, distance and time, computed onchain.
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
            Creators claim a quarter of the fee on every trade through their call.
            <div>
              <div className="flex h-2 gap-1">
                <span className="w-1/2 rounded-full bg-panel-3" />
                <span className="w-1/4 rounded-full bg-line-2" />
                <span className="w-1/4 rounded-full bg-brand" />
              </div>
              <div className="num mt-2 flex text-[11px] text-faint">
                <span className="w-1/2">pm-AMM 1%</span>
                <span className="w-1/4">treasury</span>
                <span className="w-1/4 text-ink">you 0.5%</span>
              </div>
            </div>
          </Bento>
          <Bento icon={<Zap size={18} />} title="One click to try">
            An instant devnet wallet that funds itself with test USDC. No extension, no sign-up.
            <Link href="/app" className="inline-flex w-fit items-center gap-1 rounded-lg bg-ink px-3.5 py-2 text-sm font-medium text-bg">
              Try it free <ArrowRight size={14} />
            </Link>
          </Bento>
        </div>
      </Container>

      {/* FAQ */}
      <Container id="faq" className="grid gap-12 pb-28 lg:grid-cols-[0.8fr_1.2fr] lg:pb-32">
        <div>
          <span className="chip">FAQ</span>
          <H2 className="mt-5">Questions, answered</H2>
        </div>
        <div className="divide-y divide-line border-y border-line">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-5">
              <summary className="flex items-center justify-between gap-6 text-[17px] font-medium tracking-[-0.01em]">
                {q}
                <Plus size={18} className="faq-plus shrink-0 text-faint transition-transform" />
              </summary>
              <div className="mt-3 max-w-xl font-sans leading-relaxed text-muted">{a}</div>
            </details>
          ))}
        </div>
      </Container>

      {/* CTA */}
      <Container className="pb-24">
        <div className="relative overflow-hidden rounded-3xl bg-field px-6 py-20 text-center text-white sm:px-12">
          <DotField cell={8} seed={8} touchAt={0.7} className="pointer-events-none absolute -right-10 bottom-0 h-[300px] w-auto opacity-60" />
          <div className="relative">
            <H2 className="sm:text-[56px]">Take your call live.</H2>
            <p className="mx-auto mt-4 max-w-md text-[17px] font-medium text-white/90">Free test USDC, an instant wallet, and a market in under a minute.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/app" className="inline-flex items-center gap-1.5 rounded-lg bg-white px-5 py-3 text-[15px] font-medium text-black hover:bg-white/90">
                Launch app <ArrowUpRight size={16} />
              </Link>
              <Link href="/protect" className="inline-flex items-center rounded-lg bg-black/20 px-5 py-3 text-[15px] font-medium hover:bg-black/30">
                Protect a position
              </Link>
            </div>
          </div>
        </div>
      </Container>

      {/* Footer */}
      <footer className="border-t border-line">
        <Container className="grid gap-10 py-14 md:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <Link href="/" className="flex items-center gap-2 text-ink">
              <LogoMark size={22} />
              <span className="text-[19px] font-semibold tracking-[-0.03em]">Thesis</span>
            </Link>
            <p className="mt-4 max-w-xs font-sans text-sm leading-relaxed text-muted">Trade calls as markets, settled by a price anyone can prove.</p>
          </div>
          <FooterCol title="Product" links={[["Markets", "/app"], ["Post a call", "/new"], ["Protect a position", "/protect"], ["Traction", "/stats"]]} />
          <FooterCol title="Protocol" links={[["Thesis program", EXPLORER], ["pm-AMM", "https://predict-pm-amm.dev"], ["Pyth price feeds", "https://www.pyth.network/price-feeds"]]} />
        </Container>
        <Container className="num flex flex-wrap justify-between gap-3 border-t border-line py-6 text-xs text-faint">
          <span>© 2026 Thesis</span>
          <span>Devnet · test assets only · not financial advice</span>
        </Container>
      </footer>
    </div>
  );
}

function StatCard({ chip, big, icon, children }: { chip: string; big: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-[380px] flex-col items-center rounded-3xl border border-line bg-panel p-7 text-center">
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
    <div className="flex flex-col rounded-3xl border border-line bg-panel p-7">
      <div className="flex h-[156px] flex-col justify-center rounded-2xl border border-line bg-bg p-5">{children}</div>
      <span className="num mt-7 text-xs text-faint">{n}</span>
      <h3 className="mt-2 text-xl font-semibold tracking-[-0.025em]">{title}</h3>
      <p className="mt-2 font-sans leading-relaxed text-muted">{body}</p>
    </div>
  );
}

function Bento({ className = "", icon, title, tone, children }: { className?: string; icon: ReactNode; title: string; tone?: "guard"; children: ReactNode }) {
  return (
    <div className={"flex flex-col rounded-3xl border border-line bg-panel p-7 " + className}>
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

/** A wick through the protection line: the moment cover pays. */
function WickArt() {
  return (
    <svg viewBox="0 0 480 110" className="h-auto w-full rounded-xl border border-line bg-bg" aria-hidden="true">
      <line x1="0" x2="480" y1="74" y2="74" stroke="var(--color-guard-mark)" strokeWidth="1.25" strokeDasharray="4 4" />
      <text x="472" y="92" textAnchor="end" fontSize="11" fill="var(--color-guard)" className="num">
        protection $198
      </text>
      <path d="M0 30 L40 36 L80 26 L120 40 L160 32 L200 44 L240 38 L280 50 L296 96 L312 48 L352 40 L392 30 L432 34 L480 26" fill="none" stroke="var(--color-ink)" strokeWidth="1.75" strokeLinejoin="round" />
      <circle cx="289" cy="74" r="5" fill="var(--color-guard-mark)" stroke="var(--color-bg)" strokeWidth="2" />
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
