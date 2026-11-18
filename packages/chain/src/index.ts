import { PublicKey } from "@solana/web3.js";
import thesisIdl from "../idl/thesis.json";

export type { Thesis as ThesisIdl } from "../idl/thesis";
export const THESIS_IDL = thesisIdl;
export const THESIS_PROGRAM_ID = new PublicKey(thesisIdl.address);
export const PM_AMM_PROGRAM_ID = new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y");
export const PROTOCOL_DAO = new PublicKey("4qXyczAr5DuBVaHUwmZT5Xt6hgQ6RwqBYcFGtrv8QEph");
/** Pyth sponsored SOL/USD price account (same address on devnet and mainnet). */
export const SOL_USD_PRICE_ACCOUNT = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
export const SOL_USD_FEED_ID = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

export * from "./crossing";
export * from "./pmamm";
export * from "./pricing";
export * from "./pyth";
export * from "./position";
