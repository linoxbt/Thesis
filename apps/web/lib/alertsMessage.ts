/** Wallet-signed requests for Telegram alerts (built the same way client and server). */
export const ALERTS_MAX_AGE_SECS = 600;

export type AlertsAction = "connect" | "disconnect";

export function alertsMessage(wallet: string, action: AlertsAction, issuedAt: number): string {
  return [`Thesis: ${action} Telegram alerts`, `wallet: ${wallet}`, `issued at: ${issuedAt}`].join("\n");
}
