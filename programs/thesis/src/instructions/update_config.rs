use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::ThesisError;
use crate::state::{AdminChanged, Config, VolatilityUpdated, CONFIG_V1_LEN};

/// Every field optional: only the ones sent change. `admin` only proposes a
/// new admin (it takes over on `accept_admin`), and `creator_share_bps` can't
/// change, because creators' earned fees are computed from it.
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
    if let Some(share) = args.creator_share_bps {
        require!(share == c.creator_share_bps, ThesisError::CreatorShareFixed);
    }
    if let Some(next) = args.admin {
        c.pending_admin = next;
    }
    macro_rules! set {
        ($($f:ident),*) => { $( if let Some(v) = args.$f { c.$f = v; } )* };
    }
    set!(
        keeper, lp_rebate_bps, grace_secs, max_conf_bps,
        min_seed_per_market, max_seed_per_market, max_cover_per_wallet, sponsor_budget,
        max_vol_age_secs, max_spot_age_secs, min_strike_distance_bps, max_strike_distance_bps,
        min_open_bps, max_open_bps, paused
    );
    c.validate()
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
}

/// The proposed admin takes over by signing; a typo'd address can't capture
/// the program, and the old admin keeps control until then.
pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let c = &mut ctx.accounts.config;
    let signer = ctx.accounts.new_admin.key();
    require!(c.pending_admin != Pubkey::default() && signer == c.pending_admin, ThesisError::NotPendingAdmin);
    emit!(AdminChanged { old_admin: c.admin, new_admin: signer });
    c.admin = signer;
    c.pending_admin = Pubkey::default();
    Ok(())
}

#[derive(Accounts)]
pub struct MigrateConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: the v1 Config PDA, resized and checked by hand (a v1 account
    /// can't deserialize as the v2 struct).
    #[account(mut, seeds = [CONFIG_SEED], bump)]
    pub config: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Admin, once: resizes a v1 Config to v2 and sets the creator fees already
/// owed (sum over theses of earned - claimed, computed offchain).
pub fn migrate_config(ctx: Context<MigrateConfig>, creator_fees_owed: u64) -> Result<()> {
    let info = ctx.accounts.config.to_account_info();
    require_keys_eq!(*info.owner, crate::ID, ThesisError::InvalidConfig);
    require!(info.data_len() == CONFIG_V1_LEN, ThesisError::AlreadyMigrated);
    {
        let data = info.try_borrow_data()?;
        require!(data[..8] == *Config::DISCRIMINATOR, ThesisError::InvalidConfig);
        // admin is the first field after the discriminator.
        let admin = Pubkey::try_from(&data[8..40]).map_err(|_| ThesisError::InvalidConfig)?;
        require_keys_eq!(admin, ctx.accounts.admin.key(), ThesisError::Unauthorized);
    }
    let new_len = 8 + Config::INIT_SPACE;
    let rent = Rent::get()?.minimum_balance(new_len).saturating_sub(info.lamports());
    if rent > 0 {
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.admin.to_account_info(),
                    to: info.clone(),
                },
            ),
            rent,
        )?;
    }
    info.resize(new_len)?;
    let mut data = info.try_borrow_mut_data()?;
    // New tail: pending_admin (zero = none), then creator_fees_owed.
    data[CONFIG_V1_LEN..CONFIG_V1_LEN + 32].fill(0);
    data[CONFIG_V1_LEN + 32..CONFIG_V1_LEN + 40].copy_from_slice(&creator_fees_owed.to_le_bytes());
    Ok(())
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
