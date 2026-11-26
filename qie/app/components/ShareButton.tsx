"use client";

import { Check, Link2, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Share a call. Phones open the system share sheet; desktop gets a small
 * menu: a pre-filled post on X, or copy the link.
 */
export function ShareButton({ id, text }: { id: number; text: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/t/?id=${id}` : `/t/?id=${id}`;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const onClick = async () => {
    const touch = typeof window !== "undefined" && matchMedia("(pointer: coarse)").matches;
    if (touch && typeof navigator.share === "function") {
      try {
        await navigator.share({ text, url });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    setOpen((o) => !o);
  };

  const intent = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  return (
    <>
      <button onClick={() => void onClick()} className="btn btn-ghost px-3 py-1.5 text-xs" data-testid="share-button">
        <Share2 size={13} /> Share on X
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
            onClick={() => setOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Share this trade"
          >
            <div className="panel w-full max-w-md p-4 shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="share-menu">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold">Share this trade</span>
                <button onClick={() => setOpen(false)} className="rounded-full p-1 text-muted hover:bg-panel-2 hover:text-ink" aria-label="Close">
                  <X size={16} />
                </button>
              </div>
              <p className="num rounded-lg border border-line bg-panel-2 p-3 text-xs leading-relaxed text-muted">
                {text} {url}
              </p>
              <div className="mt-3 grid gap-1 text-sm">
                <a href={intent} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg bg-ink px-3 py-2.5 font-medium text-bg hover:opacity-90" onClick={() => setOpen(false)}>
                  <span className="text-[13px] font-bold">𝕏</span> Post on X
                </a>
                <button
                  onClick={() => void navigator.clipboard.writeText(url).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1200)))}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left hover:bg-panel-2"
                  data-testid="share-copy"
                >
                  {copied ? <Check size={15} /> : <Link2 size={15} />} {copied ? "Link copied" : "Copy link"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
