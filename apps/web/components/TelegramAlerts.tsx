"use client";

import { BellRing, Check, ExternalLink, Send } from "lucide-react";
import { useCallback, useState } from "react";
import { usePoll } from "@/lib/client/api";
import type { ActiveWallet } from "@/lib/client/wallet";
import { alertsMessage, type AlertsAction } from "@/lib/alertsMessage";

interface Status {
  configured: boolean;
  bot?: string;
  linked: boolean;
  username?: string | null;
}

/**
 * Telegram alerts on the Profile page. Connecting signs a message with the
 * wallet (free), gets a one-time t.me link, and the bot links the chat when
 * you press Start. Status refreshes until it shows as connected.
 */
export function TelegramAlerts({ wallet }: { wallet: ActiveWallet }) {
  const addr = wallet.publicKey.toBase58();
  const { data, reload } = usePoll<Status>(`/api/alerts/telegram?wallet=${addr}`, 5_000);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const signed = useCallback(
    async (action: AlertsAction) => {
      if (!wallet.signMessage) throw new Error("This wallet can't sign messages.");
      const issuedAt = Math.floor(Date.now() / 1000);
      const sig = await wallet.signMessage(new TextEncoder().encode(alertsMessage(addr, action, issuedAt)));
      const r = await fetch("/api/alerts/telegram", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: addr, action, issued_at: issuedAt, signature: Buffer.from(sig).toString("base64") }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      return body as { url?: string };
    },
    [wallet, addr],
  );

  const run = async (action: AlertsAction) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await signed(action);
      if (action === "connect" && r.url) setLink(r.url);
      if (action === "disconnect") setLink(null);
      void reload();
    } catch (e) {
      const m = (e as Error).message;
      setErr(/reject|denied|cancel/i.test(m) ? "Signature cancelled." : m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="telegram-alerts">
      <div className="flex items-center gap-2 text-sm">
        <BellRing size={15} className="text-brand" /> Telegram alerts
      </div>
      <p className="mb-3 mt-0.5 text-xs text-faint">
        Get a message when your take profit or liquidation is touched, when your markets settle, and when someone backs or
        challenges your call.
      </p>
      {!data ? (
        <p className="text-xs text-muted">Checking…</p>
      ) : !data.configured ? (
        <p className="rounded-lg border border-line bg-bg px-3 py-2 text-xs text-muted" data-testid="telegram-off">
          Telegram alerts aren&apos;t switched on for this deployment yet.
        </p>
      ) : data.linked ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-bg px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-sm text-yes" data-testid="telegram-linked">
            <Check size={14} /> Connected{data.username ? ` as @${data.username}` : ""}
          </span>
          <button onClick={() => void run("disconnect")} disabled={busy} className="text-xs text-muted underline-offset-4 hover:text-bad hover:underline">
            Disconnect
          </button>
        </div>
      ) : link ? (
        <div className="space-y-2">
          <a href={link} target="_blank" rel="noreferrer" className="btn btn-primary w-full text-sm" data-testid="telegram-open">
            <Send size={14} /> Open @{data.bot} and press Start <ExternalLink size={12} />
          </a>
          <p className="text-[11px] text-faint">The link works once, for 15 minutes. This page updates when the chat is linked.</p>
        </div>
      ) : (
        <button onClick={() => void run("connect")} disabled={busy} className="btn btn-ghost w-full text-sm" data-testid="telegram-connect">
          <Send size={14} /> {busy ? "Waiting for signature…" : "Connect Telegram"}
        </button>
      )}
      {err && <p className="mt-2 text-xs text-bad">{err}</p>}
    </div>
  );
}
