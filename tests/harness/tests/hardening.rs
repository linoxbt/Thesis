//! Audit fixes: treasury redemption, creator-fee reserve, treasury-buy floor,
//! two-step admin, config migration and bounds, proof deadline, link window,
//! sponsored-for-a-beneficiary markets, and account pinning.

mod common;

use anchor_lang::prelude::Pubkey;
use common::*;
use solana_account::Account;
use solana_keypair::Keypair;
use solana_signer::Signer;
use thesis::instructions::UpdateConfigArgs;
use thesis::state::{Direction, Thesis, TouchMarket, TradeSide, CONFIG_V1_LEN};

fn expect_err(res: Result<impl std::fmt::Debug, String>, want: &str) {
    match res {
        Ok(v) => panic!("expected {want}, got Ok({v:?})"),
        Err(e) => assert!(e.contains(want), "expected {want}, got:\n{e}"),
    }
}

fn usdc_account(env: &mut Env, owner: Pubkey, amount: u64) -> Pubkey {
    let key = Pubkey::new_unique();
    let m = env.usdc_mint;
    env.put_token(key, m, owner, amount);
    key
}

/// A sponsored conviction market (Above +3%) linked into a thesis.
fn thesis_fixture(env: &mut Env) -> (Created, Pubkey) {
    let admin = env.admin.insecure_clone();
    let c = create_market(env, Create { direction: Direction::Above, strike: spot_plus_bps(300), ..Default::default() }).unwrap();
    let th = create_thesis(env, &admin, c.touch_market, None).unwrap();
    (c, th)
}

// ---------------------------------------------------------------- redemption

#[test]
fn treasury_redeem_brings_the_seed_home_after_no() {
    let mut env = setup();
    let c = create_market(&mut env, Create::default()).unwrap();
    let t = trader_for(&mut env, c.pm_market, 100 * USDC);
    buy(&mut env, &t, c.pm_market, true, 10 * USDC).unwrap();

    expect_err(treasury_redeem(&mut env, &c, true), "NotSettled");
    let tm: TouchMarket = env.read(c.touch_market);
    env.set_clock(tm.end_ts + GRACE as i64);
    settle(&mut env, &c).expect("settle NO");

    let before = env.token_amount(env.treasury);
    let cu = treasury_redeem(&mut env, &c, true).expect("redeem");
    let back = env.token_amount(env.treasury) - before;
    println!("[cu] treasury_redeem (claim residuals + winnings): {cu}; 25 USDC seed returned {} USDC", back as f64 / 1e6);
    // The LP took the other side of a losing 10 USDC YES buy.
    assert!(back > 25 * USDC, "seed plus the loser's stake comes home, got {back}");
    let (yes, no) = treasury_outcome_accounts(&mut env, c.pm_market);
    assert_eq!((env.token_amount(yes), env.token_amount(no)), (0, 0), "every outcome token is burned");
    let m: thesis::pm_amm::accounts::Market = env.read(c.pm_market);
    println!("[redeem] pool left after residuals: yes {} no {} (I80F48 bits)", m.reserve_yes, m.reserve_no);
    expect_err(treasury_redeem(&mut env, &c, true), "NoResidualsToClaim");
    expect_err(treasury_redeem(&mut env, &c, false), "NothingToClaim");
}

#[test]
fn treasury_redeem_collects_bought_yes_after_touch() {
    let mut env = setup();
    let keeper = env.admin.insecure_clone();
    let strike = spot_plus_bps(-50);
    let c = create_market(&mut env, Create { strike, window: 600, ..Default::default() }).unwrap();
    env.set_clock(START_TS + 30);
    let p = env.put_price(good_update(START_TS + 30, strike - 1));
    let paid_before = env.token_amount(env.treasury);
    let bundle = [compute_budget(1_400_000), prove_ix(&env, &keeper.pubkey(), c.touch_market, p), treasury_buy_yes_ix(&mut env, &keeper.pubkey(), &c, 5 * USDC)];
    env.send(&bundle, &keeper, &[]).expect("prove + buy");
    let (yes, _) = treasury_outcome_accounts(&mut env, c.pm_market);
    let bought = env.token_amount(yes);
    let paid = paid_before - env.token_amount(env.treasury);

    let tm: TouchMarket = env.read(c.touch_market);
    env.set_clock(tm.end_ts + GRACE as i64);
    settle(&mut env, &c).expect("settle YES");
    let before = env.token_amount(env.treasury);
    treasury_redeem(&mut env, &c, true).expect("redeem");
    let back = env.token_amount(env.treasury) - before;
    println!("[redeem] treasury paid {} for {} YES; redeemed {} USDC incl. the seed", paid as f64 / 1e6, bought as f64 / 1e6, back as f64 / 1e6);
    assert!(back >= bought, "each bought YES pays $1");
    assert!(back > paid + 20 * USDC, "the buy profits and most of the seed returns");
}

#[test]
fn treasury_redeem_on_creator_seeded_market_redeems_bought_yes_only() {
    // No Authority LP position: only treasury-bought tokens are redeemed.
    let mut env = setup();
    let kp = env.funded_keypair(2_000_000_000);
    let cu = usdc_account(&mut env, kp.pubkey(), 100 * USDC);
    let strike = spot_plus_bps(-50);
    let c = create_market(&mut env, Create { strike, window: 600, sponsored: false, creator: Some(&kp), creator_usdc: Some(cu), ..Default::default() }).unwrap();
    let tm: TouchMarket = env.read(c.touch_market);
    env.set_clock(tm.end_ts + GRACE as i64);
    settle(&mut env, &c).unwrap();
    expect_err(treasury_redeem(&mut env, &c, true), "NothingToClaim");
    expect_err(treasury_redeem(&mut env, &c, false), "NothingToClaim");
}

// ---------------------------------------------------------------- reserve and floor

#[test]
fn creator_fees_are_reserved_from_treasury_spends() {
    let mut env = setup();
    let admin = env.admin.insecure_clone();
    let (c, th) = thesis_fixture(&mut env);
    let t = trader_for(&mut env, c.pm_market, 200 * USDC);
    trade(&mut env, &t, th, &c, TradeSide::BuyYes, 100 * USDC).unwrap();
    let owed = config(&env).creator_fees_owed;
    let thesis: Thesis = env.read(th);
    assert!(owed > 0);
    assert_eq!(owed, thesis.creator_fees_earned(5_000), "owed tracks what creators earned");

    // Drain the treasury down to the reserve plus 1 USDC.
    let (tr, m, a) = (env.treasury, env.usdc_mint, env.authority);
    env.put_token(tr, m, a, owed + USDC);
    expect_err(create_market(&mut env, Create { seed: 5 * USDC, ..Default::default() }), "TreasuryReserved");
    let p = env.put_price(good_update(START_TS, spot_plus_bps(301)));
    prove(&mut env, c.touch_market, p).unwrap();
    let ix = treasury_buy_yes_ix(&mut env, &admin.pubkey(), &c, 5 * USDC);
    expect_err(env.send(&[compute_budget(1_400_000), ix], &admin, &[]), "TreasuryReserved");

    // The creator can still claim in full, and the reserve drops to zero.
    let to = usdc_account(&mut env, admin.pubkey(), 0);
    claim_creator_fees(&mut env, &admin, th, to).unwrap();
    assert_eq!(env.token_amount(to), owed);
    assert_eq!(config(&env).creator_fees_owed, 0);
}

#[test]
fn treasury_buy_needs_a_one_percent_edge() {
    let mut env = setup();
    let keeper = env.admin.insecure_clone();
    let strike = spot_plus_bps(-50);
    let c = create_market(&mut env, Create { strike, window: 600, ..Default::default() }).unwrap();
    // A whale pushes YES to ~$1 before the touch; buying at that price can't profit.
    let whale = trader_for(&mut env, c.pm_market, 5_000 * USDC);
    buy(&mut env, &whale, c.pm_market, true, 3_000 * USDC).unwrap();
    println!("[floor] YES after whale: {:.2}%", yes_price_bps(&env, c.pm_market) / 100.0);
    let p = env.put_price(good_update(START_TS, strike - 1));
    prove(&mut env, c.touch_market, p).unwrap();
    let ix = treasury_buy_yes_ix(&mut env, &keeper.pubkey(), &c, 5 * USDC);
    let res = env.send(&[compute_budget(1_400_000), ix], &keeper, &[]);
    assert!(res.is_err(), "a buy below the floor fails");
    println!("[floor] {}", res.unwrap_err().lines().find(|l| l.contains("Error")).unwrap_or(""));
}

// ---------------------------------------------------------------- config

#[test]
fn admin_handover_is_two_step() {
    let mut env = setup();
    let admin = env.admin.insecure_clone();
    let next = env.funded_keypair(1_000_000_000);
    let stranger = env.funded_keypair(1_000_000_000);
    expect_err(accept_admin(&mut env, &next), "NotPendingAdmin");
    update_config(&mut env, &admin, UpdateConfigArgs { admin: Some(next.pubkey()), ..Default::default() }).unwrap();
    let c = config(&env);
    assert_eq!((c.admin, c.pending_admin), (admin.pubkey(), next.pubkey()), "proposal only");
    expect_err(accept_admin(&mut env, &stranger), "NotPendingAdmin");
    accept_admin(&mut env, &next).expect("accept");
    let c = config(&env);
    assert_eq!((c.admin, c.pending_admin), (next.pubkey(), Pubkey::default()));
    expect_err(update_config(&mut env, &admin, UpdateConfigArgs { paused: Some(true), ..Default::default() }), "Unauthorized");
    update_config(&mut env, &next, UpdateConfigArgs { paused: Some(true), ..Default::default() }).expect("new admin rules");
}

#[test]
fn config_bounds_and_fixed_creator_share() {
    let mut env = setup();
    let admin = env.admin.insecure_clone();
    let up = |g: Option<u32>, c: Option<u16>| UpdateConfigArgs { grace_secs: g, max_conf_bps: c, ..Default::default() };
    for (args, want) in [
        (up(Some(10), None), "InvalidConfig"),
        (up(Some(7_200), None), "InvalidConfig"),
        (up(None, Some(5)), "InvalidConfig"),
        (up(None, Some(1_000)), "InvalidConfig"),
    ] {
        expect_err(update_config(&mut env, &admin, args), want);
    }
    update_config(&mut env, &admin, up(Some(300), Some(100))).expect("in bounds");
    expect_err(
        update_config(&mut env, &admin, UpdateConfigArgs { creator_share_bps: Some(1_000), ..Default::default() }),
        "CreatorShareFixed",
    );
}

#[test]
fn migrate_config_from_v1() {
    let mut env = setup();
    let admin = env.admin.insecure_clone();
    let v2 = config(&env);
    let acc = env.svm.get_account(&env.config).unwrap();
    let v1_data = acc.data[..CONFIG_V1_LEN].to_vec();
    let lamports = env.svm.minimum_balance_for_rent_exemption(CONFIG_V1_LEN);
    let key = env.config;
    env.svm.set_account(key, Account { lamports, data: v1_data, ..acc }).unwrap();

    let stranger = env.funded_keypair(1_000_000_000);
    expect_err(migrate_config(&mut env, &stranger, 1), "Unauthorized");
    migrate_config(&mut env, &admin, 123).expect("migrate");
    let acc = env.svm.get_account(&env.config).unwrap();
    assert!(acc.lamports >= env.svm.minimum_balance_for_rent_exemption(acc.data.len()), "rent topped up");
    let c = config(&env);
    assert_eq!((c.creator_fees_owed, c.pending_admin), (123, Pubkey::default()));
    assert_eq!((c.admin, c.keeper, c.sol_vol_bps, c.grace_secs), (v2.admin, v2.keeper, v2.sol_vol_bps, v2.grace_secs));
    expect_err(migrate_config(&mut env, &admin, 1), "AlreadyMigrated");
    create_market(&mut env, Create::default()).expect("program works after migration");
}

// ---------------------------------------------------------------- timing

#[test]
fn proof_after_grace_is_rejected() {
    let mut env = setup();
    let strike = spot_plus_bps(-50);
    let c = create_market(&mut env, Create { strike, window: 600, ..Default::default() }).unwrap();
    let tm: TouchMarket = env.read(c.touch_market);
    env.set_clock(tm.end_ts + GRACE as i64 + 1);
    let key = env.put_price(good_update(tm.end_ts - 10, strike - 1));
    expect_err(prove(&mut env, c.touch_market, key), "ProofTooLate");
}

#[test]
fn windows_and_thesis_links_are_bounded() {
    let mut env = setup();
    let admin = env.admin.insecure_clone();
    expect_err(create_market(&mut env, Create { window: 9 * 86_400, ..Default::default() }), "WindowTooLong");
    let a = create_market(&mut env, Create::default()).unwrap();
    let b = create_market(&mut env, Create::default()).unwrap();
    env.set_clock(START_TS + 15 * 60 + 1);
    expect_err(create_thesis(&mut env, &admin, a.touch_market, None), "LinkWindowPassed");
    env.set_clock(START_TS + 15 * 60);
    create_thesis(&mut env, &admin, b.touch_market, None).expect("inside the link window");
}

// ---------------------------------------------------------------- beneficiary

#[test]
fn sponsored_market_for_a_beneficiary() {
    let mut env = setup();
    let user = env.funded_keypair(1_000_000_000);
    let c = create_market(&mut env, Create { beneficiary: Some(user.pubkey()), ..Default::default() }).unwrap();
    let tm: TouchMarket = env.read(c.touch_market);
    assert_eq!(tm.creator, user.pubkey(), "credited to the beneficiary");
    create_thesis(&mut env, &user, c.touch_market, None).expect("the beneficiary links it");

    let kp = env.funded_keypair(2_000_000_000);
    let cu = usdc_account(&mut env, kp.pubkey(), 100 * USDC);
    expect_err(
        create_market(&mut env, Create { sponsored: false, creator: Some(&kp), creator_usdc: Some(cu), beneficiary: Some(user.pubkey()), ..Default::default() }),
        "BeneficiaryNeedsSponsor",
    );
    // A stranger can't sponsor for anyone.
    expect_err(create_market(&mut env, Create { creator: Some(&kp), beneficiary: Some(kp.pubkey()), ..Default::default() }), "SponsorNotAllowed");
}

// ---------------------------------------------------------------- account pinning

#[test]
fn trade_pins_dao_and_outcome_accounts() {
    let mut env = setup();
    let (c, th) = thesis_fixture(&mut env);
    let t = trader_for(&mut env, c.pm_market, 100 * USDC);
    let kp = t.kp.insecure_clone();

    let fake_dao = usdc_account(&mut env, kp.pubkey(), 0);
    let mut ix = trade_ix(&mut env, &t, th, &c, TradeSide::BuyYes, USDC);
    let dao = env.dao_usdc();
    swap_account(&mut ix, dao, fake_dao);
    expect_err(env.send(&[compute_budget(1_400_000), ix], &kp, &[]), "WrongDaoAccount");

    // A second YES account would split the cover across accounts.
    let yes_mint = pda(&[thesis::constants::PM_YES_MINT_SEED, c.pm_market.as_ref()], &thesis::pm_amm::ID);
    let side = Pubkey::new_unique();
    env.put_token(side, yes_mint, kp.pubkey(), 0);
    let mut ix = trade_ix(&mut env, &t, th, &c, TradeSide::BuyYes, USDC);
    swap_account(&mut ix, t.yes, side);
    let res = env.send(&[compute_budget(1_400_000), ix], &kp, &[]);
    assert!(res.is_err(), "non-ATA outcome account rejected");

    trade(&mut env, &t, th, &c, TradeSide::BuyYes, USDC).expect("the ATA path works");
}

#[test]
fn treasury_buy_pins_dao_account() {
    let mut env = setup();
    let keeper = env.admin.insecure_clone();
    let strike = spot_plus_bps(-50);
    let c = create_market(&mut env, Create { strike, window: 600, ..Default::default() }).unwrap();
    let p = env.put_price(good_update(START_TS, strike - 1));
    prove(&mut env, c.touch_market, p).unwrap();
    let fake = usdc_account(&mut env, keeper.pubkey(), 0);
    let mut ix = treasury_buy_yes_ix(&mut env, &keeper.pubkey(), &c, 5 * USDC);
    let dao = env.dao_usdc();
    swap_account(&mut ix, dao, fake);
    expect_err(env.send(&[compute_budget(1_400_000), ix], &keeper, &[]), "WrongDaoAccount");
}

#[test]
fn settle_rejects_someone_elses_stats() {
    let mut env = setup();
    let (c, th) = thesis_fixture(&mut env);
    // Another creator's real stats account.
    let other = env.funded_keypair(1_000_000_000);
    let m = create_market(&mut env, Create { beneficiary: Some(other.pubkey()), ..Default::default() }).unwrap();
    create_thesis(&mut env, &other, m.touch_market, None).unwrap();
    let tm: TouchMarket = env.read(c.touch_market);
    env.set_clock(tm.end_ts + GRACE as i64);
    expect_err(settle_with(&mut env, &c, Some((th, creator_stats_pda(&other.pubkey())))), "WrongCreatorStats");
    let admin: Keypair = env.admin.insecure_clone();
    settle_with(&mut env, &c, Some((th, creator_stats_pda(&admin.pubkey())))).expect("right stats");
}
