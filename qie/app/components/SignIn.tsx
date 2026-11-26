"use client";

import { ArrowLeft, ArrowRight, Loader2, ShieldCheck, Wallet, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openQieIdWidget } from "@/lib/qieidWidget";
import { explain, QIE_PASS_URL, useWallet, type QieIdLogin } from "@/lib/wallet";

type Flow =
  | { step: "pick" }
  | { step: "qieid" }
  | { step: "starting" }
  | { step: "code"; qieId: string; code: string; expiresAt: number }
  | { step: "ended"; message: string };

const api = (action: string, init?: RequestInit) => fetch(`${QIE_PASS_URL}?action=${action}`, { credentials: "same-origin", ...init });

/**
 * Sign in: QIE Pass (enter your QIE ID, approve in QIE Wallet with the code
 * shown here) or a wallet (the browser wallet if there is one, else Reown,
 * which covers the QIE Wallet app and other wallets by QR code or on a phone).
 */
export function SignInDialog() {
  const w = useWallet();
  const [flow, setFlow] = useState<Flow>({ step: "pick" });
  const [qieId, setQieId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const polling = useRef(false);

  useEffect(() => {
    if (!w.signInOpen) return;
    setErr(null);
    setBusy(null);
    setFlow({ step: "pick" });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && w.closeSignIn();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [w.signInOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // While a code is shown: countdown, and poll every 2 s until it's no longer pending.
  useEffect(() => {
    if (flow.step !== "code") return;
    const tick = setInterval(() => setNow(Date.now()), 500);
    const poll = setInterval(async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        const r = await api("status");
        const b = (await r.json().catch(() => ({}))) as Partial<QieIdLogin> & { status?: string; message?: string; expiresAt?: string | number };
        if (r.ok && b.status === "completed" && b.address) {
          w.adoptQieIdLogin({ address: b.address, qieId: b.qieId!, verified: !!b.verified, expiresAt: Number(b.expiresAt) });
        } else if (r.ok && b.status === "rejected") setFlow({ step: "ended", message: "Sign-in was declined." });
        else if (r.ok && b.status === "expired") setFlow({ step: "ended", message: "Sign-in timed out." });
        else if (!r.ok && r.status !== 502) setFlow({ step: "ended", message: b.message ?? "Sign-in couldn't be completed." });
      } catch {
        /* network blip: next tick */
      } finally {
        polling.current = false;
      }
    }, 2000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [flow, w]);

  useEffect(() => {
    if (flow.step === "code" && now > flow.expiresAt + 3000) setFlow({ step: "ended", message: "Sign-in timed out." });
  }, [now, flow]);

  const start = useCallback(async () => {
    setErr(null);
    setFlow({ step: "starting" });
    try {
      const r = await api("start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ qieId }) });
      const b = (await r.json().catch(() => ({}))) as { code?: string; qieId?: string; expiresAt?: string; message?: string };
      if (r.status === 202 && b.code && b.expiresAt) {
        setNow(Date.now());
        setFlow({ step: "code", qieId: b.qieId ?? qieId, code: b.code, expiresAt: Date.parse(b.expiresAt) });
        return;
      }
      setFlow({ step: "qieid" });
      setErr(b.message ?? "Couldn't start the sign-in. Try again.");
    } catch {
      setFlow({ step: "qieid" });
      setErr("Couldn't reach the sign-in service. Try again.");
    }
  }, [qieId]);

  if (!w.signInOpen || typeof document === "undefined") return null;

  const connect = async (via: "injected" | "reown") => {
    setErr(null);
    setBusy(via);
    try {
      await w.signIn(via);
    } catch (e) {
      const m = explain(e);
      setErr(/reset|closed|cancel/i.test(m) ? null : m);
    } finally {
      setBusy(null);
    }
  };
  // Wallet: the browser wallet if there is one, else Reown (QIE Wallet app and others).
  const walletVia: "injected" | "reown" | null = w.available ? "injected" : w.reownAvailable ? "reown" : null;
  const waiting = flow.step === "code" || flow.step === "starting";
  const left = flow.step === "code" ? Math.max(0, Math.ceil((flow.expiresAt - now) / 1000)) : 0;
  const spinner = <Loader2 size={16} className="animate-spin" />;

  const row = (testid: string, icon: React.ReactNode, title: string, onClick: () => void, loading = false, disabled = false) => (
    <button
      onClick={onClick}
      disabled={disabled || !!busy}
      className="flex w-full items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3.5 text-left transition-colors hover:border-line-2 hover:bg-panel-2 disabled:opacity-50"
      data-testid={testid}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-panel-3 text-ink">{loading ? spinner : icon}</span>
      <span className="flex-1 text-sm font-medium text-ink">{title}</span>
      <ArrowRight size={15} className="text-faint" />
    </button>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      onClick={() => !busy && !waiting && w.closeSignIn()}
      role="dialog"
      aria-modal="true"
      aria-label="Sign in"
    >
      <div className="panel w-full max-w-sm p-5 shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="signin-modal">
        <div className="mb-4 flex items-center justify-between">
          {flow.step === "qieid" || flow.step === "ended" ? (
            <button onClick={() => (setFlow({ step: "pick" }), setErr(null))} className="-ml-1 rounded-full p-1 text-muted hover:bg-panel-2 hover:text-ink" aria-label="Back" data-testid="signin-back">
              <ArrowLeft size={16} />
            </button>
          ) : (
            <span />
          )}
          <h2 className="text-base font-semibold tracking-[-0.02em]">Sign in</h2>
          <button onClick={w.closeSignIn} className="-mr-1 rounded-full p-1 text-muted hover:bg-panel-2 hover:text-ink" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {flow.step === "pick" && (
          <div className="space-y-2">
            {row("signin-qiepass", <ShieldCheck size={16} />, "QIE Pass", () => (setFlow({ step: "qieid" }), setErr(null)))}
            {walletVia
              ? row("signin-wallet", <Wallet size={16} />, "Wallet", () => void connect(walletVia), busy === walletVia)
              : row("signin-wallet", <Wallet size={16} />, "Wallet", () => {}, false, true)}
            {w.available && w.reownAvailable && (
              <button onClick={() => void connect("reown")} disabled={!!busy} className="w-full pt-1 text-center text-xs text-muted underline hover:text-ink" data-testid="signin-reown">
                {busy === "reown" ? "Opening…" : "Another wallet"}
              </button>
            )}
          </div>
        )}

        {(flow.step === "qieid" || flow.step === "starting") && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (qieId.trim()) void start();
            }}
          >
            <input
              value={qieId}
              onChange={(e) => setQieId(e.target.value)}
              placeholder="yourname.qie"
              autoFocus
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              className="num field w-full px-3 py-3 text-base outline-none"
              aria-label="Your QIE ID"
              data-testid="qieid-input"
            />
            <button type="submit" disabled={!qieId.trim() || flow.step === "starting"} className="btn btn-primary w-full py-2.5 disabled:opacity-40" data-testid="qieid-submit">
              {flow.step === "starting" ? spinner : "Continue"}
            </button>
            <button type="button" onClick={() => (w.closeSignIn(), openQieIdWidget())} className="w-full text-center text-xs text-muted underline hover:text-ink" data-testid="signin-get-qieid">
              Get a QIE ID
            </button>
          </form>
        )}

        {flow.step === "code" && (
          <div className="text-center" data-testid="qieid-code-screen">
            <p className="text-sm text-muted">Enter this code in QIE Wallet</p>
            <div className="num my-4 text-[44px] font-semibold leading-none tracking-[0.3em] text-ink" data-testid="qieid-code" aria-live="polite">
              {flow.code}
            </div>
            <p className="num text-xs text-faint" data-testid="qieid-countdown">
              {flow.qieId} · {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} left
            </p>
            <button onClick={() => setFlow({ step: "qieid" })} className="mt-4 text-xs text-muted underline hover:text-ink">
              Cancel
            </button>
          </div>
        )}

        {flow.step === "ended" && (
          <div className="text-center" data-testid="qieid-ended">
            <p className="text-sm text-ink" data-testid="qieid-ended-message">
              {flow.message}
            </p>
            <button onClick={() => void start()} className="btn btn-primary mt-4 w-full" data-testid="qieid-restart">
              Start again
            </button>
          </div>
        )}

        {err && (
          <p className="mt-3 rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-xs text-bad" data-testid="signin-error">
            {err}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
