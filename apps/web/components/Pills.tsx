"use client";

/** Pill tabs, styled like timeframe selectors on a trading chart. */
export function Pills<T extends string>({ items, value, onChange }: { items: readonly { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 rounded-full border border-line bg-panel p-1" role="tablist">
      {items.map((s) => (
        <button
          key={s.key}
          role="tab"
          aria-selected={value === s.key}
          onClick={() => onChange(s.key)}
          className={"num rounded-full px-3 py-1 text-xs transition-colors " + (value === s.key ? "bg-ink text-bg" : "text-muted hover:text-ink")}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
