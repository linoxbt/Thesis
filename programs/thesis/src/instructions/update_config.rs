use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::ThesisError;
use crate::state::{Config, VolatilityUpdated};

/// Every field optional: only the ones sent change.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct UpdateConfigArgs {
    pub admin: Option<Pubkey>,
    pub keeper: Option<Pubkey>,
    pub creator_share_bps: Option<u16>,
    pub lp_rebate_bps: Option<u16>,
    pub grace_secs: Option<u32>,
    pub max_conf_bps: Option<u16>,
    pub min_seed_per_market: Option<u64>,
    pub max_seed_per_market: Option<u64>,
    pub max_cover_per_wallet: Option<u64>,
    pub sponsor_budget: Option<u64>,
    pub max_vol_age_secs: Option<u32>,
    pub max_spot_age_secs: Option<u32>,
    pub min_strike_distance_bps: Option<u16>,
    pub max_strike_distance_bps: Option<u16>,
    pub min_open_bps: Option<u16>,
    pub max_open_bps: Option<u16>,
    pub paused: Option<bool>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ ThesisError::Unauthorized)]
    pub config: Box<Account<'info, Config>>,
}

pub fn update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
    let c = &mut ctx.accounts.config;
    macro_rules! set {
        ($($f:ident),*) => { $( if let Some(v) = args.$f { c.$f = v; } )* };
    }
    set!(
        admin, keeper, creator_share_bps, lp_rebate_bps, grace_secs, max_conf_bps,
        min_seed_per_market, max_seed_per_market, max_cover_per_wallet, sponsor_budget,
        max_vol_age_secs, max_spot_age_secs, min_strike_distance_bps, max_strike_distance_bps,
        min_open_bps, max_open_bps, paused
    );
    c.validate()
}

#[derive(Accounts)]
pub struct SetVolatility<'info> {
    pub signer: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
}

/// Keeper (or admin) posts SOL's annualised volatility, e.g. 7-day realised.
pub fn set_volatility(ctx: Context<SetVolatility>, sol_vol_bps: u32) -> Result<()> {
    let c = &mut ctx.accounts.config;
    let who = ctx.accounts.signer.key();
    require!(who == c.keeper || who == c.admin, ThesisError::Unauthorized);
    c.sol_vol_bps = sol_vol_bps;
    c.vol_updated_ts = Clock::get()?.unix_timestamp;
    c.validate()?;
    emit!(VolatilityUpdated { sol_vol_bps, ts: c.vol_updated_ts });
    Ok(())
}
