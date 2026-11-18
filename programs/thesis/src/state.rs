use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub keeper: Pubkey,
    pub usdc_mint: Pubkey,
    pub pm_amm_program: Pubkey,
    pub pyth_receiver: Pubkey,
    pub sol_usd_feed_id: [u8; 32],
    /// Creator share of the treasury's swap fee, in bps (5000 at launch).
    pub creator_share_bps: u16,
    /// Share of creator fees rebated to LPs (0 at launch; v2).
    pub lp_rebate_bps: u16,
    /// Seconds after `end_ts` during which a late proof may still land.
    pub grace_secs: u32,
    /// Max Pyth confidence as a share of price, in bps.
    pub max_conf_bps: u16,
    pub max_seed_per_market: u64,
    pub max_cover_per_wallet: u64,
    pub paused: bool,
    pub bump: u8,
    pub authority_bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum Direction {
    /// Touches if price trades at or above the strike before `end_ts`.
    Above,
    /// Touches if price trades at or below the strike before `end_ts`.
    Below,
}

#[account]
#[derive(InitSpace)]
pub struct TouchMarket {
    pub pm_market: Pubkey,
    pub market_id: u64,
    pub feed_id: [u8; 32],
    pub direction: Direction,
    /// Strike in Pyth units: real price = strike * 10^expo.
    pub strike: i64,
    pub expo: i32,
    pub start_ts: i64,
    pub end_ts: i64,
    pub initial_price_bps: u16,
    pub touched: bool,
    pub touch_price: i64,
    pub touch_publish_time: i64,
    pub prover: Pubkey,
    pub settled: bool,
    /// 0 = unresolved, 1 = YES, 2 = NO (same encoding as pm-AMM).
    pub winning_side: u8,
    pub origin_thesis: Pubkey,
    pub seeded_by: Pubkey,
    pub seed_amount: u64,
    pub bump: u8,
}

#[event]
pub struct TouchMarketCreated {
    pub touch_market: Pubkey,
    pub pm_market: Pubkey,
    pub direction: Direction,
    pub strike: i64,
    pub expo: i32,
    pub end_ts: i64,
    pub initial_price_bps: u16,
    pub seed_amount: u64,
}

#[event]
pub struct Touched {
    pub touch_market: Pubkey,
    pub price: i64,
    pub publish_time: i64,
    pub prover: Pubkey,
}

#[event]
pub struct Settled {
    pub touch_market: Pubkey,
    pub winning_side: u8,
}
