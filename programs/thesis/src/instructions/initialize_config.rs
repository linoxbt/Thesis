use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::pm_amm;
use crate::state::Config;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeConfigArgs {
    pub keeper: Pubkey,
    pub sol_usd_feed_id: [u8; 32],
    pub creator_share_bps: u16,
    pub grace_secs: u32,
    pub max_conf_bps: u16,
    pub min_seed_per_market: u64,
    pub max_seed_per_market: u64,
    pub max_cover_per_wallet: u64,
    pub sponsor_budget: u64,
    pub sol_vol_bps: u32,
    pub max_vol_age_secs: u32,
    pub max_spot_age_secs: u32,
    pub min_strike_distance_bps: u16,
    pub max_strike_distance_bps: u16,
    pub min_open_bps: u16,
    pub max_open_bps: u16,
    /// Lamports moved to the Authority PDA to pay pm-AMM rent.
    pub authority_funding: u64,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Box<Account<'info, Config>>,

    /// System-owned PDA with no data: signs every pm-AMM CPI and pays its rent.
    #[account(mut, seeds = [AUTHORITY_SEED], bump)]
    pub authority: SystemAccount<'info>,

    pub usdc_mint: Box<Account<'info, Mint>>,

    /// The treasury: receives the creator half of every swap fee.
    #[account(
        init,
        payer = admin,
        associated_token::mint = usdc_mint,
        associated_token::authority = authority,
    )]
    pub treasury: Box<Account<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handler(ctx: Context<InitializeConfig>, args: InitializeConfigArgs) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.keeper = args.keeper;
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.pm_amm_program = pm_amm::ID;
    config.pyth_receiver = PYTH_RECEIVER_ID;
    config.sol_usd_feed_id = args.sol_usd_feed_id;
    config.creator_share_bps = args.creator_share_bps;
    config.lp_rebate_bps = 0;
    config.grace_secs = args.grace_secs;
    config.max_conf_bps = args.max_conf_bps;
    config.min_seed_per_market = args.min_seed_per_market;
    config.max_seed_per_market = args.max_seed_per_market;
    config.max_cover_per_wallet = args.max_cover_per_wallet;
    config.sponsor_budget = args.sponsor_budget;
    config.sol_vol_bps = args.sol_vol_bps;
    config.vol_updated_ts = now;
    config.max_vol_age_secs = args.max_vol_age_secs;
    config.max_spot_age_secs = args.max_spot_age_secs;
    config.min_strike_distance_bps = args.min_strike_distance_bps;
    config.max_strike_distance_bps = args.max_strike_distance_bps;
    config.min_open_bps = args.min_open_bps;
    config.max_open_bps = args.max_open_bps;
    config.paused = false;
    config.validate()?;
    config.bump = ctx.bumps.config;
    config.authority_bump = ctx.bumps.authority;

    if args.authority_funding > 0 {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.admin.to_account_info(),
                    to: ctx.accounts.authority.to_account_info(),
                },
            ),
            args.authority_funding,
        )?;
    }
    Ok(())
}
