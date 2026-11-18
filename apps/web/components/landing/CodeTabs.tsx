"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** Terminal-style code panel with tabs and copy, for the "prove it yourself" section. */
export function CodeTabs({ tabs }: { tabs: { label: string; code: string }[] }) {
  const [i, setI] = useState(0);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tabs[i].code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  };
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#09090b] text-[#e9e7e1]">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-2 py-2">
        <div className="flex gap-1">
          {tabs.map((t, k) => (
            <button
              key={t.label}
              onClick={() => setI(k)}
              className={"num rounded-md px-3 py-1.5 text-xs transition-colors " + (k === i ? "bg-white/10 text-white" : "text-white/45 hover:text-white/80")}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button onClick={() => void copy()} className="mr-1 rounded-md p-1.5 text-white/45 hover:bg-white/10 hover:text-white" aria-label="Copy code">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <pre className="num overflow-x-auto p-5 text-[12.5px] leading-relaxed text-white/85">
        <code>{tabs[i].code}</code>
      </pre>
    </div>
  );
}
