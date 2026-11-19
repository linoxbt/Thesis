"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Check, Copy, ExternalLink, LogOut, RefreshCw, Wallet, Zap } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Positions } from "@/components/Positions";
import { ProfileStats, type ProfileData } from "@/components/ProfileStats";
import { Avatar } from "@/components/ThesisCard";
import { usePoll } from "@/lib/client/api";
import { explorerAccount, IS_DEVNET } from "@/lib/client/config";
import { shortAddr } from "@/lib/client/format";
import { useConfig } from "@/lib/client/useConfig";
import { useActiveWallet, useBurner, useConnection, type ActiveWallet } from "@/lib/client/wallet";
import { cleanProfile, profileMessage } from "@/lib/profileMessage";
import { ThemeSetting } from "@/components/ThemeToggle";
import { TelegramAlerts } from "@/components/TelegramAlerts";

/** Your Profile: name and X handle (wallet-signed), wallet and balances, and your record. */
export default function ProfilePage() {
  const active = useActiveWallet();
  if (!active) return <SignedOut />;
  return <SignedIn wallet={active} />;
}

function SignedOut() {
  const { createBurner } = useBurner();
  const { setVisible } = useWalletModal();
  return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-panel-3 text-ink">
        <Wallet size={22} />
      </div>
      <h1 className="display mt-6 text-4xl">Your profile</h1>
      <p className="mt-3 text-muted">
        Your wallet is your account. Connect one to see your calls, positions and earnings, and to set the name people see on
        your calls.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-2">
        {IS_DEVNET && (
          <button onClick={() => void createBurner()} className="btn btn-primary">
            <Zap size={14} /> Try it free
          </button>
        )}
        <button onClick={() => setVisible(true)} className="btn btn-ghost">
          Connect a wallet
        </button>
      </div>
      <div className="mt-10 text-left">
        <Settings wallet={null} />
      </div>
    </div>
  );
}

/** Appearance (any visitor) and Telegram alerts (needs a wallet). */
function Settings({ wallet }: { wallet: ActiveWallet | null }) {
  return (
    <section className="panel p-6" data-testid="settings">
      <h2 className="text-lg font-semibold tracking-[-0.02em]">Settings</h2>
      <div className="mt-4">
        <div className="text-sm">Appearance</div>
        <p className="mb-2 mt-0.5 text-xs text-faint">Light is the default. Saved in this browser.</p>
        <ThemeSetting />
      </div>
      {wallet && (
        <div className="mt-6 border-t border-line pt-5">
          <TelegramAlerts wallet={wallet} />
        </div>
      )}
    </section>
  );
}

function SignedIn({ wallet }: { wallet: ActiveWallet }) {
  const addr = wallet.publicKey.toBase58();
  const { data, reload } = usePoll<ProfileData>(`/api/profiles/${addr}`, 30_000);
  const name = data?.profile?.display_name;
  return (
    <div className="space-y-6">
      <header className="panel flex flex-wrap items-center justify-between gap-5 p-6">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar addr={addr} size={60} />
          <div className="min-w-0">
            <span className="label">Profile</span>
            <h1 className="display mt-1 truncate text-3xl sm:text-4xl" data-testid="profile-name">
              {name ?? <span className="text-muted">Unnamed trader</span>}
            </h1>
            <div className="num mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span className="rounded-full bg-panel-3 px-2 py-0.5">{wallet.name}</span>
              <CopyAddress addr={addr} />
              {data?.profile?.x_handle && (
                <a href={`https://x.com/${data.profile.x_handle}`} target="_blank" rel="noreferrer" className="hover:text-ink">
                  @{data.profile.x_handle}
                </a>
              )}
            </div>
          </div>
        </div>
        <Link href={`/u/${addr}`} className="btn btn-ghost text-sm">
          Public view <ExternalLink size={13} />
        </Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <EditProfile wallet={wallet} current={data?.profile ?? null} onSaved={() => void reload()} />
        <WalletPanel wallet={wallet} />
      </div>

      <section className="panel p-6">
        <span className="label">Positions</span>
        <div className="mt-3">
          {data ? <Positions owner={addr} markets={data.markets ?? []} /> : <p className="text-sm text-muted">Loading…</p>}
        </div>
      </section>

      <Settings wallet={wallet} />

      <div>
        <span className="label">Activity</span>
        <div className="mt-3 space-y-4">{data ? <ProfileStats data={data} /> : <p className="text-sm text-muted">Loading…</p>}</div>
      </div>
    </div>
  );
}

function CopyAddress({ addr }: { addr: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <a href={explorerAccount(addr)} target="_blank" rel="noreferrer" className="underline decoration-line-2 underline-offset-4 hover:text-ink">
        {shortAddr(addr)}
      </a>
      <button
        onClick={() => void navigator.clipboard.writeText(addr).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1200)))}
        className="rounded p-0.5 hover:text-ink"
        aria-label="Copy address"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </span>
  );
}

function EditProfile({
  wallet,
  current,
  onSaved,
}: {
  wallet: ActiveWallet;
  current: ProfileData["profile"];
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "saving" | "saved" | "error"; msg?: string }>({ kind: "idle" });
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (touched) return;
    setDisplayName(current?.display_name ?? "");
    setXHandle(current?.x_handle ?? "");
  }, [current, touched]);

  // Each signed edit must be newer than the last: two saves in one second
  // would otherwise share a timestamp and the second be refused as a replay.
  const lastIssued = useRef(0);
  const save = useCallback(async () => {
    const f = cleanProfile(displayName, xHandle);
    if ("error" in f) return setState({ kind: "error", msg: f.error });
    if (!wallet.signMessage) return setState({ kind: "error", msg: "This wallet can't sign messages." });
    setState({ kind: "saving" });
    try {
      const issuedAt = Math.max(Math.floor(Date.now() / 1000), lastIssued.current + 1);
      lastIssued.current = issuedAt;
      const addr = wallet.publicKey.toBase58();
      const sig = await wallet.signMessage(new TextEncoder().encode(profileMessage(addr, f, issuedAt)));
      const r = await fetch(`/api/profiles/${addr}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display_name: f.displayName, x_handle: f.xHandle, issued_at: issuedAt, signature: Buffer.from(sig).toString("base64") }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.status === 401 && /expired/.test(String(body.error))) {
        throw new Error("The signature's time is off from the server's. Check that your device clock is set automatically, then save again.");
      }
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setState({ kind: "saved" });
      setTouched(false);
      onSaved();
    } catch (e) {
      const msg = (e as Error).message;
      setState({ kind: "error", msg: /reject|denied|cancel/i.test(msg) ? "Signature cancelled." : msg });
    }
  }, [displayName, xHandle, wallet, onSaved]);

  return (
    <section className="panel p-6">
      <h2 className="text-lg font-semibold tracking-[-0.02em]">Profile details</h2>
      <p className="mt-1 text-sm text-muted">Shown on your calls and your public profile. Saving asks your wallet to sign a message; it costs nothing.</p>
      <div className="mt-5 space-y-4">
        <label className="block text-sm">
          Display name
          <div className="field mt-1.5 px-3 py-2.5">
            <input
              value={displayName}
              onChange={(e) => (setDisplayName(e.target.value), setTouched(true), setState({ kind: "idle" }))}
              maxLength={32}
              placeholder="e.g. solmaxi"
              className="w-full bg-transparent outline-none"
              data-testid="profile-display-name"
            />
          </div>
        </label>
        <label className="block text-sm">
          X handle <span className="text-faint">(optional, not verified)</span>
          <div className="field mt-1.5 flex items-center gap-1 px-3 py-2.5">
            <span className="text-faint">@</span>
            <input
              value={xHandle}
              onChange={(e) => (setXHandle(e.target.value), setTouched(true), setState({ kind: "idle" }))}
              maxLength={16}
              placeholder="handle"
              className="w-full bg-transparent outline-none"
            />
          </div>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => void save()} disabled={state.kind === "saving"} className="btn btn-primary" data-testid="profile-save">
            {state.kind === "saving" ? "Waiting for signature…" : "Save profile"}
          </button>
          {state.kind === "saved" && (
            <span className="flex items-center gap-1 text-sm text-yes" data-testid="profile-saved">
              <Check size={14} /> Saved
            </span>
          )}
          {state.kind === "error" && <span className="text-sm text-bad">{state.msg}</span>}
        </div>
      </div>
    </section>
  );
}

function WalletPanel({ wallet }: { wallet: ActiveWallet }) {
  const { connection } = useConnection();
  const { usdcMint } = useConfig();
  const adapter = useWallet();
  const { setVisible } = useWalletModal();
  const { funding, fundError, refund, forget } = useBurner();
  const [bal, setBal] = useState<{ sol: number; usdc: number } | null>(null);

  const load = useCallback(async () => {
    const sol = (await connection.getBalance(wallet.publicKey)) / 1e9;
    let usdc = 0;
    if (usdcMint) {
      const ata = getAssociatedTokenAddressSync(usdcMint, wallet.publicKey, true);
      usdc = await connection
        .getTokenAccountBalance(ata)
        .then((b) => Number(b.value.uiAmount ?? 0))
        .catch(() => 0);
    }
    setBal({ sol, usdc });
  }, [connection, wallet.publicKey, usdcMint]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (funding === "funded") void load();
  }, [funding, load]);

  return (
    <section className="panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-[-0.02em]">Wallet</h2>
        <button onClick={() => void load()} className="rounded-full p-1.5 text-muted hover:bg-panel-2 hover:text-ink" aria-label="Refresh balances">
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line">
        <div className="bg-bg px-4 py-3">
          <div className="text-xs text-muted">SOL</div>
          <div className="num mt-1 text-xl" data-testid="balance-sol">{bal ? bal.sol.toFixed(3) : "…"}</div>
        </div>
        <div className="bg-bg px-4 py-3">
          <div className="text-xs text-muted">{IS_DEVNET ? "Test USDC" : "USDC"}</div>
          <div className="num mt-1 text-xl" data-testid="balance-usdc">{bal ? bal.usdc.toFixed(2) : "…"}</div>
        </div>
      </div>

      {wallet.kind === "burner" ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-faint">Instant wallet: a devnet key stored in this browser only. Never send real funds to it.</p>
          {funding === "error" && <p className="text-xs text-bad">Funding failed: {fundError}</p>}
          <button onClick={() => void refund()} disabled={funding === "funding"} className="btn btn-ghost w-full text-sm">
            <Zap size={14} /> {funding === "funding" ? "Funding…" : "Top up test funds"}
          </button>
          <button onClick={() => setVisible(true)} className="btn btn-ghost w-full text-sm">
            Use a real wallet instead
          </button>
          <button
            onClick={() => {
              if (confirm("Forget this instant wallet? Its key is only in this browser; anything left in it is lost.")) forget();
            }}
            className="btn w-full text-sm text-bad hover:bg-panel-2"
          >
            Forget this wallet
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <button onClick={() => void adapter.disconnect()} className="btn btn-ghost w-full text-sm">
            <LogOut size={14} /> Disconnect {wallet.name}
          </button>
        </div>
      )}
    </section>
  );
}
