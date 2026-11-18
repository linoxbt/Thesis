//! Thesis: touch markets on the pm-AMM, resolved by Pyth price proofs.
//!
//! The program owns every market it creates through a PDA (`Authority`):
//! creates and seeds touch markets on the pm-AMM, accepts a permissionless
//! Pyth proof of a touch, settles through CPI, links markets into theses that
//! route trades and attribute fees, and redeems the treasury's positions.
//!
//! `Config.lp_rebate_bps` and `Config.pm_amm_program` are reserved (v2 / kept
//! for layout); nothing reads them.

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

    /// Admin, once: writes `Config`, funds the `Authority` PDA with a SOL float
    /// (creators repay what market creation spends from it), and creates the
    /// treasury (the Authority's USDC ATA).
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

    /// Admin: change config fields within `Config::validate`; `admin` only
    /// proposes a successor, and the creator share is fixed.
    pub fn update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
        instructions::update_config::update_config(ctx, args)
    }

    /// The proposed admin takes over by signing.
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::update_config::accept_admin(ctx)
    }

    /// Admin, once per deployment that predates v2: resize `Config` and set
    /// the creator fees already owed.
    pub fn migrate_config(ctx: Context<MigrateConfig>, creator_fees_owed: u64) -> Result<()> {
        instructions::update_config::migrate_config(ctx, creator_fees_owed)
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

    /// Anyone, after settlement: claim a sponsored seed's LP residuals and redeem the
    /// Authority's YES/NO for USDC into the treasury.
    pub fn treasury_redeem(ctx: Context<TreasuryRedeem>, claim_residuals: bool) -> Result<()> {
        instructions::treasury_redeem::handler(ctx, claim_residuals)
    }
}
