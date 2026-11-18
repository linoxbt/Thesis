"use client";

import { Check, Download, Link2, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Share a thesis with its card image.
 *
 * Phones (Web Share API with files): the system share sheet opens with the
 * PNG attached, so picking X posts the image itself with the text and link.
 * Desktop: X's web intent can't carry a file, so "Post on X" opens a
 * pre-filled post whose link unfurls into the same image (og:image, large
 * card), and "Download image" saves the PNG to attach by hand.
 */
export function ShareButton({ pda, text }: { pda: string; text: string }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [copied, setCopied] = useState(false);
  const img = `/api/og/thesis/${pda}`;
  const url = typeof window !== "undefined" ? `${window.location.origin}/t/${pda}` : `/t/${pda}`;

  // Fetch the card up front: the share sheet must open inside the tap.
  useEffect(() => {
    let alive = true;
    fetch(img)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => alive && b && setFile(new File([b], `thesis-${pda.slice(0, 6)}.png`, { type: "image/png" })))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [img, pda]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const onClick = async () => {
    if (file && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: `${text} ${url}` });
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt="Share card for this trade" className="aspect-[1200/630] w-full rounded-lg border border-line object-cover" />
            <div className="mt-3 grid gap-1 text-sm">
              <a href={intent} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg bg-ink px-3 py-2.5 font-medium text-bg hover:opacity-90" onClick={() => setOpen(false)}>
                <span className="text-[13px] font-bold">𝕏</span> Post on X
                <span className="ml-auto text-[11px] opacity-70">the link unfurls into this card</span>
              </a>
              <a href={img} download={`thesis-${pda.slice(0, 6)}.png`} className="flex items-center gap-2 rounded-lg px-3 py-2.5 hover:bg-panel-2" data-testid="share-download">
                <Download size={15} /> Download image <span className="ml-auto text-[11px] text-faint">to attach yourself</span>
              </a>
              <button
                onClick={() => void navigator.clipboard.writeText(url).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1200)))}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left hover:bg-panel-2"
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
