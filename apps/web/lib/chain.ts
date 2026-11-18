import "server-only";
import { BorshAccountsCoder, Program, type Idl } from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import { THESIS_IDL, type MarketView, type ThesisIdl } from "@thesis/chain";
import { env } from "./server";

export const connection = new Connection(env.rpcUrl, "confirmed");
const coder = new BorshAccountsCoder(THESIS_IDL as Idl);
/** Read-only program client: builds instructions, never signs. */
export const program = new Program<ThesisIdl>(THESIS_IDL as ThesisIdl, { connection });

export const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];

export async function fetchConfig() {
  const info = await connection.getAccountInfo(configPda);
  return info ? coder.decode("Config", info.data) : null;
}

export async function fetchTouchMarket(key: PublicKey): Promise<{ view: MarketView; raw: Record<string, unknown> } | null> {
  const info = await connection.getAccountInfo(key);
  if (!info || !info.owner.equals(program.programId)) return null;
  const m = coder.decode("TouchMarket", info.data);
  const n = (v: { toString(): string }) => v.toString();
  return {
    raw: m,
    view: {
      feedId: Buffer.from(m.feed_id),
      direction: "below" in m.direction ? "below" : "above",
      strike: BigInt(n(m.strike)),
      expo: m.expo,
      startTs: Number(n(m.start_ts)),
      endTs: Number(n(m.end_ts)),
      touched: m.touched,
      settled: m.settled,
    },
  };
}
