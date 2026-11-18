/**
 * Profile edits are authorised by a wallet signature over this exact text,
 * built the same way in the browser (to sign) and on the server (to verify).
 * `issued_at` makes every message unique; the server refuses stale ones and
 * anything not newer than the stored profile, so a signature can't be replayed.
 */
export const PROFILE_MAX_AGE_SECS = 600;

export interface ProfileFields {
  displayName: string;
  xHandle: string;
}

export function profileMessage(wallet: string, f: ProfileFields, issuedAt: number): string {
  return [
    "Thesis: update my profile",
    `wallet: ${wallet}`,
    `display name: ${f.displayName}`,
    `x: ${f.xHandle || "-"}`,
    `issued at: ${issuedAt}`,
  ].join("\n");
}

/** Normalises and validates; returns an error message or the clean fields. */
export function cleanProfile(displayName: string, xHandle: string): { error: string } | ProfileFields {
  const name = displayName.trim().replace(/\s+/g, " ");
  const x = xHandle.trim().replace(/^@/, "");
  if (name.length < 2 || name.length > 32) return { error: "Display name must be 2–32 characters." };
  if (/[\u0000-\u001f\u007f]/.test(name)) return { error: "Display name has invalid characters." };
  if (/thesis/i.test(name)) return { error: "Display names can't include “Thesis”." };
  if (x && !/^[A-Za-z0-9_]{1,15}$/.test(x)) return { error: "X handle: letters, numbers and _ only, up to 15." };
  return { displayName: name, xHandle: x };
}
