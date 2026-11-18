//! Thesis: touch markets on the pm-AMM, resolved by Pyth price proofs.
//!
//! Phase 0 scope: the program owns every market it creates through a PDA
//! (`Authority`), seeds it from the treasury, accepts a Pyth proof of a touch,
//! and settles through CPI. The thesis/social layer arrives in Phase 2.

use anchor_lang::prelude::*;

declare_id!("9yVcFaDEmBk1VU66tXxuvUujZXfiiT3ED1EpioVuug6h");

// CPI bindings generated from idls/pm_amm.json.
declare_program!(pm_amm);

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod pricing;
pub mod pyth;
pub mod state;

use instructions::*;

#[program]
pub mod thesis {
    use super::*;

    /// Admin, once: writes `Config`, funds the `Authority` PDA with SOL for
    /// market rent, and creates the treasury (the Authority's USDC ATA).
    pub fn initialize_config(ctx: Context<InitializeConfig>, args: InitializeConfigArgs) -> Result<()> {
        instructions::initialize_config::handler(ctx, args)
    }

    /// Anyone: create a touch market. The opening price is computed onchain
    /// from a fresh Pyth spot and `Config.sol_vol_bps`; the pm-AMM market's
    /// authority is the `Authority` PDA. Seeded by the creator, or by the
    /// treasury when an admin/keeper sponsors it.
    pub fn create_touch_market(
        ctx: Context<CreateTouchMarket>,
        args: CreateTouchMarketArgs,
    ) -> Result<()> {
        instructions::create_touch_market::handler(ctx, args)
    }

    /// Admin: change any config field; the result must pass `Config::validate`.
    pub fn update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
        instructions::update_config::update_config(ctx, args)
    }

    /// Keeper or admin: post SOL's annualised volatility (bps).
    pub fn set_volatility(ctx: Context<SetVolatility>, sol_vol_bps: u32) -> Result<()> {
        instructions::update_config::set_volatility(ctx, sol_vol_bps)
    }

    /// Anyone: submit a fully verified Pyth price update that shows the touch.
    pub fn prove_touch(ctx: Context<ProveTouch>) -> Result<()> {
        instructions::prove_touch::handler(ctx)
    }

    /// Anyone, after `end_ts + grace_secs`: resolve YES if touched, else NO.
    /// Records the thesis outcome when its conviction market settles.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        instructions::settle::handler(ctx)
    }

    /// Creator: link their own open conviction market (and optional opposite
    /// protection market) into a public thesis.
    pub fn create_thesis(ctx: Context<CreateThesis>, text_hash: [u8; 32]) -> Result<()> {
        instructions::create_thesis::handler(ctx, text_hash)
    }

    /// Any trader: back, challenge or protect through Thesis so the creator
    /// earns their fee share. Closed once the market is touched.
    pub fn trade(ctx: Context<Trade>, side: state::TradeSide, amount_in: u64, min_output: u64) -> Result<()> {
        instructions::trade::handler(ctx, side, amount_in, min_output)
    }

    /// Creator: withdraw the earned share of fees attributed to a thesis.
    pub fn claim_creator_fees(ctx: Context<ClaimCreatorFees>) -> Result<()> {
        instructions::claim_creator_fees::handler(ctx)
    }

    /// Keeper: after a proven touch, buy underpriced YES with treasury USDC.
    pub fn treasury_buy_yes(ctx: Context<TreasuryBuyYes>, amount_in: u64, min_output: u64) -> Result<()> {
        instructions::treasury_buy::handler(ctx, amount_in, min_output)
    }
}
