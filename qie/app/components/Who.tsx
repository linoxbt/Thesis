"use client";

import { useEffect, useState } from "react";
import { shortAddr } from "@/lib/format";
import { qieIdOf } from "@/lib/qieid";

/** The QIE ID of an address once looked up, or null. */
export function useQieName(addr: string | null | undefined): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    setName(null);
    if (!addr) return;
    let live = true;
    qieIdOf(addr)
      .then((n) => live && setName(n))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [addr]);
  return name;
}

/** A wallet shown by its QIE ID (alex.qie) when it has one, else as 0x1234…abcd. */
export function Who({ addr, className = "" }: { addr: string; className?: string }) {
  const name = useQieName(addr);
  return (
    <span className={(name ? "" : "num ") + className} title={addr} data-qieid={name ?? undefined}>
      {name ?? shortAddr(addr)}
    </span>
  );
}
