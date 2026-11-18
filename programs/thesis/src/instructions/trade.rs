use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::ThesisError;
use crate::pm_amm;
use crate::pm_amm::program::PmAmm;
use crate::pm_amm::types::SwapDirection;
use crate::state::{Config, CreatorStats, Thesis, TouchMarket, TradeSide, Traded};

#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    /// Writable: records the creator fees this trade adds to what's owed.
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint)]
    pub config: Box<Account<'info, Config>>,

    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: SystemAccount<'info>,

    /// Receives the creator half of pm-AMM's fee; the balance change is the
    /// fee attributed to this thesis.
    #[account(mut, associated_token::mint = usdc_mint, associated_token::authority = authority)]
    pub treasury: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [THESIS_SEED, thesis.creator.as_ref(), thesis.id.to_le_bytes().as_ref()],
        bump = thesis.bump,
    )]
    pub thesis: Box<Account<'info, Thesis>>,

    #[account(mut, seeds = [CREATOR_SEED, thesis.creator.as_ref()], bump = creator_stats.bump)]
    pub creator_stats: Box<Account<'info, CreatorStats>>,

    #[account(seeds = [TOUCH_SEED, touch_market.pm_market.as_ref()], bump = touch_market.bump)]
    pub touch_market: Box<Account<'info, TouchMarket>>,

    /// CHECK: the pm-AMM market of `touch_market`; pm-AMM checks its mints/vault.
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

    #[account(mut, token::mint = usdc_mint, token::authority = trader)]
    pub trader_usdc: Box<Account<'info, TokenAccount>>,

    /// The trader's YES ATA: one account per wallet, so the cover cap below
    /// can't be dodged by spreading YES across accounts.
    #[account(mut, associated_token::mint = yes_mint, associated_token::authority = trader)]
    pub trader_yes: Box<Account<'info, TokenAccount>>,

    #[account(mut, associated_token::mint = no_mint, associated_token::authority = trader)]
    pub trader_no: Box<Account<'info, TokenAccount>>,

    /// CHECK: the protocol DAO's USDC ATA (pm-AMM's fee recipient).
    #[account(
        mut,
        address = anchor_spl::associated_token::get_associated_token_address(&PROTOCOL_DAO, &usdc_mint.key())
            @ ThesisError::WrongDaoAccount,
    )]
    pub dao_usdc: UncheckedAccount<'info>,

    pub pm_amm_program: Program<'info, PmAmm>,
    pub token_program: Program<'info, Token>,
}

/// Routes a swap through the pm-AMM so the thesis creator gets credit.
///
/// Swaps that bypass Thesis still pay the treasury, but earn the creator
/// nothing. Budget ~1M CU: pm-AMM accrues before every swap.
pub fn handler(ctx: Context<Trade>, side: TradeSide, amount_in: u64, min_output: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, ThesisError::Paused);
    require!(amount_in > 0, ThesisError::ZeroAmount);

    let tm_key = ctx.accounts.touch_market.key();
    let thesis = &ctx.accounts.thesis;
    let is_protection = tm_key == thesis.protection_market;
    require!(tm_key == thesis.conviction_market || is_protection, ThesisError::MarketNotInThesis);
    let tm = &ctx.accounts.touch_market;
    require!(!tm.touched && !tm.settled, ThesisError::MarketClosed);

    let treasury_before = ctx.accounts.treasury.amount;
    let usdc_before = ctx.accounts.trader_usdc.amount;
    let yes_before = ctx.accounts.trader_yes.amount;
    let no_before = ctx.accounts.trader_no.amount;

    let direction = match side {
        TradeSide::BuyYes => SwapDirection::UsdcToYes,
        TradeSide::BuyNo => SwapDirection::UsdcToNo,
        TradeSide::SellYes => SwapDirection::YesToUsdc,
        TradeSide::SellNo => SwapDirection::NoToUsdc,
    };
    pm_amm::cpi::swap(
        CpiContext::new(
            ctx.accounts.pm_amm_program.key(),
            pm_amm::cpi::accounts::Swap {
                signer: ctx.accounts.trader.to_account_info(),
                market: ctx.accounts.pm_market.to_account_info(),
                collateral_mint: ctx.accounts.usdc_mint.to_account_info(),
                yes_mint: ctx.accounts.yes_mint.to_account_info(),
                no_mint: ctx.accounts.no_mint.to_account_info(),
                vault: ctx.accounts.vault.to_account_info(),
                user_collateral: ctx.accounts.trader_usdc.to_account_info(),
                user_yes: ctx.accounts.trader_yes.to_account_info(),
                user_no: ctx.accounts.trader_no.to_account_info(),
                dao_usdc: ctx.accounts.dao_usdc.to_account_info(),
                // Always the treasury: the creator half of the fee can't go elsewhere.
                creator_usdc: Some(ctx.accounts.treasury.to_account_info()),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
        ),
        direction,
        amount_in,
        min_output,
    )?;

    ctx.accounts.treasury.reload()?;
    ctx.accounts.trader_usdc.reload()?;
    ctx.accounts.trader_yes.reload()?;
    ctx.accounts.trader_no.reload()?;

    let fee = ctx.accounts.treasury.amount.checked_sub(treasury_before).ok_or(ThesisError::Overflow)?;
    let usdc_after = ctx.accounts.trader_usdc.amount;
    let usdc_amount = usdc_after.abs_diff(usdc_before);
    let token_amount = match side {
        TradeSide::BuyYes => ctx.accounts.trader_yes.amount.saturating_sub(yes_before),
        TradeSide::BuyNo => ctx.accounts.trader_no.amount.saturating_sub(no_before),
        TradeSide::SellYes | TradeSide::SellNo => amount_in,
    };

    // Cover cap: each YES pays $1 on a touch, so the YES balance is the cover.
    if is_protection && side == TradeSide::BuyYes {
        require!(
            ctx.accounts.trader_yes.amount <= ctx.accounts.config.max_cover_per_wallet,
            ThesisError::CoverCapExceeded
        );
    }

    let trader = ctx.accounts.trader.key();
    let t = &mut ctx.accounts.thesis;
    let is_creator = trader == t.creator;
    t.volume_usdc = t.volume_usdc.checked_add(usdc_amount).ok_or(ThesisError::Overflow)?;
    if is_creator {
        t.self_volume_usdc = t.self_volume_usdc.checked_add(usdc_amount).ok_or(ThesisError::Overflow)?;
    }
    let share = ctx.accounts.config.creator_share_bps;
    let earned_before = t.creator_fees_earned(share);
    t.fees_attributed = t.fees_attributed.checked_add(fee).ok_or(ThesisError::Overflow)?;
    let newly_owed = t.creator_fees_earned(share).saturating_sub(earned_before);
    let config = &mut ctx.accounts.config;
    config.creator_fees_owed = config.creator_fees_owed.checked_add(newly_owed).ok_or(ThesisError::Overflow)?;
    let stats = &mut ctx.accounts.creator_stats;
    stats.total_volume = stats.total_volume.checked_add(usdc_amount).ok_or(ThesisError::Overflow)?;

    emit!(Traded {
        thesis: t.key(),
        touch_market: tm_key,
        trader,
        side,
        usdc_amount,
        token_amount,
        fee_to_treasury: fee,
        is_creator,
    });
    Ok(())
}
