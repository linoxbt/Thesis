/* eslint-disable @next/next/no-img-element -- static export: plain images from /public */

/**
 * Coin and token logos, served from /public/tokens. BTC and ETH are from the
 * CC0 cryptocurrency-icons set, SOL is Solana's mark; QIE and QUSDC are the
 * marks from QIE's own logo files (github.com/qieadmin/qie-logo), cropped to
 * the symbol. All are round.
 */
const SRC: Record<string, string> = {
  BTC: "/tokens/btc.svg",
  ETH: "/tokens/eth.svg",
  SOL: "/tokens/sol.png",
  QIE: "/tokens/qie.png",
  QUSDC: "/tokens/qusdc.png",
};

export function TokenIcon({ symbol, size = 16, className = "" }: { symbol: string; size?: number; className?: string }) {
  const src = SRC[symbol];
  if (!src) return null;
  return <img src={src} alt="" aria-hidden width={size} height={size} className={"inline-block shrink-0 " + className} style={{ width: size, height: size }} />;
}
