"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

/** Old call links (/call/?id=N) now open the trade page. */
function Redirect() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  useEffect(() => router.replace(id ? `/t/?id=${id}` : "/app/"), [id, router]);
  return <p className="text-sm text-muted">Opening…</p>;
}

export default function OldCallLink() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Opening…</p>}>
      <Redirect />
    </Suspense>
  );
}
