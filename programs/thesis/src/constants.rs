use anchor_lang::prelude::*;

pub const CONFIG_SEED: &[u8] = b"config";
pub const AUTHORITY_SEED: &[u8] = b"authority";
pub const TOUCH_SEED: &[u8] = b"touch";

/// pm-AMM PDA seeds (from its source, commit d5b407b).
pub const PM_MARKET_SEED: &[u8] = b"market";
pub const PM_YES_MINT_SEED: &[u8] = b"yes_mint";
pub const PM_NO_MINT_SEED: &[u8] = b"no_mint";
pub const PM_VAULT_SEED: &[u8] = b"vault";
pub const PM_LP_SEED: &[u8] = b"lp";

/// Pyth Solana receiver program (same ID on devnet and mainnet).
pub const PYTH_RECEIVER_ID: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

/// pm-AMM's own minimum market duration.
pub const PM_MIN_DURATION_SECS: i64 = 300;
