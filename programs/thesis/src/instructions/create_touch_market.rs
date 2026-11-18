use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::ThesisError;
use crate::pm_amm;
use crate::pm_amm::program::PmAmm;
use crate::pricing::{distance_bps, opening_price_bps};
use crate::pyth::verified_price;
use crate::state::{Config, Direction, TouchMarket, TouchMarketCreated};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateTouchMarketArgs {
    /// pm-AMM market id. pm-AMM ids share one namespace across every user of
    /// the pm-AMM, and any id the program derived would be predictable (so
    /// easier to squat). Clients send a random u64 and retry with a new one if
    /// the CPI reports the market account already exists.
    pub market_id: u64,
    pub direction: Direction,
    /// Strike in the same exponent as the spot price update.
    pub strike: i64,
    pub end_ts: i64,
    pub seed_amount: u64,
    /// Seed from the treasury (admin/keeper only, within `sponsor_budget`)
    /// instead of from the creator's own USDC.
    pub sponsored: bool,
    pub name: String,
}

#[derive(Accounts)]
#[instruction(args: CreateTouchMarketArgs)]
pub struct CreateTouchMarket<'info> {
    /// The creator. Pays the TouchMarket rent, and the seed unless sponsored.
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint)]
    pub config: Box<Account<'info, Config>>,

    #[account(mut, seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: SystemAccount<'info>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = authority,
    )]
    pub treasury: Box<Account<'info, TokenAccount>>,

    /// The creator's USDC; required unless `sponsored`.
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = creator,
    )]
    pub creator_usdc: Option<Box<Account<'info, TokenAccount>>>,

    pub usdc_mint: Box<Account<'info, Mint>>,

    /// CHECK: Pyth `PriceUpdateV2` for spot; checked by `verified_price`.
    pub price_update: UncheckedAccount<'info>,

    /// CHECK: created by pm-AMM `initialize_market`.
    #[account(
        mut,
        seeds = [PM_MARKET_SEED, args.market_id.to_le_bytes().as_ref()],
        bump,
        seeds::program = pm_amm::ID,
    )]
    pub pm_market: UncheckedAccount<'info>,

    /// CHECK: created by pm-AMM.
    #[account(mut, seeds = [PM_YES_MINT_SEED, pm_market.key().as_ref()], bump, seeds::program = pm_amm::ID)]
    pub yes_mint: UncheckedAccount<'info>,

    /// CHECK: created by pm-AMM.
    #[account(mut, seeds = [PM_NO_MINT_SEED, pm_market.key().as_ref()], bump, seeds::program = pm_amm::ID)]
    pub no_mint: UncheckedAccount<'info>,

    /// CHECK: created by pm-AMM.
    #[account(mut, seeds = [PM_VAULT_SEED, pm_market.key().as_ref()], bump, seeds::program = pm_amm::ID)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: Metaplex metadata PDA for the YES mint; Metaplex validates it.
    #[account(mut)]
    pub yes_metadata: UncheckedAccount<'info>,

    /// CHECK: Metaplex metadata PDA for the NO mint; Metaplex validates it.
    #[account(mut)]
    pub no_metadata: UncheckedAccount<'info>,

    /// CHECK: the seeder's pm-AMM LP position (`["lp", market, seeder]`, seeder =
    /// Authority if sponsored, else the creator); pm-AMM checks the seeds.
    #[account(mut)]
    pub lp_position: UncheckedAccount<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + TouchMarket::INIT_SPACE,
        seeds = [TOUCH_SEED, pm_market.key().as_ref()],
        bump,
    )]
    pub touch_market: Box<Account<'info, TouchMarket>>,

    pub pm_amm_program: Program<'info, PmAmm>,

    /// CHECK: pm-AMM pins this to the Metaplex Token Metadata program.
    pub token_metadata_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<CreateTouchMarket>, args: CreateTouchMarketArgs) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let creator = ctx.accounts.creator.key();
    let config = &ctx.accounts.config;
    require!(!config.paused, ThesisError::Paused);

    // --- Seed rules ---
    require!(
        args.seed_amount >= config.min_seed_per_market && args.seed_amount <= config.max_seed_per_market,
        ThesisError::InvalidSeed
    );
    if args.sponsored {
        require!(creator == config.admin || creator == config.keeper, ThesisError::SponsorNotAllowed);
        require!(args.seed_amount <= config.sponsor_budget, ThesisError::SponsorBudgetExhausted);
    } else {
        require!(ctx.accounts.creator_usdc.is_some(), ThesisError::MissingCreatorUsdc);
    }

    // --- Window ---
    let tau = args.end_ts.checked_sub(now).ok_or(ThesisError::Overflow)?;
    require!(tau > PM_MIN_DURATION_SECS, ThesisError::InvalidWindow);

    // --- Spot and volatility ---
    let spot = verified_price(
        &ctx.accounts.price_update.to_account_info(),
        &config.pyth_receiver,
        &config.sol_usd_feed_id,
        config.max_conf_bps,
    )?;
    require!(
        spot.publish_time <= now && now - spot.publish_time <= config.max_spot_age_secs as i64,
        ThesisError::StaleSpot
    );
    require!(
        now.saturating_sub(config.vol_updated_ts) <= config.max_vol_age_secs as i64,
        ThesisError::StaleVolatility
    );

    // --- Strike rules (spec section 6) ---
    require!(args.strike > 0, ThesisError::InvalidStrike);
    match args.direction {
        Direction::Below => require!(args.strike < spot.price, ThesisError::StrikeWrongSide),
        Direction::Above => require!(args.strike > spot.price, ThesisError::StrikeWrongSide),
    }
    let dist = distance_bps(spot.price, args.strike).ok_or(ThesisError::Overflow)?;
    require!(dist >= config.min_strike_distance_bps as u64, ThesisError::StrikeTooClose);
    require!(dist <= config.max_strike_distance_bps as u64, ThesisError::StrikeTooFar);

    // --- Opening price, computed here, never passed in ---
    let open_bps = opening_price_bps(spot.price, args.strike, config.sol_vol_bps, tau)
        .ok_or(ThesisError::Overflow)?;
    require!(
        open_bps >= config.min_open_bps && open_bps <= config.max_open_bps,
        ThesisError::OpeningPriceOutOfRange
    );

    let authority_bump = [config.authority_bump];
    let signer_seeds: &[&[&[u8]]] = &[&[AUTHORITY_SEED, &authority_bump]];
    let pm_program = ctx.accounts.pm_amm_program.key();

    // 1. Create the pm-AMM market with the Authority PDA as its authority.
    pm_amm::cpi::initialize_market(
        CpiContext::new_with_signer(
            pm_program,
            pm_amm::cpi::accounts::InitializeMarket {
                authority: ctx.accounts.authority.to_account_info(),
                market: ctx.accounts.pm_market.to_account_info(),
                collateral_mint: ctx.accounts.usdc_mint.to_account_info(),
                yes_mint: ctx.accounts.yes_mint.to_account_info(),
                no_mint: ctx.accounts.no_mint.to_account_info(),
                vault: ctx.accounts.vault.to_account_info(),
                yes_metadata: ctx.accounts.yes_metadata.to_account_info(),
                no_metadata: ctx.accounts.no_metadata.to_account_info(),
                token_metadata_program: ctx.accounts.token_metadata_program.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            signer_seeds,
        ),
        args.market_id,
        args.end_ts,
        args.name.clone(),
        open_bps,
    )?;

    // 2. Seed it: from the treasury (sponsored) or from the creator.
    let seeder = if args.sponsored {
        let accounts = pm_amm::cpi::accounts::DepositLiquidity {
            signer: ctx.accounts.authority.to_account_info(),
            market: ctx.accounts.pm_market.to_account_info(),
            collateral_mint: ctx.accounts.usdc_mint.to_account_info(),
            vault: ctx.accounts.vault.to_account_info(),
            user_collateral: ctx.accounts.treasury.to_account_info(),
            lp_position: ctx.accounts.lp_position.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };
        pm_amm::cpi::deposit_liquidity(
            CpiContext::new_with_signer(pm_program, accounts, signer_seeds),
            args.seed_amount,
        )?;
        ctx.accounts.authority.key()
    } else {
        let creator_usdc = ctx.accounts.creator_usdc.as_ref().ok_or(ThesisError::MissingCreatorUsdc)?;
        let accounts = pm_amm::cpi::accounts::DepositLiquidity {
            signer: ctx.accounts.creator.to_account_info(),
            market: ctx.accounts.pm_market.to_account_info(),
            collateral_mint: ctx.accounts.usdc_mint.to_account_info(),
            vault: ctx.accounts.vault.to_account_info(),
            user_collateral: creator_usdc.to_account_info(),
            lp_position: ctx.accounts.lp_position.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };
        pm_amm::cpi::deposit_liquidity(CpiContext::new(pm_program, accounts), args.seed_amount)?;
        creator
    };

    if args.sponsored {
        let config = &mut ctx.accounts.config;
        config.sponsor_budget = config
            .sponsor_budget
            .checked_sub(args.seed_amount)
            .ok_or(ThesisError::SponsorBudgetExhausted)?;
    }

    // 3. Record the touch terms.
    let tm = &mut ctx.accounts.touch_market;
    tm.pm_market = ctx.accounts.pm_market.key();
    tm.market_id = args.market_id;
    tm.feed_id = ctx.accounts.config.sol_usd_feed_id;
    tm.direction = args.direction;
    tm.strike = args.strike;
    tm.expo = spot.exponent;
    tm.start_ts = now;
    tm.end_ts = args.end_ts;
    tm.initial_price_bps = open_bps;
    tm.touched = false;
    tm.touch_price = 0;
    tm.touch_publish_time = 0;
    tm.prover = Pubkey::default();
    tm.settled = false;
    tm.winning_side = 0;
    tm.origin_thesis = Pubkey::default();
    tm.creator = creator;
    tm.seeded_by = seeder;
    tm.seed_amount = args.seed_amount;
    tm.spot_at_open = spot.price;
    tm.bump = ctx.bumps.touch_market;

    emit!(TouchMarketCreated {
        touch_market: tm.key(),
        pm_market: tm.pm_market,
        creator,
        direction: tm.direction,
        strike: tm.strike,
        expo: tm.expo,
        spot: spot.price,
        end_ts: tm.end_ts,
        initial_price_bps: open_bps,
        seed_amount: tm.seed_amount,
        sponsored: args.sponsored,
    });
    Ok(())
}
