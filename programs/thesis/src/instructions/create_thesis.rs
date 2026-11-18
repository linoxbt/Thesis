use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::ThesisError;
use crate::state::{Config, CreatorStats, Thesis, ThesisCreated, TouchMarket};

#[derive(Accounts)]
pub struct CreateThesis<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        init_if_needed,
        payer = creator,
        space = 8 + CreatorStats::INIT_SPACE,
        seeds = [CREATOR_SEED, creator.key().as_ref()],
        bump,
    )]
    pub creator_stats: Box<Account<'info, CreatorStats>>,

    #[account(
        init,
        payer = creator,
        space = 8 + Thesis::INIT_SPACE,
        seeds = [THESIS_SEED, creator.key().as_ref(), creator_stats.next_thesis_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub thesis: Box<Account<'info, Thesis>>,

    #[account(mut, seeds = [TOUCH_SEED, conviction_market.pm_market.as_ref()], bump = conviction_market.bump)]
    pub conviction_market: Box<Account<'info, TouchMarket>>,

    #[account(mut, seeds = [TOUCH_SEED, protection_market.pm_market.as_ref()], bump = protection_market.bump)]
    pub protection_market: Option<Box<Account<'info, TouchMarket>>>,

    pub system_program: Program<'info, System>,
}

/// Links the creator's own, unlinked, open touch markets into a thesis.
pub fn handler(ctx: Context<CreateThesis>, text_hash: [u8; 32]) -> Result<()> {
    require!(!ctx.accounts.config.paused, ThesisError::Paused);
    let creator = ctx.accounts.creator.key();
    let now = Clock::get()?.unix_timestamp;
    let thesis_key = ctx.accounts.thesis.key();

    let check = |m: &TouchMarket| -> Result<()> {
        require_keys_eq!(m.creator, creator, ThesisError::NotMarketCreator);
        require_keys_eq!(m.origin_thesis, Pubkey::default(), ThesisError::MarketAlreadyLinked);
        require!(!m.touched && !m.settled && now < m.end_ts, ThesisError::MarketClosed);
        // Link only fresh markets: a track record can't be built by linking a
        // market once its outcome is clear (e.g. crossed but not yet proven).
        require!(now.saturating_sub(m.start_ts) <= THESIS_LINK_WINDOW_SECS, ThesisError::LinkWindowPassed);
        Ok(())
    };

    let conviction = &mut ctx.accounts.conviction_market;
    check(conviction)?;
    let protection_key = match ctx.accounts.protection_market.as_mut() {
        Some(p) => {
            check(p)?;
            require!(p.key() != conviction.key(), ThesisError::ProtectionSameDirection);
            require!(p.direction != conviction.direction, ThesisError::ProtectionSameDirection);
            require!(p.feed_id == conviction.feed_id && p.end_ts == conviction.end_ts, ThesisError::MarketsMismatch);
            p.origin_thesis = thesis_key;
            p.key()
        }
        None => Pubkey::default(),
    };
    conviction.origin_thesis = thesis_key;

    let stats = &mut ctx.accounts.creator_stats;
    let id = stats.next_thesis_id;
    stats.creator = creator;
    stats.bump = ctx.bumps.creator_stats;
    stats.next_thesis_id = id.checked_add(1).ok_or(ThesisError::Overflow)?;
    stats.posted = stats.posted.checked_add(1).ok_or(ThesisError::Overflow)?;

    let t = &mut ctx.accounts.thesis;
    t.creator = creator;
    t.id = id;
    t.conviction_market = conviction.key();
    t.protection_market = protection_key;
    t.text_hash = text_hash;
    t.created_ts = now;
    t.end_ts = conviction.end_ts;
    t.volume_usdc = 0;
    t.self_volume_usdc = 0;
    t.fees_attributed = 0;
    t.fees_claimed = 0;
    t.outcome = 0;
    t.bump = ctx.bumps.thesis;

    emit!(ThesisCreated {
        thesis: thesis_key,
        creator,
        id,
        conviction_market: t.conviction_market,
        protection_market: protection_key,
        text_hash,
        end_ts: t.end_ts,
    });
    Ok(())
}
