import { ArrowRight, ArrowUpRight, BadgeCheck, Check, Coins, LineChart, Plus, Scale, Shield, Sigma } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo, LogoMark } from "@/components/Brand";
import { HeroVisual } from "@/components/landing/HeroVisual";
import { LiveStats } from "@/components/landing/LiveStats";
import { SiteNav } from "@/components/landing/SiteNav";

export const metadata: Metadata = {
  title: { absolute: "Thesis — put a price on your conviction" },
};

const PROGRAM_ID = "9yVcFaDEmBk1VU66tXxuvUujZXfiiT3ED1EpioVuug6h";
const EXPLORER = `https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet`;

function Section({ id, children, className = "" }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={"mx-auto max-w-6xl scroll-mt-20 px-5 lg:px-8 " + className}>
      {children}
    </section>
  );
}

function Heading({ label, title, sub, center = false }: { label: string; title: ReactNode; sub?: ReactNode; center?: boolean }) {
  return (
    <div className={center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <span className="label">{label}</span>
      <h2 className="display mt-4 text-4xl leading-[1.05] sm:text-5xl">{title}</h2>
      {sub && <p className="mt-4 text-lg leading-relaxed text-muted">{sub}</p>}
    </div>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Post the call",
    body: "Pick a SOL price level and a deadline, and say why in a line. Thesis opens a live market on your call, with fair odds computed onchain from volatility.",
  },
  {
    n: "02",
    title: "The crowd prices it",
    body: "Anyone can back your call or challenge it. The YES price is the crowd's live estimate of the chance you're right, and you earn a share of the fees on every trade.",
  },
  {
    n: "03",
    title: "Price proves it",
    body: "The first signed Pyth price at or beyond your level resolves the market. Anyone can submit that proof. There's no committee to vote and no admin key to override it.",
  },
];

const PROOF_CHECKS = [
  ["Signed update", "A Pyth PriceUpdateV2 account, fully verified against Wormhole guardian signatures"],
  ["Right feed", "The feed id matches SOL/USD exactly"],
  ["Tight price", "Confidence interval within 0.5% of the price"],
  ["In the window", "Published after the market opened and before it closed"],
  ["Past the line", "Price at or beyond the strike, in the call's direction"],
];

const FAQ: [string, ReactNode][] = [
  [
    "What exactly is a thesis?",
    "A public trade call with a market attached. You say where SOL is going and by when; Thesis turns that into a touch market the crowd can trade, and records the outcome against your profile.",
  ],
  [
    "What is a touch market?",
    "A market that asks whether price reaches a level at any moment before the deadline, not only at the close. If SOL prints at or past your strike once, the market resolves YES, even if price falls back later.",
  ],
  [
    "Who decides whether a call hit?",
    "Nobody decides. Resolution needs a signed Pyth price that passes five checks onchain. Our watcher submits proofs automatically, but the instruction is permissionless: anyone holding a valid price update can resolve the market.",
  ],
  [
    "How are the opening odds set?",
    <>
      The program computes them onchain from the distance to the strike, the time left and SOL's volatility: the
      reflection-principle probability that price touches the level, <span className="num text-ink">P = 2Φ(−|ln(K/S)| / σ√τ)</span>.
      Every call starts at a fair price instead of a coin flip.
    </>,
  ],
  [
    "What does protection do?",
    "It's a touch market on your liquidation level. Each protection share pays 1 USDC if SOL touches that level before the deadline, so you can hedge the wick that would stop you out, priced by the same AMM.",
  ],
  [
    "What do creators earn?",
    "Every trade pays a 2% fee: half to the pm-AMM protocol, half to the Thesis treasury. The creator of the call can claim half of the treasury's share, a quarter of the whole fee, on every trade made through their thesis.",
  ],
  [
    "What is the pm-AMM?",
    "An automated market maker designed for outcome tokens, whose prices converge to 0 or 1 at expiry. Its liquidity curve keeps pricing sensible as a market approaches its deadline. Thesis markets trade on it directly.",
  ],
  [
    "Is this real money?",
    "Not yet. Thesis runs on Solana devnet with test USDC. One click creates an instant wallet that funds itself, so you can try every flow without installing anything.",
  ],
];

export default function LandingPage() {
  return (
    <div className="overflow-x-clip">
      <SiteNav />

      {/* Hero */}
      <div className="relative">
        <div className="grid-bg pointer-events-none absolute inset-0 -z-0 opacity-60" />
        <Section className="relative grid items-center gap-14 pb-20 pt-14 lg:grid-cols-[1.05fr_1fr] lg:pb-28 lg:pt-20">
          <div>
            <span className="num inline-flex items-center gap-2 rounded-full border border-line-2 bg-panel/70 px-3 py-1 text-xs text-muted backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" /> Live on Solana devnet
            </span>
            <h1 className="display mt-6 text-[52px] leading-[0.98] sm:text-7xl lg:text-[80px]">
              Put a price on
              <br />
              your <em className="text-brand">conviction.</em>
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted">
              Post a call on SOL. It becomes a live market the crowd can back or challenge, with protection that pays if
              price touches your line. Every market settles from a Pyth price that anyone can prove.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/app" className="btn btn-primary px-5 py-3">
                Launch app <ArrowUpRight size={16} />
              </Link>
              <Link href="/new" className="btn btn-ghost px-5 py-3">
                Post a call
              </Link>
            </div>
            <div className="num mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-faint">
              <span className="flex items-center gap-1.5">
                <Check size={13} className="text-brand" /> No sign-up
              </span>
              <span className="flex items-center gap-1.5">
                <Check size={13} className="text-brand" /> Free test USDC
              </span>
              <span className="flex items-center gap-1.5">
                <Check size={13} className="text-brand" /> No admin key
              </span>
            </div>
          </div>
          <HeroVisual />
        </Section>
      </div>

      {/* Built on */}
      <Section className="pb-14">
        <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-4 border-t border-line pt-8">
          <span className="num text-xs uppercase tracking-[0.12em] text-faint">Built on</span>
          {["Solana", "Pyth Network", "pm-AMM", "Anchor", "Wormhole"].map((n) => (
            <span key={n} className="display text-2xl text-muted">
              {n}
            </span>
          ))}
        </div>
      </Section>

      <LiveStats />

      {/* How it works */}
      <Section id="how" className="py-24 lg:py-32">
        <Heading
          label="How it works"
          title={
            <>
              From hot take to <em>priced position</em> in three steps.
            </>
          }
        />
        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="bg-panel p-7 lg:p-8">
              <div className="display text-5xl text-faint">{s.n}</div>
              <h3 className="mt-8 text-lg font-medium">{s.title}</h3>
              <p className="mt-3 leading-relaxed text-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Markets bento */}
      <Section id="markets" className="pb-24 lg:pb-32">
        <Heading
          label="Two markets per call"
          title={
            <>
              Conviction on one side. <em>Cover</em> on the other.
            </>
          }
          sub="Every thesis opens a conviction market for the crowd, plus an optional protection market for anyone holding the position. Both trade on the pm-AMM and both settle from the same proof."
        />
        <div className="mt-14 grid gap-4 lg:grid-cols-6">
          <Bento className="lg:col-span-4" icon={<LineChart size={18} />} title="Back it or challenge it">
            <p>YES pays 1 USDC if price touches the strike before the deadline. NO pays if it doesn&apos;t. The YES price is the crowd&apos;s probability, updated with every trade.</p>
            <OddsBar />
          </Bento>
          <Bento className="lg:col-span-2" icon={<Shield size={18} />} title="Hedge the wick" tone="guard">
            <p>Buy protection at your liquidation level. If SOL wicks through it, each share pays 1 USDC, whatever happens next.</p>
            <WickArt />
          </Bento>
          <Bento className="lg:col-span-2" icon={<Sigma size={18} />} title="Fair from the first trade">
            <p>Opening odds come from SOL&apos;s volatility, the distance to the strike and the time left, all computed onchain. There&apos;s no 50/50 starting price to farm.</p>
            <div className="rounded-xl border border-line bg-bg px-4 py-3 text-center">
              <span className="display text-2xl text-ink">
                <em>P</em> = 2Φ(−|ln <em>K/S</em>| / <em>σ</em>√<em>τ</em>)
              </span>
            </div>
          </Bento>
          <Bento className="lg:col-span-2" icon={<BadgeCheck size={18} />} title="A record you can't delete">
            <p>Calls hit or missed, the odds you opened at, the volume you drew. Your profile is built from onchain outcomes, not screenshots.</p>
            <div className="rounded-xl border border-line bg-bg px-4 py-3">
              <div className="flex gap-1.5">
                {[1, 1, 0, 1, 1, 0, 1, 1].map((h, i) => (
                  <span key={i} className={"h-5 flex-1 rounded " + (h ? "bg-yes-mark" : "bg-panel-3")} />
                ))}
              </div>
              <div className="num mt-2 flex justify-between text-xs text-faint">
                <span>6 hit · 2 missed</span>
                <span>example</span>
              </div>
            </div>
          </Bento>
          <Bento className="lg:col-span-2" icon={<Coins size={18} />} title="Get paid to be followed">
            <p>Creators claim a quarter of the trading fee on every trade through their call, whether the crowd agrees with them or not.</p>
            <div className="rounded-xl border border-line bg-bg px-4 py-3">
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
        </div>
      </Section>

      {/* The touch */}
      <div className="border-y border-line bg-panel">
        <Section id="proof" className="grid gap-14 py-24 lg:grid-cols-2 lg:py-32">
          <div>
            <Heading
              label="Trustless settlement"
              title={
                <>
                  One signed print. <em>That&apos;s the whole oracle.</em>
                </>
              }
              sub="A touch market resolves the moment anyone shows a Pyth price at or past the strike. The program checks the proof itself. No voting window, no dispute game, no admin."
            />
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={EXPLORER} target="_blank" rel="noreferrer" className="btn btn-ghost text-sm">
                Program on Solana Explorer <ArrowUpRight size={14} />
              </a>
            </div>
          </div>
          <ol className="space-y-px overflow-hidden rounded-2xl border border-line bg-line">
            {PROOF_CHECKS.map(([k, v], i) => (
              <li key={k} className="flex gap-5 bg-bg p-5">
                <span className="num mt-0.5 text-xs text-faint">{String(i + 1).padStart(2, "0")}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    <Check size={15} className="text-yes" /> {k}
                  </div>
                  <p className="mt-1 text-sm text-muted">{v}</p>
                </div>
              </li>
            ))}
            <li className="flex items-center gap-4 bg-bg p-5">
              <LogoMark size={22} className="text-ink" pulse />
              <p className="text-sm text-muted">
                All five pass, and the market is <span className="text-ink">touched</span>. It settles after a two-minute grace period.
              </p>
            </li>
          </ol>
        </Section>
      </div>

      {/* Principles */}
      <Section className="py-24 lg:py-32">
        <div className="grid gap-10 md:grid-cols-3">
          {[
            [<Scale key="s" size={18} />, "Skin in the game", "Calls are markets, so the crowd's odds are a running score of every trader's judgment."],
            [<Shield key="g" size={18} />, "Downside you can see", "Protection is priced in the open, on the same curve, from the same proof as the call."],
            [<BadgeCheck key="b" size={18} />, "Verifiable by default", "Every market, trade, touch and payout is a Solana transaction you can inspect."],
          ].map(([icon, t, b]) => (
            <div key={String(t)}>
              <div className="grid h-10 w-10 place-items-center rounded-full border border-line-2 text-brand">{icon}</div>
              <h3 className="mt-5 text-lg font-medium">{t}</h3>
              <p className="mt-2 leading-relaxed text-muted">{b}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* FAQ */}
      <Section id="faq" className="grid gap-12 pb-24 lg:grid-cols-[1fr_1.4fr] lg:pb-32">
        <Heading label="FAQ" title={<>Questions, <em>answered.</em></>} />
        <div className="divide-y divide-line border-y border-line">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-5">
              <summary className="flex items-center justify-between gap-6 text-lg">
                {q}
                <Plus size={18} className="faq-plus shrink-0 text-faint transition-transform" />
              </summary>
              <div className="mt-3 max-w-xl leading-relaxed text-muted">{a}</div>
            </details>
          ))}
        </div>
      </Section>

      {/* CTA */}
      <Section className="pb-24">
        <div className="glow relative overflow-hidden rounded-3xl border border-line bg-panel px-6 py-16 text-center sm:px-12 sm:py-20">
          <div className="grid-bg pointer-events-none absolute inset-0 opacity-50" />
          <div className="relative">
            <LogoMark size={44} className="mx-auto text-ink" pulse />
            <h2 className="display mx-auto mt-8 max-w-2xl text-5xl leading-[1.02] sm:text-6xl">
              Make the call. <em>Let the market keep score.</em>
            </h2>
            <p className="mx-auto mt-5 max-w-md text-muted">An instant wallet with free test USDC is one click away. Nothing here has real value yet.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/app" className="btn btn-primary px-5 py-3">
                Launch app <ArrowRight size={16} />
              </Link>
              <Link href="/protect" className="btn btn-ghost px-5 py-3">
                Protect a position
              </Link>
            </div>
          </div>
        </div>
      </Section>

      {/* Footer */}
      <footer className="border-t border-line">
        <Section className="grid gap-10 py-14 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
              Trade calls as markets, settled by a price anyone can prove. Built on Solana.
            </p>
          </div>
          <FooterCol
            title="Product"
            links={[
              ["Markets", "/app"],
              ["Post a call", "/new"],
              ["Protect a position", "/protect"],
              ["Traction", "/stats"],
            ]}
          />
          <FooterCol
            title="Protocol"
            links={[
              ["Thesis program", EXPLORER],
              ["pm-AMM", "https://predict-pm-amm.dev"],
              ["Pyth price feeds", "https://www.pyth.network/price-feeds"],
            ]}
          />
        </Section>
        <Section className="num flex flex-wrap justify-between gap-3 border-t border-line py-6 text-xs text-faint">
          <span>© 2026 Thesis</span>
          <span>Devnet · test assets only · not financial advice</span>
        </Section>
      </footer>
    </div>
  );
}

function Bento({
  className = "",
  icon,
  title,
  tone,
  children,
}: {
  className?: string;
  icon: ReactNode;
  title: string;
  tone?: "guard";
  children: ReactNode;
}) {
  return (
    <div className={"panel flex flex-col p-7 " + className}>
      <div className={"grid h-10 w-10 place-items-center rounded-full border " + (tone === "guard" ? "border-guard/30 bg-guard/10 text-guard" : "border-line-2 text-ink")}>
        {icon}
      </div>
      <h3 className="mt-6 text-lg font-medium">{title}</h3>
      <div className="mt-2 space-y-5 leading-relaxed text-muted">{children}</div>
    </div>
  );
}

/** A wick through the protection line: the moment cover pays. */
function WickArt() {
  return (
    <svg viewBox="0 0 240 80" className="h-auto w-full rounded-xl border border-line bg-bg" aria-hidden="true">
      <line x1="0" x2="240" y1="54" y2="54" stroke="var(--color-guard-mark)" strokeWidth="1.25" strokeDasharray="4 4" />
      <path d="M0 24 L30 28 L52 20 L78 30 L100 26 L124 34 L140 30 L152 62 L160 36 L186 30 L212 22 L240 26" fill="none" stroke="var(--color-ink)" strokeWidth="1.75" strokeLinejoin="round" />
      <circle cx="149" cy="54" r="4" fill="var(--color-guard-mark)" stroke="var(--color-bg)" strokeWidth="2" />
    </svg>
  );
}

/** Illustrative YES/NO split, as the market shows it. */
function OddsBar() {
  return (
    <div className="rounded-xl border border-line bg-bg p-4">
      <div className="num flex justify-between text-xs">
        <span className="text-yes">YES 64¢ · backers</span>
        <span className="text-muted">NO 36¢ · challengers</span>
      </div>
      <div className="mt-3 flex h-2 gap-1 overflow-hidden rounded-full">
        <div className="rounded-full bg-yes-mark" style={{ width: "64%" }} />
        <div className="flex-1 rounded-full bg-panel-3" />
      </div>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="num text-xs uppercase tracking-[0.12em] text-faint">{title}</div>
      <ul className="mt-4 space-y-2.5 text-sm">
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
