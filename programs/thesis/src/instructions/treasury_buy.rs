use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::ThesisError;
use crate::pm_amm;
use crate::pm_amm::program::PmAmm;
use crate::pm_amm::types::SwapDirection;
use crate::state::{Config, TouchMarket, TreasuryBought};

#[derive(Accounts)]
pub struct TreasuryBuyYes<'info> {
    pub keeper: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint)]
    pub config: Box<Account<'info, Config>>,

    #[account(mut, seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: SystemAccount<'info>,

    #[account(mut, associated_token::mint = usdc_mint, associated_token::authority = authority)]
    pub treasury: Box<Account<'info, TokenAccount>>,

    #[account(seeds = [TOUCH_SEED, touch_market.pm_market.as_ref()], bump = touch_market.bump)]
    pub touch_market: Box<Account<'info, TouchMarket>>,

    /// CHECK: the pm-AMM market of `touch_market`.
    #[account(mut, address = touch_market.pm_market @ ThesisError::WrongPmAccount)]
    pub pm_market: UncheckedAccount<'info>,

    pub usdc_mint: Box<Account<'info, Mint>>,

    /// CHECK: pm-AMM checks it against the market.
    #[account(mut)]
    pub yes_mint: UncheckedAccount<'info>,

    /// CHECK: pm-AMM checks it against the market.
    #[account(mut)]
    pub no_mint: UncheckedAccount<'info>,

    /// CHECK: pm-AMM checks it against the market.
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,

    #[account(mut, token::mint = yes_mint, token::authority = authority)]
    pub treasury_yes: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::mint = no_mint, token::authority = authority)]
    pub treasury_no: Box<Account<'info, TokenAccount>>,

    /// CHECK: pm-AMM requires the protocol DAO's USDC account.
    #[account(mut)]
    pub dao_usdc: UncheckedAccount<'info>,

    pub pm_amm_program: Program<'info, PmAmm>,
    pub token_program: Program<'info, Token>,
}

/// Keeper only, and only on a proven touch: YES is worth $1 at settlement but
/// the pool still sells it cheaper until then. The treasury takes that gap
/// instead of an arbitrageur. The Authority is the market authority, so it
/// keeps its own creator fee share (pm-AMM: `creator_usdc` = None).
pub fn handler(ctx: Context<TreasuryBuyYes>, amount_in: u64, min_output: u64) -> Result<()> {
    let config = &ctx.accounts.config;
    let keeper = ctx.accounts.keeper.key();
    require!(keeper == config.keeper || keeper == config.admin, ThesisError::Unauthorized);
    require!(amount_in > 0, ThesisError::ZeroAmount);
    let tm = &ctx.accounts.touch_market;
    require!(tm.touched && !tm.settled, ThesisError::NotTouched);

    let yes_before = ctx.accounts.treasury_yes.amount;
    let bump = [config.authority_bump];
    let seeds: &[&[&[u8]]] = &[&[AUTHORITY_SEED, &bump]];
    pm_amm::cpi::swap(
        CpiContext::new_with_signer(
            ctx.accounts.pm_amm_program.key(),
            pm_amm::cpi::accounts::Swap {
                signer: ctx.accounts.authority.to_account_info(),
                market: ctx.accounts.pm_market.to_account_info(),
                collateral_mint: ctx.accounts.usdc_mint.to_account_info(),
                yes_mint: ctx.accounts.yes_mint.to_account_info(),
                no_mint: ctx.accounts.no_mint.to_account_info(),
                vault: ctx.accounts.vault.to_account_info(),
                user_collateral: ctx.accounts.treasury.to_account_info(),
                user_yes: ctx.accounts.treasury_yes.to_account_info(),
                user_no: ctx.accounts.treasury_no.to_account_info(),
                dao_usdc: ctx.accounts.dao_usdc.to_account_info(),
                creator_usdc: None,
                token_program: ctx.accounts.token_program.to_account_info(),
            },
            seeds,
        ),
        SwapDirection::UsdcToYes,
        amount_in,
        min_output,
    )?;
    ctx.accounts.treasury_yes.reload()?;
    emit!(TreasuryBought {
        touch_market: tm.key(),
        usdc_in: amount_in,
        yes_out: ctx.accounts.treasury_yes.amount.saturating_sub(yes_before),
    });
    Ok(())
}
