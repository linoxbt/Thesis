"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

/** Stored preference. Light (Paper) is the default when nothing is stored. */
export type ThemePref = "light" | "dark" | "system";
export const THEME_KEY = "thesis-theme";

/**
 * Runs before first paint (via next/script beforeInteractive): the stored
 * preference, else light. "system" follows the device. Avoids a flash of the
 * wrong theme.
 */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_KEY}");var t=p==="dark"?"dark":p==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):"light";document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="light";}})();`;

function resolve(p: ThemePref): "light" | "dark" {
  if (p === "system") return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return p;
}

export function applyTheme(p: ThemePref) {
  const t = resolve(p);
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(THEME_KEY, p);
  } catch {}
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "light" ? "#f4f2ec" : "#0c0d10");
}

const OPTIONS: { key: ThemePref; label: string; icon: typeof Sun }[] = [
  { key: "light", label: "Light", icon: Sun },
  { key: "dark", label: "Dark", icon: Moon },
  { key: "system", label: "Match device", icon: Monitor },
];

/** Appearance setting (lives on the Profile page). */
export function ThemeSetting() {
  const [pref, setPref] = useState<ThemePref | null>(null);
  useEffect(() => {
    let p: ThemePref = "light";
    try {
      const s = localStorage.getItem(THEME_KEY);
      if (s === "dark" || s === "system") p = s;
    } catch {}
    setPref(p);
  }, []);
  // Follow the device live while "system" is chosen.
  useEffect(() => {
    if (pref !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [pref]);
  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-bg p-1" role="radiogroup" aria-label="Theme">
      {OPTIONS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          role="radio"
          aria-checked={pref === key}
          onClick={() => (applyTheme(key), setPref(key))}
          className={
            "flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors " +
            (pref === key ? "bg-ink text-bg" : "text-muted hover:text-ink")
          }
          data-testid={`theme-${key}`}
        >
          <Icon size={13} /> {label}
        </button>
      ))}
    </div>
  );
}
