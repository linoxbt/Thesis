"use client";

import { ArrowLeft, ArrowRight, Loader2, ShieldCheck, Wallet, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { onModalChange } from "@/lib/appkit";
import { openQieIdWidget } from "@/lib/qieidWidget";
import { explain, QIE_PASS_URL, useWallet, type QieIdLogin } from "@/lib/wallet";

type Flow =
  | { step: "pick" }
  | { step: "qieid" }
  | { step: "starting" }
  | { step: "code"; qieId: string; code: string; expiresAt: number }
  | { step: "ended"; message: string };

const api = (action: string, init?: RequestInit) => fetch(`${QIE_PASS_URL}?action=${action}`, { credentials: "same-origin", ...init });
const post = (action: string, body: unknown = {}) => api(action, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

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
  const [retryAt, setRetryAt] = useState(0);
  // Reown's picker is on screen (this dialog steps aside while it is).
  const [reownOpen, setReownOpen] = useState(false);
  const polling = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  /** Ends a sign-in in progress (stops polling; the server forgets it) and closes. */
  // Bumped whenever a sign-in is started, cancelled or closed: a response that
  // arrives for an older one is ignored (it can't sign anyone in after Cancel).
  const gen = useRef(0);

  const close = useCallback(() => {
    gen.current += 1;
    if (flow.step === "code" || flow.step === "starting") void post("cancel").catch(() => {});
    setFlow({ step: "pick" });
    w.closeSignIn();
  }, [flow.step, w]);

  useEffect(() => {
    if (!w.signInOpen) {
      // Give focus back to whatever opened the dialog.
      if (opener.current instanceof HTMLElement) opener.current.focus();
      return;
    }
    opener.current = document.activeElement;
    setErr(null);
    setBusy(null);
    setFlow({ step: "pick" });
    setTimeout(() => panel.current?.querySelector<HTMLElement>("button, input")?.focus(), 0);
  }, [w.signInOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!w.signInOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !reownOpen) close();
      // Keep Tab inside the dialog.
      if (e.key === "Tab" && panel.current) {
        const f = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), a[href]")];
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [w.signInOpen, close, reownOpen]);

  // While signing in through Reown, follow its picker: step aside while it's
  // open, come back (to "confirm in your wallet") once it closes.
  useEffect(() => {
    if (busy !== "reown") return setReownOpen(false);
    let unsub: (() => void) | null = null;
    let on = true;
    onModalChange((open) => on && setReownOpen(open))
      .then((u) => (on ? (unsub = u) : u()))
      .catch(() => {});
    setReownOpen(true);
    return () => {
      on = false;
      unsub?.();
    };
  }, [busy]);

  // While a code is shown (and the dialog is open): countdown, and poll every 2 s until it's no longer pending.
  useEffect(() => {
    if (flow.step !== "code" || !w.signInOpen) return;
    const tick = setInterval(() => setNow(Date.now()), 500);
    const poll = setInterval(async () => {
      if (polling.current) return;
      polling.current = true;
      const mine = gen.current;
      try {
        const r = await api("status");
        const b = (await r.json().catch(() => ({}))) as Partial<QieIdLogin> & { status?: string; message?: string; expiresAt?: string | number };
        if (mine !== gen.current) return; // cancelled meanwhile
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
    const mine = ++gen.current;
    setErr(null);
    setFlow({ step: "starting" });
    try {
      const r = await post("start", { qieId });
      const b = (await r.json().catch(() => ({}))) as { code?: string; qieId?: string; expiresAt?: string; message?: string; retryAfterSeconds?: number };
      if (mine !== gen.current) {
        // Closed or cancelled while starting: forget it on the server too.
        if (r.status === 202) void post("cancel").catch(() => {});
        return;
      }
      if (r.status === 202 && b.code && b.expiresAt) {
        setNow(Date.now());
        setFlow({ step: "code", qieId: b.qieId ?? qieId, code: b.code, expiresAt: Date.parse(b.expiresAt) });
        return;
      }
      setFlow({ step: "qieid" });
      if (b.retryAfterSeconds) setRetryAt(Date.now() + b.retryAfterSeconds * 1000);
      setErr(b.message ?? "Couldn't start the sign-in. Try again.");
    } catch {
      if (mine !== gen.current) return;
      setFlow({ step: "qieid" });
      setErr("Couldn't reach the sign-in service. Try again.");
    }
  }, [qieId]);

  // Count down a "try again in" wait.
  useEffect(() => {
    if (retryAt <= Date.now()) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= retryAt) clearInterval(t);
    }, 500);
    return () => clearInterval(t);
  }, [retryAt]);

  if (!w.signInOpen || typeof document === "undefined") return null;
  // Reown's own picker takes over while it's open; this dialog returns once it closes.
  if (busy === "reown" && reownOpen) return null;

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
  // Wallet: Reown's picker (QIE Wallet first, plus every installed wallet); the browser wallet if Reown isn't set up.
  const walletVia: "injected" | "reown" | null = w.reownAvailable ? "reown" : w.available ? "injected" : null;
  const waiting = flow.step === "code" || flow.step === "starting";
  const retryIn = Math.max(0, Math.ceil((retryAt - now) / 1000));
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => !busy && !waiting && close()}>
      <div ref={panel} className="panel w-full max-w-sm p-5 shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="signin-title" data-testid="signin-modal">
        <div className="mb-4 flex items-center justify-between">
          {flow.step === "qieid" || flow.step === "ended" ? (
            <button onClick={() => (setFlow({ step: "pick" }), setErr(null))} className="-ml-1 rounded-full p-1 text-muted hover:bg-panel-2 hover:text-ink" aria-label="Back" data-testid="signin-back">
              <ArrowLeft size={16} />
            </button>
          ) : (
            <span />
          )}
          <h2 id="signin-title" className="text-base font-semibold tracking-[-0.02em]">Sign in</h2>
          <button onClick={close} className="-mr-1 rounded-full p-1 text-muted hover:bg-panel-2 hover:text-ink" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {flow.step === "pick" && busy === "reown" ? (
          <div className="text-center" data-testid="signin-confirm">
            <Loader2 size={20} className="mx-auto animate-spin text-muted" />
            <p className="mt-3 text-sm text-ink">Confirm the sign-in in your wallet</p>
            <p className="mt-1 text-xs text-muted">It&apos;s a free signature, not a transaction.</p>
            <button onClick={() => setBusy(null)} className="mt-4 text-xs text-muted underline hover:text-ink">
              Cancel
            </button>
          </div>
        ) : flow.step === "pick" ? (
          <div className="space-y-2">
            {row("signin-qiepass", <ShieldCheck size={16} />, "QIE Pass", () => (setFlow({ step: "qieid" }), setErr(null)))}
            {walletVia ? (
              row("signin-wallet", <Wallet size={16} />, "Wallet", () => void connect(walletVia), busy === walletVia)
            ) : (
              <>
                {row("signin-wallet", <Wallet size={16} />, "Wallet", () => {}, false, true)}
                <p className="px-1 text-xs text-muted">No wallet found in this browser. Install QIE Wallet, or use QIE Pass.</p>
              </>
            )}
          </div>
        ) : null}

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
            <button type="submit" disabled={!qieId.trim() || flow.step === "starting" || retryIn > 0} className="btn btn-primary w-full py-2.5 disabled:opacity-40" data-testid="qieid-submit">
              {flow.step === "starting" ? spinner : retryIn > 0 ? `Try again in ${retryIn}s` : "Continue"}
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
            <button onClick={() => (gen.current++, void post("cancel").catch(() => {}), setFlow({ step: "qieid" }))} className="mt-4 text-xs text-muted underline hover:text-ink" data-testid="qieid-cancel">
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
          <p className="mt-3 rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-xs text-bad" role="alert" data-testid="signin-error">
            {err}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
