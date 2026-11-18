use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::ThesisError;
use crate::pm_amm;
use crate::pm_amm::program::PmAmm;
use crate::state::{Config, Direction, TouchMarket, TouchMarketCreated};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateTouchMarketArgs {
    /// pm-AMM market id. pm-AMM ids share one namespace across every user, so
    /// callers pick a random/hashed u64; a taken id makes the CPI fail cleanly.
    pub market_id: u64,
    pub direction: Direction,
    pub strike: i64,
    pub expo: i32,
    pub end_ts: i64,
    /// Phase 0: supplied by the admin/keeper. Phase 1 computes it onchain from a
    /// Pyth spot price and `Config.sol_vol_bps`, and opens creation to anyone.
    pub initial_price_bps: u16,
    pub seed_amount: u64,
    pub name: String,
}

#[derive(Accounts)]
#[instruction(args: CreateTouchMarketArgs)]
pub struct CreateTouchMarket<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint)]
    pub config: Box<Account<'info, Config>>,

    #[account(mut, seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: SystemAccount<'info>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = authority,
    )]
    pub treasury: Box<Account<'info, TokenAccount>>,

    pub usdc_mint: Box<Account<'info, Mint>>,

    /// CHECK: created by pm-AMM `initialize_market`; address checked below.
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

    /// CHECK: the treasury's LP position, created by pm-AMM `deposit_liquidity`.
    #[account(
        mut,
        seeds = [PM_LP_SEED, pm_market.key().as_ref(), authority.key().as_ref()],
        bump,
        seeds::program = pm_amm::ID,
    )]
    pub lp_position: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
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
    let config = &ctx.accounts.config;
    let payer = ctx.accounts.payer.key();
    require!(!config.paused, ThesisError::Paused);
    require!(
        payer == config.admin || payer == config.keeper,
        ThesisError::Unauthorized
    );
    require!(
        args.seed_amount > 0 && args.seed_amount <= config.max_seed_per_market,
        ThesisError::InvalidSeed
    );
    require!(args.strike > 0, ThesisError::InvalidStrike);
    require!(
        (100..=9900).contains(&args.initial_price_bps),
        ThesisError::InvalidOpeningPrice
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        args.end_ts > now.checked_add(PM_MIN_DURATION_SECS).ok_or(ThesisError::Overflow)?,
        ThesisError::InvalidWindow
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
        args.initial_price_bps,
    )?;

    // 2. Seed it from the treasury.
    pm_amm::cpi::deposit_liquidity(
        CpiContext::new_with_signer(
            pm_program,
            pm_amm::cpi::accounts::DepositLiquidity {
                signer: ctx.accounts.authority.to_account_info(),
                market: ctx.accounts.pm_market.to_account_info(),
                collateral_mint: ctx.accounts.usdc_mint.to_account_info(),
                vault: ctx.accounts.vault.to_account_info(),
                user_collateral: ctx.accounts.treasury.to_account_info(),
                lp_position: ctx.accounts.lp_position.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
            signer_seeds,
        ),
        args.seed_amount,
    )?;

    // 3. Record the touch terms.
    let tm = &mut ctx.accounts.touch_market;
    tm.pm_market = ctx.accounts.pm_market.key();
    tm.market_id = args.market_id;
    tm.feed_id = config.sol_usd_feed_id;
    tm.direction = args.direction;
    tm.strike = args.strike;
    tm.expo = args.expo;
    tm.start_ts = now;
    tm.end_ts = args.end_ts;
    tm.initial_price_bps = args.initial_price_bps;
    tm.touched = false;
    tm.touch_price = 0;
    tm.touch_publish_time = 0;
    tm.prover = Pubkey::default();
    tm.settled = false;
    tm.winning_side = 0;
    tm.origin_thesis = Pubkey::default();
    tm.seeded_by = ctx.accounts.authority.key();
    tm.seed_amount = args.seed_amount;
    tm.bump = ctx.bumps.touch_market;

    emit!(TouchMarketCreated {
        touch_market: tm.key(),
        pm_market: tm.pm_market,
        direction: tm.direction,
        strike: tm.strike,
        expo: tm.expo,
        end_ts: tm.end_ts,
        initial_price_bps: tm.initial_price_bps,
        seed_amount: tm.seed_amount,
    });
    Ok(())
}
