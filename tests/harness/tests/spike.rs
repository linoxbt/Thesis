//! Phase 0 spikes against the real pm-AMM and Metaplex bytecode (dumped from
//! devnet into tests/fixtures).
//!
//! Spike A: the Thesis `Authority` PDA can create, seed and resolve a pm-AMM
//! market through CPI, and the treasury receives the creator fee.
//! Spike B: `prove_touch` accepts exactly one kind of proof.
//! Spike C: compute units and price impact numbers for the plan.

use anchor_lang::prelude::Pubkey;
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::spl_token::state::{Account as TokenAccountState, AccountState, Mint};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_clock::Clock;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_program_pack::Pack;
use solana_signer::Signer;
use solana_transaction::Transaction;
use thesis::constants::*;
use thesis::pm_amm;
use thesis::pyth::{encode_price_update, PriceUpdate};
use thesis::state::{Config, Direction, TouchMarket};

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures");
const THESIS_SO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/thesis.so");
const MPL_ID: Pubkey = anchor_lang::pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const PROTOCOL_DAO: Pubkey = anchor_lang::pubkey!("4qXyczAr5DuBVaHUwmZT5Xt6hgQ6RwqBYcFGtrv8QEph");
const TOKEN_ID: Pubkey = anchor_spl::token::ID;
const SOL_USD_FEED: [u8; 32] = [
    0xef, 0x0d, 0x8b, 0x6f, 0xda, 0x2c, 0xeb, 0xa4, 0x1d, 0xa1, 0x5d, 0x40, 0x95, 0xd1, 0xda, 0x39,
    0x2a, 0x0d, 0x2f, 0x8e, 0xd0, 0xc6, 0xc7, 0xbc, 0x0f, 0x4c, 0xfa, 0xc8, 0xc2, 0x80, 0xb5, 0x6d,
];
const USDC: u64 = 1_000_000; // 6 decimals
const EXPO: i32 = -8;
const START_TS: i64 = 1_764_000_000;
const GRACE: u32 = 120;

fn px(dollars: f64) -> i64 {
    (dollars * 1e8).round() as i64
}

struct Env {
    svm: LiteSVM,
    admin: Keypair,
    usdc_mint: Pubkey,
    authority: Pubkey,
    treasury: Pubkey,
    config: Pubkey,
}

fn pda(seeds: &[&[u8]], program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(seeds, program).0
}

fn send(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair]) -> Result<u64, String> {
    let msg = Message::new(ixs, Some(&payer.pubkey()));
    let mut all: Vec<&Keypair> = vec![payer];
    all.extend_from_slice(signers);
    let tx = Transaction::new(&all, msg, svm.latest_blockhash());
    let res = svm
        .send_transaction(tx)
        .map(|m| m.compute_units_consumed)
        .map_err(|e| format!("{:?}\n{}", e.err, e.meta.logs.join("\n")));
    svm.expire_blockhash();
    res
}

fn set_clock(svm: &mut LiteSVM, ts: i64) {
    let mut c: Clock = svm.get_sysvar();
    c.unix_timestamp = ts;
    svm.set_sysvar(&c);
}

fn put_mint(svm: &mut LiteSVM, key: Pubkey) {
    let mut data = vec![0u8; Mint::LEN];
    Mint {
        mint_authority: Some(Pubkey::new_unique()).into(),
        supply: 0,
        decimals: 6,
        is_initialized: true,
        freeze_authority: None.into(),
    }
    .pack_into_slice(&mut data);
    svm.set_account(key, Account { lamports: 1_000_000_000, data, owner: TOKEN_ID, executable: false, rent_epoch: 0 })
        .unwrap();
}

fn put_token(svm: &mut LiteSVM, key: Pubkey, mint: Pubkey, owner: Pubkey, amount: u64) {
    let mut data = vec![0u8; TokenAccountState::LEN];
    TokenAccountState {
        mint,
        owner,
        amount,
        delegate: None.into(),
        state: AccountState::Initialized,
        is_native: None.into(),
        delegated_amount: 0,
        close_authority: None.into(),
    }
    .pack_into_slice(&mut data);
    svm.set_account(key, Account { lamports: 2_039_280, data, owner: TOKEN_ID, executable: false, rent_epoch: 0 })
        .unwrap();
}

fn token_amount(svm: &LiteSVM, key: Pubkey) -> u64 {
    TokenAccountState::unpack(&svm.get_account(&key).unwrap().data).unwrap().amount
}

fn read<T: AccountDeserialize>(svm: &LiteSVM, key: Pubkey) -> T {
    let acc = svm.get_account(&key).unwrap();
    T::try_deserialize(&mut acc.data.as_slice()).unwrap()
}

fn setup() -> Env {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(thesis::ID, THESIS_SO).unwrap();
    svm.add_program_from_file(pm_amm::ID, format!("{FIXTURES}/pm_amm.so")).unwrap();
    svm.add_program_from_file(MPL_ID, format!("{FIXTURES}/mpl_token_metadata.so")).unwrap();
    set_clock(&mut svm, START_TS);

    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 100_000_000_000).unwrap();
    let usdc_mint = Pubkey::new_unique();
    put_mint(&mut svm, usdc_mint);

    let config = pda(&[CONFIG_SEED], &thesis::ID);
    let authority = pda(&[AUTHORITY_SEED], &thesis::ID);
    let treasury = get_associated_token_address(&authority, &usdc_mint);

    let ix = Instruction {
        program_id: thesis::ID,
        accounts: thesis::accounts::InitializeConfig {
            admin: admin.pubkey(),
            config,
            authority,
            usdc_mint,
            treasury,
            system_program: anchor_lang::system_program::ID,
            token_program: TOKEN_ID,
            associated_token_program: anchor_spl::associated_token::ID,
        }
        .to_account_metas(None),
        data: thesis::instruction::InitializeConfig {
            args: thesis::instructions::InitializeConfigArgs {
                keeper: admin.pubkey(),
                sol_usd_feed_id: SOL_USD_FEED,
                creator_share_bps: 5000,
                grace_secs: GRACE,
                max_conf_bps: 50,
                max_seed_per_market: 100 * USDC,
                max_cover_per_wallet: 250 * USDC,
                authority_funding: 2_000_000_000,
            },
        }
        .data(),
    };
    send(&mut svm, &[ix], &admin, &[]).expect("initialize_config");

    // Fund the treasury with 1,000 mock USDC (stands in for the faucet).
    put_token(&mut svm, treasury, usdc_mint, authority, 1_000 * USDC);
    Env { svm, admin, usdc_mint, authority, treasury, config }
}

#[derive(Debug)]
struct Created {
    pm_market: Pubkey,
    touch_market: Pubkey,
    cu: u64,
}

fn create_market(env: &mut Env, market_id: u64, direction: Direction, strike: i64, window: i64, seed: u64, price_bps: u16) -> Result<Created, String> {
    let now = env.svm.get_sysvar::<Clock>().unix_timestamp;
    let pm_market = pda(&[PM_MARKET_SEED, &market_id.to_le_bytes()], &pm_amm::ID);
    let yes_mint = pda(&[PM_YES_MINT_SEED, pm_market.as_ref()], &pm_amm::ID);
    let no_mint = pda(&[PM_NO_MINT_SEED, pm_market.as_ref()], &pm_amm::ID);
    let vault = pda(&[PM_VAULT_SEED, pm_market.as_ref()], &pm_amm::ID);
    let yes_metadata = pda(&[b"metadata", MPL_ID.as_ref(), yes_mint.as_ref()], &MPL_ID);
    let no_metadata = pda(&[b"metadata", MPL_ID.as_ref(), no_mint.as_ref()], &MPL_ID);
    let lp_position = pda(&[PM_LP_SEED, pm_market.as_ref(), env.authority.as_ref()], &pm_amm::ID);
    let touch_market = pda(&[TOUCH_SEED, pm_market.as_ref()], &thesis::ID);

    let ix = Instruction {
        program_id: thesis::ID,
        accounts: thesis::accounts::CreateTouchMarket {
            payer: env.admin.pubkey(),
            config: env.config,
            authority: env.authority,
            treasury: env.treasury,
            usdc_mint: env.usdc_mint,
            pm_market,
            yes_mint,
            no_mint,
            vault,
            yes_metadata,
            no_metadata,
            lp_position,
            touch_market,
            pm_amm_program: pm_amm::ID,
            token_metadata_program: MPL_ID,
            system_program: anchor_lang::system_program::ID,
            token_program: TOKEN_ID,
            rent: anchor_lang::pubkey!("SysvarRent111111111111111111111111111111111"),
        }
        .to_account_metas(None),
        data: thesis::instruction::CreateTouchMarket {
            args: thesis::instructions::CreateTouchMarketArgs {
                market_id,
                direction,
                strike,
                expo: EXPO,
                end_ts: now + window,
                initial_price_bps: price_bps,
                seed_amount: seed,
                name: format!("SOL touch {market_id}"),
            },
        }
        .data(),
    };
    let budget = compute_budget(1_400_000);
    let admin = env.admin.insecure_clone();
    let cu = send(&mut env.svm, &[budget, ix], &admin, &[])?;
    Ok(Created { pm_market, touch_market, cu })
}

fn compute_budget(units: u32) -> Instruction {
    // ComputeBudgetInstruction::SetComputeUnitLimit = tag 2 + u32 LE.
    let mut data = vec![2u8];
    data.extend_from_slice(&units.to_le_bytes());
    Instruction {
        program_id: anchor_lang::pubkey!("ComputeBudget111111111111111111111111111111"),
        accounts: vec![],
        data,
    }
}

struct Trader {
    kp: Keypair,
    usdc: Pubkey,
    yes: Pubkey,
    no: Pubkey,
}

fn trader_for(env: &mut Env, pm_market: Pubkey, usdc: u64) -> Trader {
    let kp = Keypair::new();
    env.svm.airdrop(&kp.pubkey(), 1_000_000_000).unwrap();
    let yes_mint = pda(&[PM_YES_MINT_SEED, pm_market.as_ref()], &pm_amm::ID);
    let no_mint = pda(&[PM_NO_MINT_SEED, pm_market.as_ref()], &pm_amm::ID);
    let t = Trader { kp, usdc: Pubkey::new_unique(), yes: Pubkey::new_unique(), no: Pubkey::new_unique() };
    let owner = t.kp.pubkey();
    put_token(&mut env.svm, t.usdc, env.usdc_mint, owner, usdc);
    put_token(&mut env.svm, t.yes, yes_mint, owner, 0);
    put_token(&mut env.svm, t.no, no_mint, owner, 0);
    t
}

fn dao_usdc(env: &mut Env) -> Pubkey {
    let key = get_associated_token_address(&PROTOCOL_DAO, &env.usdc_mint);
    if env.svm.get_account(&key).is_none() {
        put_token(&mut env.svm, key, env.usdc_mint, PROTOCOL_DAO, 0);
    }
    key
}

/// A direct pm-AMM swap (not through Thesis), creator fee to the treasury.
fn buy(env: &mut Env, t: &Trader, pm_market: Pubkey, yes: bool, amount_in: u64) -> Result<u64, String> {
    let dao = dao_usdc(env);
    let ix = Instruction {
        program_id: pm_amm::ID,
        accounts: pm_amm::client::accounts::Swap {
            signer: t.kp.pubkey(),
            market: pm_market,
            collateral_mint: env.usdc_mint,
            yes_mint: pda(&[PM_YES_MINT_SEED, pm_market.as_ref()], &pm_amm::ID),
            no_mint: pda(&[PM_NO_MINT_SEED, pm_market.as_ref()], &pm_amm::ID),
            vault: pda(&[PM_VAULT_SEED, pm_market.as_ref()], &pm_amm::ID),
            user_collateral: t.usdc,
            user_yes: t.yes,
            user_no: t.no,
            dao_usdc: dao,
            creator_usdc: Some(env.treasury),
            token_program: TOKEN_ID,
        }
        .to_account_metas(None),
        data: pm_amm::client::args::Swap {
            direction: if yes { pm_amm::types::SwapDirection::UsdcToYes } else { pm_amm::types::SwapDirection::UsdcToNo },
            amount_in,
            min_output: 0,
        }
        .data(),
    };
    let kp = t.kp.insecure_clone();
    send(&mut env.svm, &[compute_budget(400_000), ix], &kp, &[])?;
    Ok(token_amount(&env.svm, if yes { t.yes } else { t.no }))
}

/// pm-AMM spot price, paper section 7: P = Phi((y - x) / L_eff),
/// x = YES reserve, y = NO reserve, L_eff = L_0 * sqrt(T - t). All I80F48.
fn yes_price_bps(env: &Env, pm_market: Pubkey) -> f64 {
    let m: pm_amm::accounts::Market = read(&env.svm, pm_market);
    let fx = |bits: u128| (bits as i128) as f64 / (1u64 << 48) as f64;
    let now = env.svm.get_sysvar::<Clock>().unix_timestamp;
    let l_eff = fx(m.l_zero) * ((m.end_ts - now) as f64).sqrt();
    let z = (fx(m.reserve_no) - fx(m.reserve_yes)) / l_eff;
    10_000.0 * normal_cdf(z)
}

/// Standard normal CDF via Abramowitz-Stegun 7.1.26 (error < 1.5e-7).
fn normal_cdf(z: f64) -> f64 {
    let x = z.abs() / std::f64::consts::SQRT_2;
    let t = 1.0 / (1.0 + 0.3275911 * x);
    let poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    let erf = 1.0 - poly * (-x * x).exp();
    if z >= 0.0 { 0.5 * (1.0 + erf) } else { 0.5 * (1.0 - erf) }
}

fn put_price(env: &mut Env, u: PriceUpdate) -> Pubkey {
    let key = Pubkey::new_unique();
    let data = encode_price_update(&u, [9u8; 32], 1);
    env.svm
        .set_account(key, Account { lamports: 2_000_000, data, owner: PYTH_RECEIVER_ID, executable: false, rent_epoch: 0 })
        .unwrap();
    key
}

fn prove(env: &mut Env, touch_market: Pubkey, price_update: Pubkey) -> Result<u64, String> {
    let prover = Keypair::new();
    env.svm.airdrop(&prover.pubkey(), 100_000_000).unwrap();
    let ix = Instruction {
        program_id: thesis::ID,
        accounts: thesis::accounts::ProveTouch { prover: prover.pubkey(), config: env.config, touch_market, price_update }
            .to_account_metas(None),
        data: thesis::instruction::ProveTouch {}.data(),
    };
    send(&mut env.svm, &[ix], &prover, &[])
}

fn settle(env: &mut Env, c: &Created) -> Result<u64, String> {
    let cranker = Keypair::new();
    env.svm.airdrop(&cranker.pubkey(), 100_000_000).unwrap();
    let ix = Instruction {
        program_id: thesis::ID,
        accounts: thesis::accounts::Settle {
            cranker: cranker.pubkey(),
            config: env.config,
            authority: env.authority,
            touch_market: c.touch_market,
            pm_market: c.pm_market,
            pm_amm_program: pm_amm::ID,
        }
        .to_account_metas(None),
        data: thesis::instruction::Settle {}.data(),
    };
    send(&mut env.svm, &[ix], &cranker, &[])
}

fn good_update(publish_time: i64, price: i64) -> PriceUpdate {
    PriceUpdate { fully_verified: true, feed_id: SOL_USD_FEED, price, conf: (price / 10_000) as u64, exponent: EXPO, publish_time }
}

#[test]
fn spike_a_pda_authority_create_seed_trade_resolve() {
    let mut env = setup();
    let c = create_market(&mut env, 0x7e51_0001, Direction::Below, px(180.0), 600, 100 * USDC, 2_500)
        .expect("create_touch_market via PDA authority");
    println!("[spike C] create_touch_market (initialize_market + deposit_liquidity CPI): {} CU", c.cu);

    let open = yes_price_bps(&env, c.pm_market);
    assert!((open - 2_500.0).abs() < 5.0, "opening YES price {open} bps, wanted 2500");
    let m: pm_amm::accounts::Market = read(&env.svm, c.pm_market);
    assert_eq!(m.authority, env.authority, "pm-AMM market authority must be the Thesis PDA");
    assert!(m.l_zero > 0, "market must be seeded");
    assert_eq!(token_amount(&env.svm, env.treasury), 900 * USDC, "seed left the treasury");
    let tm: TouchMarket = read(&env.svm, c.touch_market);
    assert_eq!(tm.pm_market, c.pm_market);
    assert_eq!(tm.start_ts, START_TS);
    let cfg: Config = read(&env.svm, env.config);
    assert_eq!(cfg.creator_share_bps, 5000);

    // A direct pm-AMM swap pays 1% to the treasury (creator half of the 2% fee).
    let t = trader_for(&mut env, c.pm_market, 100 * USDC);
    buy(&mut env, &t, c.pm_market, true, 10 * USDC).expect("swap");
    assert_eq!(token_amount(&env.svm, env.treasury), 900 * USDC + 100_000, "treasury earns 1% of 10 USDC");

    // Settling early fails; after end + grace it resolves NO (no touch proven).
    assert!(settle(&mut env, &c).unwrap_err().contains("TooEarly"));
    set_clock(&mut env.svm, tm.end_ts + GRACE as i64 - 1);
    assert!(settle(&mut env, &c).is_err());
    set_clock(&mut env.svm, tm.end_ts + GRACE as i64);
    settle(&mut env, &c).expect("settle NO");
    let m: pm_amm::accounts::Market = read(&env.svm, c.pm_market);
    assert!(m.resolved);
    assert_eq!(m.winning_side, 2, "NO wins without a proof");
    assert!(settle(&mut env, &c).is_err(), "settle is once only");
}

#[test]
fn spike_b_prove_touch_rules_then_settle_yes() {
    let mut env = setup();
    let strike = px(180.0);
    let c = create_market(&mut env, 0x7e51_0002, Direction::Below, strike, 600, 50 * USDC, 3_000).unwrap();
    let tm: TouchMarket = read(&env.svm, c.touch_market);
    let inside = START_TS + 60;

    let cases: Vec<(&str, PriceUpdate)> = vec![
        ("NotFullyVerified", PriceUpdate { fully_verified: false, ..good_update(inside, strike - 1) }),
        ("WrongFeed", PriceUpdate { feed_id: [1u8; 32], ..good_update(inside, strike - 1) }),
        ("OutsideWindow", good_update(START_TS - 1, strike - 1)), // before the market existed
        ("OutsideWindow", good_update(tm.end_ts + 1, strike - 1)),
        ("WrongExpo", PriceUpdate { exponent: -6, ..good_update(inside, strike - 1) }),
        ("ConfTooWide", PriceUpdate { conf: ((strike - 1) / 100) as u64, ..good_update(inside, strike - 1) }), // 1% > 0.5%
        ("NoTouch", good_update(inside, strike + 1)),
    ];
    for (want, u) in cases {
        let key = put_price(&mut env, u);
        let err = prove(&mut env, c.touch_market, key).unwrap_err();
        assert!(err.contains(want), "expected {want}, got:\n{err}");
    }
    // Right data, wrong owner.
    let key = Pubkey::new_unique();
    env.svm
        .set_account(key, Account {
            lamports: 2_000_000,
            data: encode_price_update(&good_update(inside, strike), [9u8; 32], 1),
            owner: Pubkey::new_unique(),
            executable: false,
            rent_epoch: 0,
        })
        .unwrap();
    assert!(prove(&mut env, c.touch_market, key).unwrap_err().contains("WrongPriceOwner"));

    // Exactly at the strike counts as a touch.
    let key = put_price(&mut env, good_update(inside, strike));
    let cu = prove(&mut env, c.touch_market, key).expect("valid proof");
    println!("[spike C] prove_touch: {cu} CU");
    let tm: TouchMarket = read(&env.svm, c.touch_market);
    assert!(tm.touched);
    assert_eq!(tm.touch_price, strike);
    let key = put_price(&mut env, good_update(inside + 1, strike - 5));
    assert!(prove(&mut env, c.touch_market, key).unwrap_err().contains("AlreadyFinal"));

    set_clock(&mut env.svm, tm.end_ts + GRACE as i64);
    let cu = settle(&mut env, &c).expect("settle YES");
    println!("[spike C] settle (resolve_market CPI): {cu} CU");
    let m: pm_amm::accounts::Market = read(&env.svm, c.pm_market);
    assert_eq!(m.winning_side, 1, "YES wins after a proven touch");
}

#[test]
fn spike_b_touch_above_and_late_proof_in_grace() {
    let mut env = setup();
    let strike = px(250.0);
    let c = create_market(&mut env, 0x7e51_0003, Direction::Above, strike, 600, 25 * USDC, 1_500).unwrap();
    let tm: TouchMarket = read(&env.svm, c.touch_market);
    // A proof published inside the window but submitted during the grace period.
    set_clock(&mut env.svm, tm.end_ts + 30);
    let key = put_price(&mut env, good_update(tm.end_ts, strike + 1));
    prove(&mut env, c.touch_market, key).expect("late proof inside grace");
    set_clock(&mut env.svm, tm.end_ts + GRACE as i64);
    settle(&mut env, &c).unwrap();
    let m: pm_amm::accounts::Market = read(&env.svm, c.pm_market);
    assert_eq!(m.winning_side, 1);
}

#[test]
fn guards_on_create() {
    let mut env = setup();
    // Seed above the cap, window under pm-AMM's 300 s minimum, bad opening price.
    assert!(create_market(&mut env, 0x7e51_0010, Direction::Below, px(180.0), 600, 101 * USDC, 2_500).unwrap_err().contains("InvalidSeed"));
    assert!(create_market(&mut env, 0x7e51_0011, Direction::Below, px(180.0), 200, 25 * USDC, 2_500).unwrap_err().contains("InvalidWindow"));
    assert!(create_market(&mut env, 0x7e51_0012, Direction::Below, px(180.0), 600, 25 * USDC, 50).unwrap_err().contains("InvalidOpeningPrice"));
    // A taken pm-AMM market id fails cleanly.
    create_market(&mut env, 0x7e51_0013, Direction::Below, px(180.0), 600, 25 * USDC, 2_500).unwrap();
    assert!(create_market(&mut env, 0x7e51_0013, Direction::Below, px(170.0), 600, 25 * USDC, 2_500).is_err());
}

#[test]
fn spike_c_price_impact_table() {
    println!("\n[spike C] price impact of USDC->YES buys (opening price 25%)");
    println!("{:>8} {:>8} {:>12} {:>12} {:>10}", "seed", "buy", "YES before", "YES after", "impact");
    for (i, seed) in [25u64, 100].into_iter().enumerate() {
        for (j, size) in [10u64, 50, 250].into_iter().enumerate() {
            let mut env = setup();
            let id = 0x7e51_1000 + (i * 10 + j) as u64;
            let c = create_market(&mut env, id, Direction::Below, px(180.0), 48 * 3600, seed * USDC, 2_500).unwrap();
            let before = yes_price_bps(&env, c.pm_market);
            let t = trader_for(&mut env, c.pm_market, 1_000 * USDC);
            let res = buy(&mut env, &t, c.pm_market, true, size * USDC);
            match res {
                Ok(_) => {
                    let after = yes_price_bps(&env, c.pm_market);
                    println!("{:>7}$ {:>7}$ {:>11.1}% {:>11.1}% {:>+9.1}pt", seed, size, before / 100.0, after / 100.0, (after - before) / 100.0);
                }
                Err(e) => println!("{:>7}$ {:>7}$ {:>11.1}%  swap failed: {}", seed, size, before / 100.0, e.lines().next().unwrap_or("")),
            }
        }
    }
}
