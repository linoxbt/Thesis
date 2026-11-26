"use client";

import { ArrowRight, AtSign, Loader2, QrCode, ShieldCheck, Smartphone, Wallet, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { QIE_WALLET_URL } from "@/lib/config";
import { explain, QIE_PASS_URL, useWallet, type QieIdLogin } from "@/lib/wallet";

type Flow =
  | { step: "enter" }
  | { step: "starting" }
  | { step: "code"; qieId: string; code: string; expiresAt: number }
  | { step: "done" }
  | { step: "ended"; why: "rejected" | "expired" | "error"; message: string };

const QIE_ID_URL = "https://qiewallet.me";
const api = (action: string, init?: RequestInit) => fetch(`${QIE_PASS_URL}?action=${action}`, { credentials: "same-origin", ...init });

/**
 * Sign in with QIE ID (QIE Pass): the user enters their QIE ID, the page shows
 * a 6-character code, and the user enters it in QIE Wallet to approve. Our
 * server function talks to QIE and opens the session; the browser never sees
 * the request ID or the partner secret. Or sign in with a wallet directly.
 */
export function SignInDialog() {
  const w = useWallet();
  const [mode, setMode] = useState<"qieid" | "wallets">("qieid");
  const [qieId, setQieId] = useState("");
  const [flow, setFlow] = useState<Flow>({ step: "enter" });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const polling = useRef(false);

  useEffect(() => {
    if (!w.signInOpen) return;
    setErr(null);
    setBusy(null);
    setNotice(null);
    setFlow({ step: "enter" });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && w.closeSignIn();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [w.signInOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown and polling while a code is shown: every 2 s until it's no longer pending.
  useEffect(() => {
    if (flow.step !== "code") return;
    const tick = setInterval(() => setNow(Date.now()), 500);
    const poll = setInterval(async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        const r = await api("status");
        const b = (await r.json().catch(() => ({}))) as Partial<QieIdLogin> & { status?: string; code?: string; message?: string; expiresAt?: string | number };
        if (r.ok && b.status === "completed" && b.address) {
          setFlow({ step: "done" });
          w.adoptQieIdLogin({ address: b.address, qieId: b.qieId!, verified: !!b.verified, expiresAt: Number(b.expiresAt) });
        } else if (r.ok && b.status === "rejected") {
          setFlow({ step: "ended", why: "rejected", message: "Sign-in was declined in QIE Wallet." });
        } else if (r.ok && b.status === "expired") {
          setFlow({ step: "ended", why: "expired", message: "Sign-in timed out." });
        } else if (!r.ok && r.status !== 502) {
          setFlow({ step: "ended", why: "error", message: b.message ?? "Sign-in couldn't be completed." });
        }
        // pending, or QIE briefly unreachable (502): keep polling until the deadline.
      } catch {
        /* network blip: try again on the next tick */
      } finally {
        polling.current = false;
      }
    }, 2000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [flow, w]);

  // The deadline passing ends the wait even if QIE hasn't said so yet.
  useEffect(() => {
    if (flow.step === "code" && now > flow.expiresAt + 3000) setFlow({ step: "ended", why: "expired", message: "Sign-in timed out." });
  }, [now, flow]);

  const start = useCallback(async () => {
    setErr(null);
    setNotice(null);
    setFlow({ step: "starting" });
    try {
      const r = await api("start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ qieId }) });
      const b = (await r.json().catch(() => ({}))) as { code?: string; qieId?: string; expiresAt?: string; message?: string; retryAfterSeconds?: number };
      if (r.status === 202 && b.code && b.expiresAt) {
        setNow(Date.now());
        setFlow({ step: "code", qieId: b.qieId ?? qieId, code: b.code, expiresAt: Date.parse(b.expiresAt) });
        return;
      }
      setFlow({ step: "enter" });
      setErr(b.message ?? (r.status === 404 ? "Sign in with QIE ID isn't available on this site yet." : "QIE couldn't start the sign-in. Try again."));
    } catch {
      setFlow({ step: "enter" });
      setErr("Couldn't reach the sign-in service. Check your connection and try again.");
    }
  }, [qieId]);

  if (!w.signInOpen || typeof document === "undefined") return null;

  const goWallet = async (key: string, via: "injected" | "reown") => {
    setErr(null);
    setBusy(key);
    try {
      await w.signIn(via);
    } catch (e) {
      const m = explain(e);
      setErr(/reset|closed|cancel/i.test(m) ? "Sign-in cancelled." : m);
    } finally {
      setBusy(null);
    }
  };

  const spinner = <Loader2 size={15} className="animate-spin" />;
  const option = (key: string, icon: React.ReactNode, title: string, sub: string, onClick: () => void, disabled = false) => (
    <button
      key={key}
      onClick={onClick}
      disabled={disabled || !!busy}
      className="flex w-full items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-left transition-colors hover:border-line-2 hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-50"
      data-testid={`signin-${key}`}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-panel-3 text-ink">{busy === key ? spinner : icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-xs text-muted">{sub}</span>
      </span>
      <ArrowRight size={15} className="shrink-0 text-faint" />
    </button>
  );
  const browserWallet = w.walletName && !["Reown · WalletConnect", "QIE ID"].includes(w.walletName) ? w.walletName : "QIE Wallet";
  const left = flow.step === "code" ? Math.max(0, Math.ceil((flow.expiresAt - now) / 1000)) : 0;
  const inFlow = flow.step === "code" || flow.step === "starting";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      onClick={() => !busy && !inFlow && w.closeSignIn()}
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
        <p className="mb-4 text-xs text-muted">No password. Approve in QIE Wallet, or sign once with your wallet: free, no transaction.</p>

        {!inFlow && (
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-full border border-line bg-bg p-1 text-xs" role="tablist">
            {(
              [
                ["qieid", "QIE ID"],
                ["wallets", "Wallet"],
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
        )}

        {mode === "qieid" ? (
          flow.step === "code" ? (
            <div className="text-center" data-testid="qieid-code-screen">
              <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-panel-3 text-ink">
                <Smartphone size={20} />
              </div>
              <p className="text-sm text-ink">Open QIE Wallet and enter this code</p>
              <p className="mt-1 text-xs text-muted">
                Signing in as <span className="text-ink">{flow.qieId}</span>. Check the request says it&apos;s from {typeof window !== "undefined" ? window.location.host : "this site"}.
              </p>
              <div className="num my-5 text-[44px] font-semibold leading-none tracking-[0.35em] text-ink" data-testid="qieid-code" aria-live="polite">
                {flow.code}
              </div>
              <div className="num text-xs text-faint" data-testid="qieid-countdown">
                <Loader2 size={12} className="-mt-0.5 mr-1 inline animate-spin" />
                Waiting for approval · {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} left
              </div>
              <button onClick={() => setFlow({ step: "enter" })} className="mt-4 text-xs text-muted underline hover:text-ink">
                Cancel
              </button>
            </div>
          ) : flow.step === "ended" ? (
            <div className="text-center" data-testid="qieid-ended">
              <p className="text-sm text-ink" data-testid="qieid-ended-message">
                {flow.message}
              </p>
              <button onClick={() => void start()} className="btn btn-primary mt-4 w-full" data-testid="qieid-restart">
                Start again
              </button>
              <button onClick={() => setFlow({ step: "enter" })} className="mt-2 text-xs text-muted underline hover:text-ink">
                Use a different QIE ID
              </button>
            </div>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (qieId.trim()) void start();
              }}
            >
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
                </div>
              </label>
              <button type="submit" disabled={!qieId.trim() || flow.step === "starting"} className="btn btn-primary w-full disabled:opacity-40" data-testid="qieid-submit">
                {flow.step === "starting" ? spinner : <ShieldCheck size={15} />} Sign in with QIE ID
              </button>
              {notice && <p className="text-xs text-muted">{notice}</p>}
              <p className="text-xs text-faint">
                You&apos;ll approve in QIE Wallet with a code shown here. Sign-in confirms your wallet; no identity data is shared.
                No QIE ID?{" "}
                <a href={QIE_ID_URL} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                  Get one
                </a>
                .
              </p>
            </form>
          )
        ) : (
          <div className="space-y-2">
            {w.available
              ? option("injected", <Wallet size={16} />, browserWallet, "Browser extension", () => void goWallet("injected", "injected"))
              : option("get-wallet", <Wallet size={16} />, "Get QIE Wallet", "No browser wallet found on this device", () => window.open(QIE_WALLET_URL, "_blank", "noopener"))}
            {option(
              "reown",
              <QrCode size={16} />,
              "Reown · WalletConnect",
              w.reownAvailable ? "QIE Wallet app, MetaMask, Trust and 700+ wallets, by QR code or on your phone" : "Not set up on this site yet",
              () => void goWallet("reown", "reown"),
              !w.reownAvailable,
            )}
          </div>
        )}

        {err && (
          <p className="mt-3 rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-xs text-bad" data-testid="signin-error">
            {err}
          </p>
        )}
        <p className="mt-4 text-[11px] leading-snug text-faint">
          You stay signed in on this browser for 7 days. Every bet, post and claim still asks your wallet to confirm.
        </p>
      </div>
    </div>,
    document.body,
  );
}
