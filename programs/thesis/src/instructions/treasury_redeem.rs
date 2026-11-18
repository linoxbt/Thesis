use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::ThesisError;
use crate::pm_amm;
use crate::pm_amm::program::PmAmm;
use crate::state::{Config, TouchMarket, TreasuryRedeemed};

#[derive(Accounts)]
pub struct TreasuryRedeem<'info> {
    /// Anyone may crank this: the USDC can only go to the treasury.
    pub cranker: Signer<'info>,

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

    #[account(mut, associated_token::mint = yes_mint, associated_token::authority = authority)]
    pub treasury_yes: Box<Account<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = no_mint, associated_token::authority = authority)]
    pub treasury_no: Box<Account<'info, TokenAccount>>,

    /// CHECK: the Authority's pm-AMM LP position for this market (sponsored
    /// markets only); seeds pinned here, contents read by pm-AMM.
    #[account(
        mut,
        seeds = [PM_LP_SEED, pm_market.key().as_ref(), authority.key().as_ref()],
        bump,
        seeds::program = pm_amm_program.key(),
    )]
    pub lp_position: UncheckedAccount<'info>,

    pub pm_amm_program: Program<'info, PmAmm>,
    pub token_program: Program<'info, Token>,
}

/// After settlement, brings the treasury's money home. With
/// `claim_residuals`, first claims the sponsored seed's LP residuals (pm-AMM
/// releases the pool to LPs as YES + NO while L_eff decays to zero at end_ts;
/// pass false when nothing is pending, as pm-AMM then fails the call). Then
/// redeems every YES/NO the Authority holds (seed and treasury buys) for USDC.
pub fn handler(ctx: Context<TreasuryRedeem>, claim_residuals: bool) -> Result<()> {
    require!(ctx.accounts.touch_market.settled, ThesisError::NotSettled);
    let bump = [ctx.accounts.config.authority_bump];
    let seeds: &[&[&[u8]]] = &[&[AUTHORITY_SEED, &bump]];
    let pm_program = ctx.accounts.pm_amm_program.key();

    if claim_residuals {
        let lp = ctx.accounts.lp_position.to_account_info();
        require_keys_eq!(*lp.owner, pm_amm::ID, ThesisError::NothingToClaim);
        pm_amm::cpi::claim_lp_residuals(CpiContext::new_with_signer(
            pm_program,
            pm_amm::cpi::accounts::ClaimLpResiduals {
                signer: ctx.accounts.authority.to_account_info(),
                market: ctx.accounts.pm_market.to_account_info(),
                yes_mint: ctx.accounts.yes_mint.to_account_info(),
                no_mint: ctx.accounts.no_mint.to_account_info(),
                lp_position: lp,
                user_yes: ctx.accounts.treasury_yes.to_account_info(),
                user_no: ctx.accounts.treasury_no.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
            seeds,
        ))?;
    }

    // Redeem; claim_winnings burns both sides and pays the winning one.
    ctx.accounts.treasury_yes.reload()?;
    ctx.accounts.treasury_no.reload()?;
    let (yes, no) = (ctx.accounts.treasury_yes.amount, ctx.accounts.treasury_no.amount);
    require!(yes > 0 || no > 0, ThesisError::NothingToClaim);
    let winning = if ctx.accounts.touch_market.winning_side == 1 { yes } else { no };
    let before = ctx.accounts.treasury.amount;
    pm_amm::cpi::claim_winnings(
        CpiContext::new_with_signer(
            pm_program,
            pm_amm::cpi::accounts::ClaimWinnings {
                signer: ctx.accounts.authority.to_account_info(),
                market: ctx.accounts.pm_market.to_account_info(),
                collateral_mint: ctx.accounts.usdc_mint.to_account_info(),
                yes_mint: ctx.accounts.yes_mint.to_account_info(),
                no_mint: ctx.accounts.no_mint.to_account_info(),
                vault: ctx.accounts.vault.to_account_info(),
                user_yes: ctx.accounts.treasury_yes.to_account_info(),
                user_no: ctx.accounts.treasury_no.to_account_info(),
                user_collateral: ctx.accounts.treasury.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
            seeds,
        ),
        winning,
    )?;
    ctx.accounts.treasury.reload()?;
    let usdc_out = ctx.accounts.treasury.amount.saturating_sub(before);
    emit!(TreasuryRedeemed { touch_market: ctx.accounts.touch_market.key(), usdc_out });
    Ok(())
}
