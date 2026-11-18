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
    pub min_seed_per_market: u64,
    pub max_seed_per_market: u64,
    pub max_cover_per_wallet: u64,
    /// Treasury USDC still available for sponsored seeds (launch subsidy).
    pub sponsor_budget: u64,
    /// SOL annualised volatility in bps (6000 = 60%), set by the keeper.
    pub sol_vol_bps: u32,
    pub vol_updated_ts: i64,
    /// Market creation fails if `sol_vol_bps` is older than this.
    pub max_vol_age_secs: u32,
    /// Market creation needs a spot price no older than this.
    pub max_spot_age_secs: u32,
    /// Strike distance from spot, in bps of spot (spec: 0.5%..50%).
    pub min_strike_distance_bps: u16,
    pub max_strike_distance_bps: u16,
    /// Allowed opening probability, in bps (spec: 1%..99%).
    pub min_open_bps: u16,
    pub max_open_bps: u16,
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
    pub creator: Pubkey,
    /// Authority PDA for sponsored markets, else the creator.
    pub seeded_by: Pubkey,
    pub seed_amount: u64,
    /// Pyth spot the opening price was computed from.
    pub spot_at_open: i64,
    pub bump: u8,
}

#[event]
pub struct TouchMarketCreated {
    pub touch_market: Pubkey,
    pub pm_market: Pubkey,
    pub creator: Pubkey,
    pub direction: Direction,
    pub strike: i64,
    pub expo: i32,
    pub spot: i64,
    pub end_ts: i64,
    pub initial_price_bps: u16,
    pub seed_amount: u64,
    pub sponsored: bool,
}

#[event]
pub struct VolatilityUpdated {
    pub sol_vol_bps: u32,
    pub ts: i64,
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

/// Bounds every config write must satisfy.
pub const MIN_VOL_BPS: u32 = 500; // 5%
pub const MAX_VOL_BPS: u32 = 50_000; // 500%

impl Config {
    pub fn validate(&self) -> Result<()> {
        use crate::errors::ThesisError;
        require!(self.creator_share_bps <= 10_000, ThesisError::InvalidConfig);
        require!(self.lp_rebate_bps <= 10_000, ThesisError::InvalidConfig);
        require!(self.max_conf_bps > 0 && self.max_conf_bps <= 10_000, ThesisError::InvalidConfig);
        require!(
            self.min_seed_per_market > 0 && self.min_seed_per_market <= self.max_seed_per_market,
            ThesisError::InvalidConfig
        );
        require!(
            (MIN_VOL_BPS..=MAX_VOL_BPS).contains(&self.sol_vol_bps),
            ThesisError::InvalidVolatility
        );
        require!(self.max_vol_age_secs > 0 && self.max_spot_age_secs > 0, ThesisError::InvalidConfig);
        require!(
            self.min_strike_distance_bps > 0
                && self.min_strike_distance_bps < self.max_strike_distance_bps
                && self.max_strike_distance_bps < 10_000,
            ThesisError::InvalidConfig
        );
        // pm-AMM accepts 100..=9900 as an explicit opening price.
        require!(
            self.min_open_bps >= 100 && self.min_open_bps < self.max_open_bps && self.max_open_bps <= 9_900,
            ThesisError::InvalidConfig
        );
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Thesis {
    pub creator: Pubkey,
    pub id: u64,
    /// TouchMarket PDA the crowd backs or challenges.
    pub conviction_market: Pubkey,
    /// TouchMarket PDA for the creator's cover; default = none.
    pub protection_market: Pubkey,
    /// sha256 of the thesis text (text lives offchain).
    pub text_hash: [u8; 32],
    pub created_ts: i64,
    pub end_ts: i64,
    /// USDC moved by trades routed through `trade` (both markets).
    pub volume_usdc: u64,
    /// Part of `volume_usdc` traded by the creator's own wallet.
    pub self_volume_usdc: u64,
    /// Treasury fee income from trades routed through `trade`.
    pub fees_attributed: u64,
    /// Creator share already paid out.
    pub fees_claimed: u64,
    /// 0 open, 1 hit (conviction market touched), 2 missed.
    pub outcome: u8,
    pub bump: u8,
}

impl Thesis {
    /// Creator share earned so far, per `creator_share_bps`.
    pub fn creator_fees_earned(&self, creator_share_bps: u16) -> u64 {
        ((self.fees_attributed as u128) * (creator_share_bps as u128) / 10_000) as u64
    }
}

#[account]
#[derive(InitSpace)]
pub struct CreatorStats {
    pub creator: Pubkey,
    pub next_thesis_id: u64,
    pub posted: u32,
    pub hit: u32,
    pub missed: u32,
    pub total_volume: u64,
    pub total_fees_earned: u64,
    pub bump: u8,
}

#[event]
pub struct ThesisCreated {
    pub thesis: Pubkey,
    pub creator: Pubkey,
    pub id: u64,
    pub conviction_market: Pubkey,
    pub protection_market: Pubkey,
    pub text_hash: [u8; 32],
    pub end_ts: i64,
}

#[event]
pub struct Traded {
    pub thesis: Pubkey,
    pub touch_market: Pubkey,
    pub trader: Pubkey,
    pub side: TradeSide,
    pub usdc_amount: u64,
    pub token_amount: u64,
    pub fee_to_treasury: u64,
    pub is_creator: bool,
}

#[event]
pub struct CreatorFeesClaimed {
    pub thesis: Pubkey,
    pub creator: Pubkey,
    pub amount: u64,
}

#[event]
pub struct TreasuryBought {
    pub touch_market: Pubkey,
    pub usdc_in: u64,
    pub yes_out: u64,
}

/// What a trader does through `trade`. Buys spend USDC; sells receive it.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum TradeSide {
    BuyYes,
    BuyNo,
    SellYes,
    SellNo,
}
