"use client";

import { AccountLayout, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useEffect, useState } from "react";
import { pmAccounts } from "@/lib/client/actions";
import { useNow } from "@/lib/client/api";
import { USDC } from "@/lib/client/config";
import { pct, pythToNumber, timeLeft, usd, usdc } from "@/lib/client/format";
import { useConnection } from "@/lib/client/wallet";

export interface WalletMarket {
  touch_market: string;
  pm_market: string;
  direction: "above" | "below";
  strike: string;
  expo: number;
  end_ts: string;
  yes_price_bps: number | null;
  initial_price_bps: number;
  touched: boolean;
  settled: boolean;
  winning_side: number;
  thesis: string | null;
  is_conviction: boolean;
}

interface Held {
  m: WalletMarket;
  yes: bigint;
  no: bigint;
}

/**
 * Open and claimable positions: every market the indexer saw this wallet
 * trade, with its YES/NO balances read onchain (so sells, transfers and
 * claims show at once, not when the indexer catches up).
 */
export function Positions({ owner, markets }: { owner: string; markets: WalletMarket[] }) {
  const { connection } = useConnection();
  const now = useNow(30_000);
  const [held, setHeld] = useState<Held[] | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const ownerKey = new PublicKey(owner);
      const keys = markets.flatMap((m) => {
        const { yesMint, noMint } = pmAccounts(new PublicKey(m.pm_market));
        return [getAssociatedTokenAddressSync(yesMint, ownerKey, true), getAssociatedTokenAddressSync(noMint, ownerKey, true)];
      });
      const infos: (Awaited<ReturnType<typeof connection.getMultipleAccountsInfo>>[number])[] = [];
      for (let i = 0; i < keys.length; i += 100) infos.push(...(await connection.getMultipleAccountsInfo(keys.slice(i, i + 100))));
      const amt = (i: number) => (infos[i] ? AccountLayout.decode(infos[i]!.data).amount : 0n);
      const rows = markets.map((m, i) => ({ m, yes: amt(2 * i), no: amt(2 * i + 1) })).filter((r) => r.yes > 0n || r.no > 0n);
      if (live) setHeld(rows);
    })().catch(() => live && setHeld((h) => h ?? []));
    return () => {
      live = false;
    };
    // Re-read when the market list changes or every 30 s via `now`.
  }, [owner, markets, connection, now]);

  if (!held) return <p className="text-sm text-muted">Reading balances…</p>;
  if (!held.length) return <p className="text-sm text-muted" data-testid="positions-empty">No open positions.</p>;
  return (
    <ul className="divide-y divide-line" data-testid="positions">
      {held.map(({ m, yes, no }) => {
        const strike = usd(pythToNumber(m.strike, m.expo));
        const kind = m.is_conviction ? `Take profit ${strike}` : `Cover at ${strike}`;
        const price = m.yes_price_bps ?? m.initial_price_bps;
        const won = m.winning_side === 1 ? yes : m.winning_side === 2 ? no : 0n;
        const value = m.settled ? won : (yes * BigInt(price) + no * BigInt(10_000 - price)) / 10_000n;
        const status = m.settled
          ? won > 0n
            ? "Won · claim"
            : "Lost"
          : m.touched
            ? "Touched · settles soon"
            : Number(m.end_ts) > now
              ? `${timeLeft(Number(m.end_ts), now)} left · YES ${pct(price)}`
              : "Window closed";
        const href = m.thesis ? `/t/${m.thesis}` : `/m/${m.touch_market}`;
        return (
          <li key={m.touch_market}>
            <Link href={href} className="num flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm hover:text-ink">
              <span>
                <span className="text-ink">{kind}</span>
                <span className="block text-[11px] text-faint">{status}</span>
              </span>
              <span className="text-right text-xs">
                {yes > 0n && <span className="block">{(Number(yes) / USDC).toFixed(2)} YES</span>}
                {no > 0n && <span className="block">{(Number(no) / USDC).toFixed(2)} NO</span>}
                <span className={"block " + (m.settled && won > 0n ? "text-yes" : "text-faint")}>
                  {m.settled ? (won > 0n ? `${usdc(value)} to claim` : "nothing to claim") : `≈ ${usdc(value)}`}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
