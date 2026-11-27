import { sha256, stringToBytes } from "viem";

/**
 * Solves the sign-in proof-of-work: finds a nonce whose
 * sha256(`${challenge}:${nonce}`) starts with `bits` zero bits. About 2^bits
 * hashes; done in slices so the page stays responsive.
 */
export async function solvePow(challenge: string, bits: number, signal?: { cancelled(): boolean }): Promise<string> {
  const full = Math.floor(bits / 4);
  const rest = bits % 4;
  const zeros = "0".repeat(full);
  const ok = (hex: string) => hex.startsWith(zeros) && (rest === 0 || parseInt(hex[full], 16) < 1 << (4 - rest));
  for (let n = 0; ; ) {
    const stop = n + 20_000;
    for (; n < stop; n++) {
      const h = sha256(stringToBytes(`${challenge}:${n}`)).slice(2); // "0x…" → hex
      if (ok(h)) return String(n);
    }
    if (signal?.cancelled()) throw new Error("cancelled");
    await new Promise((r) => setTimeout(r, 0));
  }
}
