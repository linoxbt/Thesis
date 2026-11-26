"use client";

import { ArrowRight, AtSign, BadgeCheck, Loader2, QrCode, Wallet, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Address } from "viem";
import { QIE_WALLET_URL } from "@/lib/config";
import { shortAddr } from "@/lib/format";
import { normalizeQieId, resolveQieId } from "@/lib/qieid";
import { explain, useWallet, type Via } from "@/lib/wallet";

const QIE_ID_URL = "https://qiewallet.me";

/**
 * Sign in: QIE Wallet in the browser, Reown (WalletConnect) for any wallet by
 * QR code or on a phone, or a QIE ID, which is checked against the wallet that
 * signs. Signing in is one free signature (EIP-4361), never a transaction.
 */
export function SignInDialog() {
  const w = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"wallets" | "qieid">("wallets");
  const [qieId, setQieId] = useState("");
  const [resolved, setResolved] = useState<{ name: string; address: Address | null } | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!w.signInOpen) return;
    setErr(null);
    setBusy(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && w.closeSignIn();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [w.signInOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Look the QIE ID up as it's typed.
  useEffect(() => {
    setResolved(null);
    const name = normalizeQieId(qieId);
    if (!name) return;
    let live = true;
    setResolving(true);
    const t = setTimeout(() => {
      resolveQieId(name)
        .then((address) => live && setResolved({ name, address }))
        .catch(() => live && setErr("Couldn't reach the QIE ID lookup. Try again."))
        .finally(() => live && setResolving(false));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [qieId]);

  if (!w.signInOpen || typeof document === "undefined") return null;

  const go = async (via: Via, withId?: string) => {
    setErr(null);
    setBusy(via + (withId ? "-id" : ""));
    try {
      await w.signIn(via, withId);
    } catch (e) {
      const m = explain(e);
      setErr(/reset|closed|cancel/i.test(m) ? "Sign-in cancelled." : m);
    } finally {
      setBusy(null);
    }
  };

  const spinner = <Loader2 size={15} className="animate-spin" />;
  const option = (key: string, icon: React.ReactNode, title: string, sub: string, onClick: () => void, disabled = false, testid?: string) => (
    <button
      onClick={onClick}
      disabled={disabled || !!busy}
      className="flex w-full items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-left transition-colors hover:border-line-2 hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-50"
      data-testid={testid}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-panel-3 text-ink">{busy === key ? spinner : icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-xs text-muted">{sub}</span>
      </span>
      <ArrowRight size={15} className="shrink-0 text-faint" />
    </button>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      onClick={() => !busy && w.closeSignIn()}
      role="dialog"
      aria-modal="true"
      aria-label="Sign in"
    >
      <div className="panel w-full max-w-md p-5 shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="signin-modal">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Sign in to Thesis</h2>
          <button onClick={w.closeSignIn} className="rounded-full p-1 text-muted hover:bg-panel-2 hover:text-ink" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="mb-4 text-xs text-muted">One signature proves the wallet is yours. It&apos;s free: no transaction, no gas.</p>

        <div className="mb-4 grid grid-cols-2 gap-1 rounded-full border border-line bg-bg p-1 text-xs" role="tablist">
          {(
            [
              ["wallets", "Wallet"],
              ["qieid", "QIE ID"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={mode === k}
              onClick={() => (setMode(k), setErr(null))}
              className={"rounded-full py-1.5 font-medium " + (mode === k ? "bg-ink text-bg" : "text-muted hover:text-ink")}
              data-testid={`signin-tab-${k}`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "wallets" ? (
          <div className="space-y-2">
            {w.available
              ? option("injected", <Wallet size={16} />, w.walletName ?? "QIE Wallet", "Browser extension", () => void go("injected"), false, "signin-injected")
              : option("get", <Wallet size={16} />, "Get QIE Wallet", "No browser wallet found on this device", () => window.open(QIE_WALLET_URL, "_blank", "noopener"), false, "signin-get-wallet")}
            {option(
              "reown",
              <QrCode size={16} />,
              "Reown · WalletConnect",
              w.reownAvailable ? "QIE Wallet app, MetaMask, Trust and 700+ wallets, by QR code or on your phone" : "Not set up on this site yet",
              () => void go("reown"),
              !w.reownAvailable,
              "signin-reown",
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="text-muted">Your QIE ID</span>
              <div className="field mt-1 flex items-center gap-2 px-3 py-2.5">
                <AtSign size={15} className="text-faint" />
                <input
                  value={qieId}
                  onChange={(e) => setQieId(e.target.value)}
                  placeholder="yourname.qie"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="num w-full bg-transparent text-base outline-none"
                  data-testid="qieid-input"
                />
                {resolving && spinner}
              </div>
            </label>
            <div className="min-h-[1.25rem] text-xs" data-testid="qieid-status">
              {qieId && !normalizeQieId(qieId) && <span className="text-bad">A QIE ID looks like yourname.qie.</span>}
              {resolved &&
                (resolved.address ? (
                  <span className="flex items-center gap-1.5 text-muted">
                    <BadgeCheck size={13} className="text-yes" />
                    <span className="text-ink">{resolved.name}</span> → <span className="num">{shortAddr(resolved.address)}</span>
                  </span>
                ) : (
                  <span className="text-bad">
                    {resolved.name} isn&apos;t registered.{" "}
                    <a href={QIE_ID_URL} target="_blank" rel="noreferrer" className="underline">
                      Get a QIE ID
                    </a>
                  </span>
                ))}
            </div>
            {resolved?.address && (
              <div className="space-y-2">
                <p className="text-xs text-faint">Confirm with the wallet {resolved.name} points to:</p>
                {w.available && option("injected-id", <Wallet size={16} />, `Sign with ${w.walletName ?? "QIE Wallet"}`, "Browser extension", () => void go("injected", resolved.name), false, "qieid-sign-injected")}
                {w.reownAvailable && option("reown-id", <QrCode size={16} />, "Sign with Reown", "Any wallet, by QR code or on your phone", () => void go("reown", resolved.name), false, "qieid-sign-reown")}
                {!w.available && !w.reownAvailable && <p className="text-xs text-bad">No wallet available to sign with on this device.</p>}
              </div>
            )}
            {!qieId && (
              <p className="text-xs text-faint">
                No QIE ID yet?{" "}
                <a href={QIE_ID_URL} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                  Get one at qiewallet.me
                </a>
                , or sign in with a wallet: your QIE ID shows automatically once it points to that wallet.
              </p>
            )}
          </div>
        )}

        {err && (
          <p className="mt-3 rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-xs text-bad" data-testid="signin-error">
            {err}
          </p>
        )}
        <p className="mt-4 text-[11px] leading-snug text-faint">
          Signing in keeps you signed in on this browser for 7 days. Every bet, post and claim still asks your wallet to
          confirm.
        </p>
      </div>
    </div>,
    document.body,
  );
}
