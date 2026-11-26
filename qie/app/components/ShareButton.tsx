"use client";

import { Check, Download, Link2, Share2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { drawCard, type CardData } from "@/lib/shareCard";

/**
 * Share a call with its card image (drawn in the browser from chain data).
 * Phones open the system share sheet with the PNG attached, so picking X
 * posts the image with the text and link. Desktop gets a dialog: the card,
 * a pre-filled post on X, "Download image" to attach it there, or copy link.
 */
export function ShareButton({ id, text, card }: { id: number; text: string; card: CardData }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const url = typeof window !== "undefined" ? `${window.location.origin}/t/?id=${id}` : `/t/?id=${id}`;
  const key = JSON.stringify(card);

  // Draw the card up front: a share sheet must open inside the tap.
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    drawCard(card)
      .then((b) => {
        if (!alive) return;
        setFile(new File([b], `thesis-call-${id}.png`, { type: "image/png" }));
        objectUrl = URL.createObjectURL(b);
        setPreview(objectUrl);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key, id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setOpen(false);
      // Keep Tab inside the dialog.
      const box = closeRef.current?.closest('[role="dialog"]');
      if (e.key !== "Tab" || !box) return;
      const f = [...box.querySelectorAll<HTMLElement>("button, a[href]")];
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const onClick = async () => {
    const touch = matchMedia("(pointer: coarse)").matches;
    if (touch && file && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
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
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center" onClick={() => setOpen(false)}>
            <div
              className="panel w-full max-w-lg p-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Share this trade"
              data-testid="share-menu"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold">Share this trade</span>
                <button ref={closeRef} onClick={() => setOpen(false)} className="rounded-full p-1 text-muted hover:bg-panel-2 hover:text-ink" aria-label="Close">
                  <X size={16} />
                </button>
              </div>
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="Share card for this trade" className="w-full rounded-lg border border-line" data-testid="share-card" />
              ) : (
                <div className="grid aspect-[1200/630] w-full place-items-center rounded-lg border border-line text-xs text-muted">Drawing the card…</div>
              )}
              <p className="num mt-3 rounded-lg border border-line bg-panel-2 p-3 text-xs leading-relaxed text-muted">
                {text} {url}
              </p>
              <div className="mt-3 grid gap-1 text-sm">
                <a href={intent} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg bg-ink px-3 py-2.5 font-medium text-bg hover:opacity-90">
                  <span className="text-[13px] font-bold">𝕏</span> Post on X
                  <span className="ml-auto text-xs font-normal opacity-70">then attach the image</span>
                </a>
                {preview && (
                  <a href={preview} download={`thesis-call-${id}.png`} className="flex items-center gap-2 rounded-lg px-3 py-2.5 hover:bg-panel-2" data-testid="share-download">
                    <Download size={15} /> Download image
                  </a>
                )}
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
