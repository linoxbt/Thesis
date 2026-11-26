import Link from "next/link";
import { LogoMark } from "@/components/Brand";

export const metadata = { title: "Not found" };

/** Styled 404 (static export: served by Netlify for unknown paths). */
export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-bg px-6 text-center">
      <div>
        <LogoMark size={44} className="mx-auto text-ink" />
        <h1 className="display mt-6 text-4xl">Nothing here</h1>
        <p className="mt-2 text-muted">That page doesn&apos;t exist. The markets do.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Link href="/app/" className="btn btn-primary">
            Open the app
          </Link>
          <Link href="/" className="btn btn-ghost">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
