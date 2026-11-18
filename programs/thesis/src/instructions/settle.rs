use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::ThesisError;
use crate::pm_amm;
use crate::pm_amm::program::PmAmm;
use crate::pm_amm::types::Side;
use crate::state::{Config, CreatorStats, Settled, Thesis, TouchMarket};

#[derive(Accounts)]
pub struct Settle<'info> {
    /// Anyone may crank settlement; the keeper does it by default.
    pub cranker: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: SystemAccount<'info>,

    #[account(mut, seeds = [TOUCH_SEED, touch_market.pm_market.as_ref()], bump = touch_market.bump)]
    pub touch_market: Box<Account<'info, TouchMarket>>,

    /// CHECK: must be the market this TouchMarket points to; pm-AMM checks the rest.
    #[account(mut, address = touch_market.pm_market @ ThesisError::WrongPmAccount)]
    pub pm_market: UncheckedAccount<'info>,

    pub pm_amm_program: Program<'info, PmAmm>,

    /// Required when the market belongs to a thesis (`origin_thesis`).
    #[account(mut)]
    pub thesis: Option<Box<Account<'info, Thesis>>>,

    /// The thesis creator's stats; required with `thesis`.
    #[account(mut)]
    pub creator_stats: Option<Box<Account<'info, CreatorStats>>>,
}

pub fn handler(ctx: Context<Settle>) -> Result<()> {
    let config = &ctx.accounts.config;
    let m = &mut ctx.accounts.touch_market;
    require!(!m.settled, ThesisError::AlreadyFinal);

    let now = Clock::get()?.unix_timestamp;
    let settle_after = m
        .end_ts
        .checked_add(config.grace_secs as i64)
        .ok_or(ThesisError::Overflow)?;
    require!(now >= settle_after, ThesisError::TooEarly);

    let side = if m.touched { Side::Yes } else { Side::No };
    let authority_bump = [config.authority_bump];
    let signer_seeds: &[&[&[u8]]] = &[&[AUTHORITY_SEED, &authority_bump]];

    pm_amm::cpi::resolve_market(
        CpiContext::new_with_signer(
            ctx.accounts.pm_amm_program.key(),
            pm_amm::cpi::accounts::ResolveMarket {
                signer: ctx.accounts.authority.to_account_info(),
                market: ctx.accounts.pm_market.to_account_info(),
            },
            signer_seeds,
        ),
        side,
    )?;

    m.settled = true;
    m.winning_side = if m.touched { 1 } else { 2 };

    // A thesis records its outcome when its conviction market settles.
    if m.origin_thesis != Pubkey::default() {
        let thesis = ctx.accounts.thesis.as_mut().ok_or(ThesisError::MissingThesisAccounts)?;
        require_keys_eq!(thesis.key(), m.origin_thesis, ThesisError::MarketNotInThesis);
        if thesis.conviction_market == m.key() {
            let stats = ctx.accounts.creator_stats.as_mut().ok_or(ThesisError::MissingThesisAccounts)?;
            require_keys_eq!(stats.creator, thesis.creator, ThesisError::WrongCreatorStats);
            if m.touched {
                thesis.outcome = 1;
                stats.hit = stats.hit.checked_add(1).ok_or(ThesisError::Overflow)?;
            } else {
                thesis.outcome = 2;
                stats.missed = stats.missed.checked_add(1).ok_or(ThesisError::Overflow)?;
            }
        }
    }
    emit!(Settled { touch_market: m.key(), winning_side: m.winning_side });
    Ok(())
}
