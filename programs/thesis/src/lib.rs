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

    /// Creates a pm-AMM market whose authority is the `Authority` PDA, seeds it
    /// from the treasury, and records the touch terms.
    pub fn create_touch_market(
        ctx: Context<CreateTouchMarket>,
        args: CreateTouchMarketArgs,
    ) -> Result<()> {
        instructions::create_touch_market::handler(ctx, args)
    }

    /// Anyone: submit a fully verified Pyth price update that shows the touch.
    pub fn prove_touch(ctx: Context<ProveTouch>) -> Result<()> {
        instructions::prove_touch::handler(ctx)
    }

    /// Anyone, after `end_ts + grace_secs`: resolve YES if touched, else NO.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        instructions::settle::handler(ctx)
    }
}
