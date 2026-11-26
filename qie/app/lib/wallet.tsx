"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BaseError, ContractFunctionRevertedError, createWalletClient, custom, getAddress, type Abi, type Address, type EIP1193Provider } from "viem";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import { publicClient } from "./chain";
import { EXPLORER, qie, REOWN_PROJECT_ID, RPC_URL } from "./config";
import { qieIdOf } from "./qieid";

interface Announced {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
}

declare global {
  interface Window {
    qie?: EIP1193Provider;
    ethereum?: EIP1193Provider;
  }
}

/** QIE Wallet first (EIP-6963 rdns `me.qiewallet`, then `window.qie`), then any injected wallet. */
function pickProvider(announced: Announced[]): { provider: EIP1193Provider; name: string } | null {
  const q = announced.find((a) => a.info.rdns === "me.qiewallet");
  if (q) return { provider: q.provider, name: "QIE Wallet" };
  if (typeof window !== "undefined" && window.qie) return { provider: window.qie, name: "QIE Wallet" };
  if (announced[0]) return { provider: announced[0].provider, name: announced[0].info.name };
  if (typeof window !== "undefined" && window.ethereum) return { provider: window.ethereum, name: "Browser wallet" };
  return null;
}

const CHAIN_HEX = "0x" + qie.id.toString(16);

/** Contract errors in plain words (custom error names from ThesisCalls). */
const REASONS: Record<string, string> = {
  Paused: "Trading is paused.",
  FeedNotEnabled: "That market isn't available.",
  StaleOracle: "The oracle price is too old right now; try again after the next update.",
  StaleVolatility: "Volatility hasn't been updated recently; try again soon.",
  BadPrice: "The oracle returned no usable price.",
  StrikeWrongSide: "The target must be above the price for a long call, below it for a short.",
  StrikeDistance: "The target is too close to or too far from the current price.",
  BadWindow: "Pick a deadline inside the allowed window.",
  OddsOutOfRange: "That call is too likely or too unlikely to open (odds must be 1%–99%).",
  BadSeed: "The seed is outside the allowed range.",
  TextTooLong: "Keep the reason under 280 characters.",
  CallClosed: "This call is closed for new bets.",
  StakeTooSmall: "That's below the minimum bet.",
  AlreadyFinal: "Already settled.",
  ProofTooLate: "The proof window has closed.",
  RoundOutsideWindow: "That oracle round is outside the call's window.",
  NoTouch: "That oracle round didn't reach the target.",
  TooEarly: "It can't settle yet.",
  NotSettled: "Not settled yet.",
  NothingToClaim: "Nothing to claim.",
  SyncRequired: "The oracle has many new rounds; press “Check the oracle” first.",
  NearStrike: "The price is right at the target: betting pauses until it moves away.",
  Unauthorized: "This wallet isn't allowed to do that.",
};

export function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = revert?.data?.errorName;
    if (name && REASONS[name]) return REASONS[name];
    if (/User rejected|denied|4001/i.test(e.message)) return "You rejected the request in your wallet.";
    if (/insufficient funds/i.test(e.message)) return "Not enough QIE for gas.";
    if (/ERC20InsufficientBalance|exceeds balance/i.test(e.message)) return "Not enough QUSDC.";
    return e.shortMessage;
  }
  return (e as Error)?.message ?? String(e);
}

export interface Toast {
  id: number;
  label: string;
  status: "pending" | "confirmed" | "failed";
  hash?: string;
  error?: string;
}

/** How the wallet is connected: a browser wallet (QIE Wallet first) or Reown (WalletConnect). */
export type Via = "injected" | "reown" | "qieid";

/** Result of a completed Sign in with QIE ID (from the server function). */
export interface QieIdLogin {
  address: Address;
  qieId: string;
  verified: boolean;
  expiresAt: number;
}

/** A signed-in session: proof (an EIP-4361 signature) that this browser's user controls `address`. */
export interface Session {
  address: Address;
  /** QIE ID found for the address (display only). */
  name: string | null;
  /** QIE Pass: true if QIE says the user is identity-verified, null if not checked. */
  qiePass: boolean | null;
  via: Via;
  issuedAt: number;
  expiresAt: number;
  message: string;
  signature: string;
}

interface WalletState {
  /** A browser wallet was found. */
  available: boolean;
  /** Reown is configured (a project ID is set). */
  reownAvailable: boolean;
  walletName: string | null;
  account: Address | null;
  /** QIE ID of the connected account, if it has one. */
  qieName: string | null;
  session: Session | null;
  chainOk: boolean;
  /** Opens the sign-in dialog; resolves once signed in (rejects silently if closed). */
  connect(): Promise<void>;
  /**
   * Connects through `via`, signs the sign-in message and asks QIE Pass whether
   * the wallet is verified. With `requirePass`, an unverified wallet isn't signed in.
   */
  signIn(via: "injected" | "reown", opts?: { requirePass?: boolean }): Promise<void>;
  /** Opens the session from a completed Sign in with QIE ID (the server has already checked it). */
  adoptQieIdLogin(login: QieIdLogin): void;
  disconnect(): void;
  signInOpen: boolean;
  closeSignIn(): void;
  /** Sends a contract write and waits for it; shows a toast; throws on failure. */
  write(label: string, call: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }): Promise<string>;
  toasts: Toast[];
  dismiss(id: number): void;
}

const Ctx = createContext<WalletState | null>(null);
const SESSION_KEY = "thesis-qie-session";
/** Server function that checks a sign-in signature with QIE Pass (netlify/functions/qie-pass.mjs). */
export const QIE_PASS_URL = "/.netlify/functions/qie-pass";
const SESSION_DAYS = 7;

function loadSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as Session | null;
    return s && s.expiresAt > Date.now() ? s : null;
  } catch {
    return null;
  }
}

type WcProvider = EIP1193Provider & { session?: unknown; connect(): Promise<void>; disconnect(): Promise<void>; enable(): Promise<string[]> };
let wcPromise: Promise<WcProvider> | null = null;
/** Reown (WalletConnect) provider, loaded on first use: QR code on desktop, wallet apps on phones. */
function reownProvider(): Promise<WcProvider> {
  if (!wcPromise) {
    wcPromise = import("@walletconnect/ethereum-provider").then(
      ({ EthereumProvider }) =>
        EthereumProvider.init({
          projectId: REOWN_PROJECT_ID,
          optionalChains: [qie.id],
          rpcMap: { [qie.id]: RPC_URL },
          showQrModal: true,
          metadata: {
            name: "Thesis on QIE",
            description: "Prove you called it: trade calls as markets on QIE.",
            url: typeof window !== "undefined" ? window.location.origin : "https://thesis-qie.netlify.app",
            icons: [typeof window !== "undefined" ? `${window.location.origin}/icon.svg` : ""],
          },
        }) as unknown as Promise<WcProvider>,
    );
    wcPromise.catch(() => (wcPromise = null));
  }
  return wcPromise;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [announced, setAnnounced] = useState<Announced[]>([]);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [tick, setTick] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [qieName, setQieName] = useState<string | null>(null);
  const [via, setVia] = useState<Via | null>(null);
  const [wc, setWc] = useState<WcProvider | null>(null);
  // After Sign in with QIE ID: the wallet linked for signing transactions, once needed.
  const [signer, setSigner] = useState<EIP1193Provider | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const waiters = useRef<{ resolve(): void; reject(e: Error): void }[]>([]);

  // EIP-6963 discovery.
  useEffect(() => {
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent<Announced>).detail;
      setAnnounced((xs) => (xs.some((x) => x.info.uuid === d.info.uuid) ? xs : [...xs, d]));
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const t = setTimeout(() => setTick((x) => x + 1), 400); // re-pick after late injections
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(t);
    };
  }, []);

  // Picked after mount, so the first render matches the prebuilt HTML (no wallet on the server).
  const [picked, setPicked] = useState<{ provider: EIP1193Provider; name: string } | null>(null);
  useEffect(() => setPicked(pickProvider(announced)), [announced, tick]);

  // The provider in use: Reown once connected through it, else the browser wallet.
  const active = via === "reown" ? wc : via === "qieid" ? signer : (picked?.provider ?? null);

  // Restore a signed-in session: reconnect silently through the same route, and
  // keep it only if the wallet still has that account.
  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    if (s.via === "injected" && picked) {
      picked.provider
        .request({ method: "eth_accounts" })
        .then((a) => {
          if ((a as string[]).some((x) => x.toLowerCase() === s.address.toLowerCase())) {
            setVia("injected");
            setAccount(s.address);
            setSession(s);
          }
        })
        .catch(() => {});
    }
    if (s.via === "qieid") {
      // The server's sealed session cookie is the truth; the copy here is for display.
      fetch(`${QIE_PASS_URL}?action=me`, { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .then((m: QieIdLogin | null) => {
          if (m && m.address.toLowerCase() === s.address.toLowerCase()) {
            setVia("qieid");
            setAccount(s.address);
            setSession({ ...s, name: m.qieId, qiePass: m.verified });
          } else localStorage.removeItem(SESSION_KEY);
        })
        .catch(() => {});
    }
    if (s.via === "reown" && REOWN_PROJECT_ID) {
      reownProvider()
        .then(async (p) => {
          if (!p.session) return;
          const a = (await p.request({ method: "eth_accounts" })) as string[];
          if (a.some((x) => x.toLowerCase() === s.address.toLowerCase())) {
            setWc(p);
            setVia("reown");
            setAccount(s.address);
            setSession(s);
          }
        })
        .catch(() => {});
    }
  }, [picked]);

  // Follow the active wallet's account and network. Switching accounts ends the session.
  useEffect(() => {
    const p = active;
    if (!p || !account) return;
    const onAccounts = (a: unknown) => {
      const next = ((a as string[])[0] as Address | undefined) ?? null;
      if (!next || next.toLowerCase() !== account.toLowerCase()) {
        localStorage.removeItem(SESSION_KEY);
        setSession(null);
        setAccount(null);
        setVia(null);
      }
    };
    const onChain = (c: unknown) => setChainId(String(c).toLowerCase());
    p.request({ method: "eth_chainId" }).then(onChain).catch(() => {});
    p.on?.("accountsChanged", onAccounts as never);
    p.on?.("chainChanged", onChain as never);
    return () => {
      p.removeListener?.("accountsChanged", onAccounts as never);
      p.removeListener?.("chainChanged", onChain as never);
    };
  }, [active, account]);

  // The connected account's QIE ID, for display.
  useEffect(() => {
    setQieName(session?.name ?? null);
    if (!account) return;
    let live = true;
    qieIdOf(account)
      .then((n) => live && n && setQieName(n))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [account, session?.name]);

  const ensureChain = useCallback(async (p: EIP1193Provider) => {
    const current = String(await p.request({ method: "eth_chainId" })).toLowerCase();
    if (current === CHAIN_HEX) return setChainId(CHAIN_HEX);
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
    } catch (e) {
      if ((e as { code?: number }).code !== 4902) throw e;
      await p.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: CHAIN_HEX, chainName: qie.name, nativeCurrency: qie.nativeCurrency, rpcUrls: [RPC_URL], blockExplorerUrls: EXPLORER ? [EXPLORER] : undefined }],
      });
    }
    setChainId(CHAIN_HEX);
  }, []);

  const signIn = useCallback<WalletState["signIn"]>(
    async (route, opts) => {
      // 2. Connect.
      let p: EIP1193Provider;
      if (route === "reown") {
        if (!REOWN_PROJECT_ID) throw new Error("Reown isn't set up on this site yet.");
        const r = await reownProvider();
        if (!r.session) await r.connect();
        setWc(r);
        p = r;
      } else {
        if (!picked) throw new Error("No browser wallet found. Install QIE Wallet, or use Reown.");
        p = picked.provider;
      }
      const accounts = (await p.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts[0]) throw new Error("The wallet didn't share an account.");
      const address = getAddress(accounts[0]);
      await ensureChain(p);
      // 3. Sign the sign-in message (EIP-4361): free, no transaction.
      const name = await qieIdOf(address).catch(() => null);
      const issued = new Date();
      const expires = new Date(issued.getTime() + SESSION_DAYS * 86_400_000);
      const message = createSiweMessage({
        domain: window.location.host,
        uri: window.location.origin,
        address,
        chainId: qie.id,
        nonce: generateSiweNonce(),
        version: "1",
        issuedAt: issued,
        expirationTime: expires,
        statement: name ? `Sign in to Thesis on QIE as ${name}.` : "Sign in to Thesis on QIE.",
      });
      const wallet = createWalletClient({ chain: qie, transport: custom(p), account: address });
      const signature = await wallet.signMessage({ account: address, message });
      const ok = await publicClient.verifyMessage({ address, message, signature }).catch(() => false);
      if (!ok) throw new Error("That signature doesn't match the wallet's address.");
      // 4. QIE Pass: the server checks the signature and asks QIE whether this wallet is verified.
      let qiePass: boolean | null = null;
      try {
        const res = await fetch(`${QIE_PASS_URL}?action=verify-wallet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) });
        const body = (await res.json().catch(() => ({}))) as { verified?: boolean; error?: string };
        if (res.ok && typeof body.verified === "boolean") qiePass = body.verified;
        else if (opts?.requirePass) throw new Error(body.error ?? "QIE Pass couldn't be checked right now. Try again.");
      } catch (e) {
        if (opts?.requirePass) throw e instanceof Error && e.message ? e : new Error("QIE Pass couldn't be checked right now. Try again.");
      }
      if (opts?.requirePass && !qiePass) {
        throw new Error("This wallet isn't verified with QIE Pass yet. Complete verification in the QIE Wallet app, or sign in with your wallet.");
      }
      const s: Session = { address, name, qiePass, via: route, issuedAt: issued.getTime(), expiresAt: expires.getTime(), message, signature };
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      setVia(route);
      setAccount(address);
      setSession(s);
      setSignInOpen(false);
      for (const w of waiters.current.splice(0)) w.resolve();
    },
    [picked, ensureChain],
  );

  const connect = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        waiters.current.push({ resolve, reject });
        setSignInOpen(true);
      }),
    [],
  );

  const closeSignIn = useCallback(() => {
    setSignInOpen(false);
    // An empty message: callers show nothing for a closed dialog.
    for (const w of waiters.current.splice(0)) w.reject(new Error(""));
  }, []);

  const adoptQieIdLogin = useCallback((login: QieIdLogin) => {
    const s: Session = { address: getAddress(login.address), name: login.qieId, qiePass: login.verified, via: "qieid", issuedAt: Date.now(), expiresAt: login.expiresAt, message: "", signature: "" };
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    setSigner(null);
    setVia("qieid");
    setAccount(s.address);
    setSession(s);
    setSignInOpen(false);
    for (const w of waiters.current.splice(0)) w.resolve();
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    if (via === "reown" || (via === "qieid" && signer === wc)) void wc?.disconnect().catch(() => {});
    if (via === "qieid") void fetch(`${QIE_PASS_URL}?action=logout`, { method: "POST", credentials: "same-origin" }).catch(() => {});
    setSession(null);
    setAccount(null);
    setSigner(null);
    setVia(null);
  }, [via, wc, signer]);

  /**
   * Signed in with QIE ID: sign-in proves the account, but transactions still
   * need that wallet. Link it the first time one is sent: the browser wallet
   * if it has the account, else Reown.
   */
  const linkSigner = useCallback(async (): Promise<EIP1193Provider> => {
    if (!account) throw new Error("Sign in first.");
    const short = `${account.slice(0, 6)}…${account.slice(-4)}`;
    if (picked) {
      const a = ((await picked.provider.request({ method: "eth_requestAccounts" })) as string[]).map((x) => x.toLowerCase());
      if (a.includes(account.toLowerCase())) {
        setSigner(picked.provider);
        return picked.provider;
      }
      if (!REOWN_PROJECT_ID) throw new Error(`Your QIE ID is on ${short}. Switch your wallet to that account to continue.`);
    }
    if (REOWN_PROJECT_ID) {
      const r = await reownProvider();
      if (!r.session) await r.connect();
      setWc(r);
      const a = ((await r.request({ method: "eth_accounts" })) as string[]).map((x) => x.toLowerCase());
      if (a.includes(account.toLowerCase())) {
        setSigner(r);
        return r;
      }
      throw new Error(`Your QIE ID is on ${short}, but the connected wallet isn't. Connect that wallet to continue.`);
    }
    throw new Error(`Connect the wallet ${short} to continue: install QIE Wallet in this browser.`);
  }, [account, picked]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const write = useCallback<WalletState["write"]>(
    async (label, call) => {
      if (!account) throw new Error("Sign in first.");
      const p = active ?? (via === "qieid" ? await linkSigner() : null);
      if (!p) throw new Error("Sign in first.");
      const id = Date.now() + Math.random();
      const set = (patch: Partial<Toast>) => setToasts((t) => t.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      setToasts((t) => [...t.slice(-3), { id, label, status: "pending" }]);
      try {
        await ensureChain(p);
        // Simulate first: a revert shows its reason instead of a failed transaction.
        const { request } = await publicClient.simulateContract({ ...call, account } as never);
        const wallet = createWalletClient({ chain: qie, transport: custom(p), account });
        const hash = await wallet.writeContract(request as never);
        set({ hash });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("The transaction reverted.");
        set({ status: "confirmed" });
        setTimeout(() => dismiss(id), 8000);
        return hash;
      } catch (e) {
        set({ status: "failed", error: explain(e) });
        throw e;
      }
    },
    [active, account, via, linkSigner, ensureChain, dismiss],
  );

  const value = useMemo<WalletState>(
    () => ({
      available: !!picked,
      reownAvailable: !!REOWN_PROJECT_ID,
      walletName: via === "reown" ? "Reown · WalletConnect" : via === "qieid" ? "QIE ID" : (picked?.name ?? null),
      account,
      qieName,
      session,
      chainOk: chainId === CHAIN_HEX,
      connect,
      signIn,
      adoptQieIdLogin,
      disconnect,
      signInOpen,
      closeSignIn,
      write,
      toasts,
      dismiss,
    }),
    [picked, via, account, qieName, session, chainId, connect, signIn, adoptQieIdLogin, disconnect, signInOpen, closeSignIn, write, toasts, dismiss],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}
