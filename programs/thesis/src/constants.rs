use anchor_lang::prelude::*;

pub const CONFIG_SEED: &[u8] = b"config";
pub const AUTHORITY_SEED: &[u8] = b"authority";
pub const TOUCH_SEED: &[u8] = b"touch";
pub const THESIS_SEED: &[u8] = b"thesis";
pub const CREATOR_SEED: &[u8] = b"creator";

/// pm-AMM PDA seeds (from its source, commit d5b407b).
pub const PM_MARKET_SEED: &[u8] = b"market";
pub const PM_YES_MINT_SEED: &[u8] = b"yes_mint";
pub const PM_NO_MINT_SEED: &[u8] = b"no_mint";
pub const PM_VAULT_SEED: &[u8] = b"vault";
pub const PM_LP_SEED: &[u8] = b"lp";

/// Pyth Solana receiver program (same ID on devnet and mainnet).
pub const PYTH_RECEIVER_ID: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

/// A Pyth publish_time may sit slightly ahead of Solana's clock, which lags
/// wall time by a second or more; proofs this far "in the future" still count.
pub const MAX_CLOCK_SKEW_SECS: i64 = 15;

/// pm-AMM's own minimum market duration.
pub const PM_MIN_DURATION_SECS: i64 = 300;

/// pm-AMM's protocol DAO; trades must send its fee half to this wallet's USDC ATA.
pub const PROTOCOL_DAO: Pubkey = pubkey!("4qXyczAr5DuBVaHUwmZT5Xt6hgQ6RwqBYcFGtrv8QEph");
/// Longest market window (spec windows: 10 min demo, 24h, 48h, 7d).
pub const MAX_WINDOW_SECS: i64 = 8 * 86_400;
/// A market can join a thesis only this soon after it opened, so a track
/// record can't be built by linking markets once their outcome is clear.
pub const THESIS_LINK_WINDOW_SECS: i64 = 15 * 60;
/// Treasury buys must get at least this much more YES than USDC paid
/// (1% edge): a touched market pays $1 per YES, so the buy is always profitable.
pub const TREASURY_BUY_MIN_EDGE_BPS: u64 = 100;
/// Bounds on the settlement grace and on the confidence a proof may carry.
pub const MIN_GRACE_SECS: u32 = 60;
pub const MAX_GRACE_SECS: u32 = 3_600;
pub const MIN_CONF_BPS: u16 = 10;
pub const MAX_CONF_BPS: u16 = 500;
