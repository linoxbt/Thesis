//! Thesis program tests (Phase 0 spikes + Phase 1 engine), run in LiteSVM
//! against the real pm-AMM and Metaplex bytecode.

mod common;

use anchor_lang::prelude::Pubkey;
use common::*;
use solana_account::Account;
use solana_signer::Signer;
use thesis::constants::*;
use thesis::instructions::UpdateConfigArgs;
use thesis::pm_amm;
use thesis::pricing::opening_price_bps;
use thesis::pyth::{encode_price_update, PriceUpdate};
use thesis::state::{Config, Direction, TouchMarket};

fn expect_err(res: Result<impl std::fmt::Debug, String>, want: &str) {
    match res {
        Ok(v) => panic!("expected {want}, got Ok({v:?})"),
        Err(e) => assert!(e.contains(want), "expected {want}, got:\n{e}"),
    }
}

// ---------------------------------------------------------------- lifecycle

#[test]
fn sponsored_market_create_trade_settle_no() {
    let mut env = setup();
    let strike = spot_plus_bps(-500);
    let c = create_market(&mut env, Create { strike, ..Default::default() }).expect("create");
    println!("[cu] create_touch_market (pricing + initialize_market + deposit_liquidity): {}", c.cu);

    // Opening price: computed onchain, identical to the host computation, and
    // the pm-AMM pool opens there.
    let tm: TouchMarket = env.read(c.touch_market);
    let host = opening_price_bps(SPOT, strike, VOL_BPS, 48 * 3600).unwrap();
    assert_eq!(tm.initial_price_bps, host, "onchain and host opening price must match");
    assert!((yes_price_bps(&env, c.pm_market) - host as f64).abs() < 5.0);
    println!("[price] 5% below spot, 48h, sigma 60%: opens at {:.2}%", host as f64 / 100.0);
    assert_eq!((tm.spot_at_open, tm.expo, tm.start_ts), (SPOT, EXPO, START_TS));
    assert_eq!(tm.seeded_by, env.authority);
    assert_eq!(tm.creator, env.admin.pubkey());

    let m: pm_amm::accounts::Market = env.read(c.pm_market);
    assert_eq!(m.authority, env.authority, "pm-AMM market authority must be the Thesis PDA");
    assert_eq!(env.token_amount(env.treasury), 975 * USDC, "sponsored seed left the treasury");
    let cfg: Config = env.read(env.config);
    assert_eq!(cfg.sponsor_budget, 275 * USDC, "sponsor budget decremented");

    // A direct pm-AMM swap pays 1% to the treasury (creator half of the 2% fee).
    let t = trader_for(&mut env, c.pm_market, 100 * USDC);
    buy(&mut env, &t, c.pm_market, true, 10 * USDC).expect("swap");
    assert_eq!(env.token_amount(env.treasury), 975 * USDC + 100_000);

    expect_err(settle(&mut env, &c), "TooEarly");
    env.set_clock(tm.end_ts + GRACE as i64 - 1);
    expect_err(settle(&mut env, &c), "TooEarly");
    env.set_clock(tm.end_ts + GRACE as i64);
    let cu = settle(&mut env, &c).expect("settle NO");
    println!("[cu] settle: {cu}");
    let m: pm_amm::accounts::Market = env.read(c.pm_market);
    assert!(m.resolved);
    assert_eq!(m.winning_side, 2, "NO wins without a proof");
    expect_err(settle(&mut env, &c), "AlreadyFinal");
}

#[test]
fn creator_seeded_market() {
    let mut env = setup();
    let creator = env.funded_keypair(1_000_000_000);
    let creator_usdc = Pubkey::new_unique();
    let mint = env.usdc_mint;
    env.put_token(creator_usdc, mint, creator.pubkey(), 50 * USDC);

    // Anyone may create, but only admin/keeper may sponsor.
    expect_err(create_market(&mut env, Create { creator: Some(&creator), ..Default::default() }), "SponsorNotAllowed");
    expect_err(
        create_market(&mut env, Create { creator: Some(&creator), sponsored: false, ..Default::default() }),
        "MissingCreatorUsdc",
    );
    // Someone else's USDC account is refused.
    let other = Pubkey::new_unique();
    env.put_token(other, mint, Pubkey::new_unique(), 50 * USDC);
    expect_err(
        create_market(&mut env, Create { creator: Some(&creator), sponsored: false, creator_usdc: Some(other), ..Default::default() }),
        "ConstraintTokenOwner",
    );

    let c = create_market(
        &mut env,
        Create { creator: Some(&creator), sponsored: false, creator_usdc: Some(creator_usdc), ..Default::default() },
    )
    .expect("creator-seeded create");
    let tm: TouchMarket = env.read(c.touch_market);
    assert_eq!(tm.creator, creator.pubkey());
    assert_eq!(tm.seeded_by, creator.pubkey());
    assert_eq!(env.token_amount(creator_usdc), 25 * USDC, "creator paid the seed");
    assert_eq!(env.token_amount(env.treasury), 1_000 * USDC, "treasury untouched");
    let cfg: Config = env.read(env.config);
    assert_eq!(cfg.sponsor_budget, 300 * USDC, "sponsor budget untouched");
    let lp = pda(&[PM_LP_SEED, c.pm_market.as_ref(), creator.pubkey().as_ref()], &pm_amm::ID);
    assert_eq!(env.svm.get_account(&lp).expect("creator LP position").owner, pm_amm::ID);
    // The market is still owned by the Thesis PDA, so only Thesis can resolve it.
    let m: pm_amm::accounts::Market = env.read(c.pm_market);
    assert_eq!(m.authority, env.authority);
}

// ---------------------------------------------------------------- create rules

#[test]
fn create_rejects_bad_seed_window_and_strike() {
    let mut env = setup();
    let d = Create::default;
    expect_err(create_market(&mut env, Create { seed: 101 * USDC, ..d() }), "InvalidSeed");
    expect_err(create_market(&mut env, Create { seed: USDC / 2, ..d() }), "InvalidSeed");
    expect_err(create_market(&mut env, Create { window: 200, ..d() }), "InvalidWindow");
    expect_err(create_market(&mut env, Create { strike: spot_plus_bps(100), ..d() }), "StrikeWrongSide");
    expect_err(
        create_market(&mut env, Create { direction: Direction::Above, strike: spot_plus_bps(-100), ..d() }),
        "StrikeWrongSide",
    );
    expect_err(create_market(&mut env, Create { strike: spot_plus_bps(-30), ..d() }), "StrikeTooClose");
    expect_err(create_market(&mut env, Create { strike: spot_plus_bps(-5_100), ..d() }), "StrikeTooFar");
    // 40% away in 10 minutes: P is ~0, under the 1% floor.
    expect_err(create_market(&mut env, Create { strike: spot_plus_bps(-4_000), window: 600, ..d() }), "OpeningPriceOutOfRange");
    // Cap at 90%: 0.5% away over 7 days opens ~95%.
    let admin = env.admin.insecure_clone();
    update_config(&mut env, &admin, UpdateConfigArgs { max_open_bps: Some(9_000), ..Default::default() }).unwrap();
    expect_err(create_market(&mut env, Create { strike: spot_plus_bps(-50), window: 7 * 86_400, ..d() }), "OpeningPriceOutOfRange");
    // A taken pm-AMM market id fails cleanly.
    let id = rand_id();
    create_market(&mut env, Create { market_id: id, ..d() }).unwrap();
    assert!(create_market(&mut env, Create { market_id: id, ..d() }).is_err());
}

#[test]
fn create_rejects_bad_spot() {
    let mut env = setup();
    let now = env.now();
    let with_spot = |env: &mut Env, u: PriceUpdate| {
        let key = env.put_price(u);
        create_market(env, Create { spot_account: Some(key), ..Default::default() })
    };
    expect_err(with_spot(&mut env, good_update(now - 61, SPOT)), "StaleSpot");
    expect_err(with_spot(&mut env, good_update(now + 5, SPOT)), "StaleSpot");
    expect_err(with_spot(&mut env, PriceUpdate { fully_verified: false, ..good_update(now, SPOT) }), "NotFullyVerified");
    expect_err(with_spot(&mut env, PriceUpdate { feed_id: [1u8; 32], ..good_update(now, SPOT) }), "WrongFeed");
    expect_err(with_spot(&mut env, PriceUpdate { conf: (SPOT / 100) as u64, ..good_update(now, SPOT) }), "ConfTooWide");
    let fake = Pubkey::new_unique();
    env.svm
        .set_account(fake, Account {
            lamports: 2_000_000,
            data: encode_price_update(&good_update(now, SPOT), [9u8; 32], 1),
            owner: Pubkey::new_unique(),
            executable: false,
            rent_epoch: 0,
        })
        .unwrap();
    expect_err(create_market(&mut env, Create { spot_account: Some(fake), ..Default::default() }), "WrongPriceOwner");
    // A spot exactly 60 s old is accepted.
    with_spot(&mut env, good_update(now - 60, SPOT)).expect("60 s old spot");
}

#[test]
fn create_respects_pause_budget_and_volatility_age() {
    let mut env = setup();
    let admin = env.admin.insecure_clone();
    update_config(&mut env, &admin, UpdateConfigArgs { paused: Some(true), ..Default::default() }).unwrap();
    expect_err(create_market(&mut env, Create::default()), "Paused");
    update_config(&mut env, &admin, UpdateConfigArgs { paused: Some(false), sponsor_budget: Some(10 * USDC), ..Default::default() }).unwrap();
    expect_err(create_market(&mut env, Create::default()), "SponsorBudgetExhausted");
    create_market(&mut env, Create { seed: 10 * USDC, ..Default::default() }).expect("budget exactly spent");
    expect_err(create_market(&mut env, Create { seed: USDC, ..Default::default() }), "SponsorBudgetExhausted");

    update_config(&mut env, &admin, UpdateConfigArgs { sponsor_budget: Some(100 * USDC), ..Default::default() }).unwrap();
    env.set_clock(START_TS + 3 * 86_400 + 1);
    expect_err(create_market(&mut env, Create::default()), "StaleVolatility");
    set_volatility(&mut env, &admin, 7_000).unwrap();
    create_market(&mut env, Create::default()).expect("fresh volatility");
}

// ---------------------------------------------------------------- config

#[test]
fn config_auth_bounds_and_volatility() {
    let mut env = setup();
    let admin = env.admin.insecure_clone();
    let stranger = env.funded_keypair(1_000_000_000);
    expect_err(update_config(&mut env, &stranger, UpdateConfigArgs { paused: Some(true), ..Default::default() }), "Unauthorized");
    expect_err(update_config(&mut env, &admin, UpdateConfigArgs { min_open_bps: Some(50), ..Default::default() }), "InvalidConfig");
    expect_err(update_config(&mut env, &admin, UpdateConfigArgs { min_seed_per_market: Some(0), ..Default::default() }), "InvalidConfig");
    expect_err(
        update_config(&mut env, &admin, UpdateConfigArgs { min_strike_distance_bps: Some(6_000), ..Default::default() }),
        "InvalidConfig",
    );
    expect_err(set_volatility(&mut env, &stranger, 7_000), "Unauthorized");
    expect_err(set_volatility(&mut env, &admin, 100), "InvalidVolatility");

    // Hand the keeper role to a separate key; the keeper may post volatility.
    let keeper = env.funded_keypair(1_000_000_000);
    update_config(&mut env, &admin, UpdateConfigArgs { keeper: Some(keeper.pubkey()), ..Default::default() }).unwrap();
    let low = create_market(&mut env, Create::default()).unwrap();
    set_volatility(&mut env, &keeper, 12_000).expect("keeper sets vol");
    let high = create_market(&mut env, Create::default()).unwrap();
    let (a, b): (TouchMarket, TouchMarket) = (env.read(low.touch_market), env.read(high.touch_market));
    assert!(b.initial_price_bps > a.initial_price_bps, "higher vol, higher touch probability");
    assert_eq!(b.initial_price_bps, opening_price_bps(SPOT, spot_plus_bps(-500), 12_000, 48 * 3600).unwrap());
    // The keeper may also sponsor.
    create_market(&mut env, Create { creator: Some(&keeper), ..Default::default() }).expect("keeper sponsors");
}

#[test]
fn opening_price_matches_host_across_terms() {
    let mut env = setup();
    for (dir, bps, window) in [
        (Direction::Below, -50, 600),
        (Direction::Below, -60, 600),
        (Direction::Below, -200, 86_400),
        (Direction::Below, -1_000, 7 * 86_400),
        (Direction::Above, 300, 86_400),
        (Direction::Above, 2_000, 7 * 86_400),
    ] {
        let strike = spot_plus_bps(bps);
        let c = create_market(&mut env, Create { direction: dir, strike, window, seed: 5 * USDC, ..Default::default() })
            .unwrap_or_else(|e| panic!("{dir:?} {bps} {window}: {e}"));
        let tm: TouchMarket = env.read(c.touch_market);
        let host = opening_price_bps(SPOT, strike, VOL_BPS, window).unwrap();
        println!("[price] {dir:?} {:+.1}% over {:>6}s -> {:>5.2}%", bps as f64 / 100.0, window, host as f64 / 100.0);
        assert_eq!(tm.initial_price_bps, host);
    }
}

#[test]
fn short_windows_need_near_strikes() {
    // At sigma 60%, a 10-minute market 1% from spot has ~0.01% touch odds and
    // is refused; 0.5% away opens at ~5.5%. Demo markets must sit near spot.
    let mut env = setup();
    expect_err(create_market(&mut env, Create { strike: spot_plus_bps(-100), window: 600, ..Default::default() }), "OpeningPriceOutOfRange");
    let c = create_market(&mut env, Create { strike: spot_plus_bps(-50), window: 600, ..Default::default() }).unwrap();
    let tm: TouchMarket = env.read(c.touch_market);
    assert_eq!(tm.initial_price_bps, 555);
}

// ---------------------------------------------------------------- resolver

#[test]
fn prove_touch_rules_then_settle_yes() {
    let mut env = setup();
    // 0.5% under spot over 10 minutes: the demo-market shape (opens ~5.5%).
    let strike = spot_plus_bps(-50);
    let c = create_market(&mut env, Create { strike, window: 600, ..Default::default() }).unwrap();
    let tm: TouchMarket = env.read(c.touch_market);
    let inside = START_TS + 60;

    let cases: Vec<(&str, PriceUpdate)> = vec![
        ("NotFullyVerified", PriceUpdate { fully_verified: false, ..good_update(inside, strike - 1) }),
        ("WrongFeed", PriceUpdate { feed_id: [1u8; 32], ..good_update(inside, strike - 1) }),
        ("OutsideWindow", good_update(START_TS - 1, strike - 1)), // before the market existed
        ("OutsideWindow", good_update(tm.end_ts + 1, strike - 1)),
        ("WrongExpo", PriceUpdate { exponent: -6, ..good_update(inside, strike - 1) }),
        ("ConfTooWide", PriceUpdate { conf: ((strike - 1) / 100) as u64, ..good_update(inside, strike - 1) }),
        ("NonPositivePrice", good_update(inside, 0)),
        ("NoTouch", good_update(inside, strike + 1)),
    ];
    for (want, u) in cases {
        let key = env.put_price(u);
        expect_err(prove(&mut env, c.touch_market, key), want);
    }
    let fake = Pubkey::new_unique();
    env.svm
        .set_account(fake, Account {
            lamports: 2_000_000,
            data: encode_price_update(&good_update(inside, strike), [9u8; 32], 1),
            owner: Pubkey::new_unique(),
            executable: false,
            rent_epoch: 0,
        })
        .unwrap();
    expect_err(prove(&mut env, c.touch_market, fake), "WrongPriceOwner");

    // Exactly at the strike counts as a touch.
    let key = env.put_price(good_update(inside, strike));
    let cu = prove(&mut env, c.touch_market, key).expect("valid proof");
    println!("[cu] prove_touch: {cu}");
    let tm: TouchMarket = env.read(c.touch_market);
    assert!(tm.touched);
    assert_eq!((tm.touch_price, tm.touch_publish_time), (strike, inside));
    let key = env.put_price(good_update(inside + 1, strike - 5));
    expect_err(prove(&mut env, c.touch_market, key), "AlreadyFinal");

    env.set_clock(tm.end_ts + GRACE as i64);
    settle(&mut env, &c).expect("settle YES");
    let m: pm_amm::accounts::Market = env.read(c.pm_market);
    assert_eq!(m.winning_side, 1, "YES wins after a proven touch");
    let key = env.put_price(good_update(inside + 2, strike - 5));
    expect_err(prove(&mut env, c.touch_market, key), "AlreadyFinal");
}

#[test]
fn touch_above_with_late_proof_in_grace() {
    let mut env = setup();
    let strike = spot_plus_bps(60);
    let c = create_market(&mut env, Create { direction: Direction::Above, strike, window: 600, ..Default::default() }).unwrap();
    let tm: TouchMarket = env.read(c.touch_market);
    // Published inside the window, submitted during the grace period.
    env.set_clock(tm.end_ts + 30);
    let key = env.put_price(good_update(tm.end_ts, strike + 1));
    prove(&mut env, c.touch_market, key).expect("late proof inside grace");
    env.set_clock(tm.end_ts + GRACE as i64);
    settle(&mut env, &c).unwrap();
    let m: pm_amm::accounts::Market = env.read(c.pm_market);
    assert_eq!(m.winning_side, 1);
}

// ---------------------------------------------------------------- numbers

#[test]
fn swap_compute_by_opening_price() {
    // pm-AMM's swap solver is cheap near 50% and expensive near the extremes;
    // Phase 2's `trade` CPI must budget for the worst case.
    println!("\n[cu] direct pm-AMM swap of 5 USDC, by market opening price");
    let mut worst = 0;
    for (bps, window) in [(-50i64, 600i64), (-200, 86_400), (-500, 48 * 3600), (-1_000, 7 * 86_400), (-1_500, 7 * 86_400)] {
        let mut env = setup();
        let c = create_market(&mut env, Create { strike: spot_plus_bps(bps), window, ..Default::default() }).unwrap();
        let tm: TouchMarket = env.read(c.touch_market);
        let t = trader_for(&mut env, c.pm_market, 100 * USDC);
        let fresh = buy_cu(&mut env, &t, c.pm_market, true, 5 * USDC).unwrap();
        // Same swap 10 s later: pm-AMM first accrues the time decay of L_eff.
        let now = env.now();
        env.set_clock(now + 10);
        let later = buy_cu(&mut env, &t, c.pm_market, true, 5 * USDC);
        let later = later.unwrap_or_else(|e| panic!("swap after 10 s: {}", e.lines().find(|l| l.contains("consumed") || l.contains("Error")).unwrap_or("")));
        worst = worst.max(fresh).max(later);
        println!("  opens {:>6.2}%: swap at t0 {:>7} CU, swap 10 s later {:>7} CU", tm.initial_price_bps as f64 / 100.0, fresh, later);
    }
    assert!(worst < 1_400_000, "a swap must fit in one transaction");
}

#[test]
fn price_impact_table() {
    println!("\n[impact] USDC->YES buys, 48h TouchBelow 5% under spot");
    println!("{:>8} {:>8} {:>10} {:>10} {:>10}", "seed", "buy", "YES before", "YES after", "impact");
    for seed in [25u64, 100] {
        for size in [10u64, 50, 250] {
            let mut env = setup();
            let c = create_market(&mut env, Create { seed: seed * USDC, ..Default::default() }).unwrap();
            let before = yes_price_bps(&env, c.pm_market);
            let t = trader_for(&mut env, c.pm_market, 1_000 * USDC);
            buy(&mut env, &t, c.pm_market, true, size * USDC).unwrap();
            let after = yes_price_bps(&env, c.pm_market);
            println!(
                "{:>7}$ {:>7}$ {:>9.1}% {:>9.1}% {:>+8.1}pt",
                seed, size, before / 100.0, after / 100.0, (after - before) / 100.0
            );
        }
    }
}
