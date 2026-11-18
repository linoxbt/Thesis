use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::ThesisError;
use crate::state::{Config, CreatorFeesClaimed, CreatorStats, Thesis};

#[derive(Accounts)]
pub struct ClaimCreatorFees<'info> {
    pub creator: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint)]
    pub config: Box<Account<'info, Config>>,

    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: SystemAccount<'info>,

    #[account(mut, associated_token::mint = usdc_mint, associated_token::authority = authority)]
    pub treasury: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        has_one = creator,
        seeds = [THESIS_SEED, creator.key().as_ref(), thesis.id.to_le_bytes().as_ref()],
        bump = thesis.bump,
    )]
    pub thesis: Box<Account<'info, Thesis>>,

    #[account(mut, seeds = [CREATOR_SEED, creator.key().as_ref()], bump = creator_stats.bump)]
    pub creator_stats: Box<Account<'info, CreatorStats>>,

    #[account(mut, token::mint = usdc_mint)]
    pub creator_usdc: Box<Account<'info, TokenAccount>>,

    pub usdc_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

/// Pays `fees_attributed * creator_share_bps - fees_claimed`. Idempotent: a
/// second call with nothing new is refused, never pays twice.
pub fn handler(ctx: Context<ClaimCreatorFees>) -> Result<()> {
    let share = ctx.accounts.config.creator_share_bps;
    let t = &mut ctx.accounts.thesis;
    let amount = t.creator_fees_earned(share).saturating_sub(t.fees_claimed);
    require!(amount > 0, ThesisError::NothingToClaim);
    t.fees_claimed = t.fees_claimed.checked_add(amount).ok_or(ThesisError::Overflow)?;
    let config = &mut ctx.accounts.config;
    config.creator_fees_owed = config.creator_fees_owed.saturating_sub(amount);
    let stats = &mut ctx.accounts.creator_stats;
    stats.total_fees_earned = stats.total_fees_earned.checked_add(amount).ok_or(ThesisError::Overflow)?;

    let bump = [config.authority_bump];
    let seeds: &[&[&[u8]]] = &[&[AUTHORITY_SEED, &bump]];
    transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.treasury.to_account_info(),
                to: ctx.accounts.creator_usdc.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
            seeds,
        ),
        amount,
    )?;
    emit!(CreatorFeesClaimed { thesis: t.key(), creator: t.creator, amount });
    Ok(())
}
