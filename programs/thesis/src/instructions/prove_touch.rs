use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::ThesisError;
use crate::pyth::parse_price_update;
use crate::state::{Config, Direction, TouchMarket, Touched};

#[derive(Accounts)]
pub struct ProveTouch<'info> {
    pub prover: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(mut, seeds = [TOUCH_SEED, touch_market.pm_market.as_ref()], bump = touch_market.bump)]
    pub touch_market: Box<Account<'info, TouchMarket>>,

    /// CHECK: a Pyth `PriceUpdateV2`; owner and layout are checked in the handler.
    pub price_update: UncheckedAccount<'info>,
}

/// One counterexample settles it: a fully verified Pyth price for this feed,
/// published inside the window, on the far side of the strike, with a tight
/// confidence interval. Checks follow spec §5 in order.
pub fn handler(ctx: Context<ProveTouch>) -> Result<()> {
    let config = &ctx.accounts.config;
    let m = &mut ctx.accounts.touch_market;
    require!(!m.touched && !m.settled, ThesisError::AlreadyFinal);

    let info = ctx.accounts.price_update.to_account_info();
    require_keys_eq!(*info.owner, config.pyth_receiver, ThesisError::WrongPriceOwner);
    let p = {
        let data = info.try_borrow_data()?;
        parse_price_update(&data)?
    };

    require!(p.fully_verified, ThesisError::NotFullyVerified);
    require!(p.feed_id == m.feed_id, ThesisError::WrongFeed);
    require!(
        p.publish_time >= m.start_ts && p.publish_time <= m.end_ts,
        ThesisError::OutsideWindow
    );
    require!(p.exponent == m.expo, ThesisError::WrongExpo);
    require!(p.price > 0, ThesisError::NonPositivePrice);
    require!(
        (p.conf as i128) * 10_000 <= (p.price as i128) * (config.max_conf_bps as i128),
        ThesisError::ConfTooWide
    );
    let crossed = match m.direction {
        Direction::Below => p.price <= m.strike,
        Direction::Above => p.price >= m.strike,
    };
    require!(crossed, ThesisError::NoTouch);

    m.touched = true;
    m.touch_price = p.price;
    m.touch_publish_time = p.publish_time;
    m.prover = ctx.accounts.prover.key();

    emit!(Touched {
        touch_market: m.key(),
        price: p.price,
        publish_time: p.publish_time,
        prover: m.prover,
    });
    Ok(())
}
