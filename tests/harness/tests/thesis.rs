//! Phase 2: the thesis layer (create_thesis, trade, claim_creator_fees,
//! treasury_buy_yes, settle outcomes), in LiteSVM against pm-AMM bytecode.

mod common;

use anchor_lang::prelude::Pubkey;
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;
use thesis::instructions::UpdateConfigArgs;
use thesis::state::{CreatorStats, Direction, Thesis, TouchMarket, TradeSide};

fn expect_err(res: Result<impl std::fmt::Debug, String>, want: &str) {
    match res {
        Ok(v) => panic!("expected {want}, got Ok({v:?})"),
        Err(e) => assert!(e.contains(want), "expected {want}, got:\n{e}"),
    }
}

/// A bullish thesis: conviction "SOL touches +3% in 48h", protection
/// "SOL touches -5% in 48h", both sponsored, created by the admin.
struct Fixture {
    env: Env,
    creator: Keypair,
    conviction: Created,
    protection: Created,
    thesis: Pubkey,
}

fn fixture() -> Fixture {
    let mut env = setup();
    let creator = env.admin.insecure_clone();
    let conviction = create_market(
        &mut env,
        Create { direction: Direction::Above, strike: spot_plus_bps(300), ..Default::default() },
    )
    .unwrap();
    let protection = create_market(&mut env, Create { strike: spot_plus_bps(-500), ..Default::default() }).unwrap();
    let thesis = create_thesis(&mut env, &creator, conviction.touch_market, Some(protection.touch_market)).unwrap();
    Fixture { env, creator, conviction, protection, thesis }
}

#[test]
fn create_thesis_links_markets_and_counts() {
    let Fixture { mut env, creator, conviction, protection, thesis } = fixture();
    let t: Thesis = env.read(thesis);
    assert_eq!((t.creator, t.id), (creator.pubkey(), 0));
    assert_eq!((t.conviction_market, t.protection_market), (conviction.touch_market, protection.touch_market));
    let cm: TouchMarket = env.read(conviction.touch_market);
    let pm: TouchMarket = env.read(protection.touch_market);
    assert_eq!((cm.origin_thesis, pm.origin_thesis), (thesis, thesis));
    assert_eq!(t.end_ts, cm.end_ts);
    let s: CreatorStats = env.read(creator_stats_pda(&creator.pubkey()));
    assert_eq!((s.posted, s.next_thesis_id), (1, 1));

    // A market can belong to one thesis only.
    expect_err(create_thesis(&mut env, &creator, conviction.touch_market, None), "MarketAlreadyLinked");

    // Conviction-only thesis gets the next id.
    let solo = create_market(&mut env, Create::default()).unwrap();
    let t2 = create_thesis(&mut env, &creator, solo.touch_market, None).unwrap();
    assert_eq!(env.read::<Thesis>(t2).id, 1);
    assert_eq!(env.read::<Thesis>(t2).protection_market, Pubkey::default());
}

#[test]
fn create_thesis_rules() {
    let mut env = setup();
    let admin = env.admin.insecure_clone();
    let a = create_market(&mut env, Create::default()).unwrap();
    let same_dir = create_market(&mut env, Create { strike: spot_plus_bps(-300), ..Default::default() }).unwrap();
    expect_err(create_thesis(&mut env, &admin, a.touch_market, Some(same_dir.touch_market)), "ProtectionSameDirection");

    // Different end time.
    let later = create_market(
        &mut env,
        Create { direction: Direction::Above, strike: spot_plus_bps(300), window: 48 * 3600 + 60, ..Default::default() },
    )
    .unwrap();
    expect_err(create_thesis(&mut env, &admin, a.touch_market, Some(later.touch_market)), "MarketsMismatch");

    // Someone else's market.
    let other = env.funded_keypair(1_000_000_000);
    expect_err(create_thesis(&mut env, &other, a.touch_market, None), "NotMarketCreator");

    // A touched market can't start a thesis.
    let near = create_market(&mut env, Create { strike: spot_plus_bps(-50), window: 600, ..Default::default() }).unwrap();
    let p = env.put_price(good_update(env.now(), spot_plus_bps(-60)));
    prove(&mut env, near.touch_market, p).unwrap();
    expect_err(create_thesis(&mut env, &admin, near.touch_market, None), "MarketClosed");
}

#[test]
fn trade_attributes_volume_fees_and_self_trades() {
    let Fixture { mut env, creator, conviction, protection, thesis } = fixture();
    let treasury_start = env.token_amount(env.treasury);

    // A follower backs the call with 10 USDC.
    let follower = trader_for(&mut env, conviction.pm_market, 100 * USDC);
    let cu = trade(&mut env, &follower, thesis, &conviction, TradeSide::BuyYes, 10 * USDC).expect("back");
    println!("[cu] trade (buy, fresh market): {cu}");
    assert!(env.token_amount(follower.yes) > 0);
    let t: Thesis = env.read(thesis);
    assert_eq!(t.volume_usdc, 10 * USDC);
    assert_eq!(t.fees_attributed, 100_000, "1% of 10 USDC reached the treasury");
    assert_eq!(t.self_volume_usdc, 0);

    // The creator challenges their own call: flagged as self-volume.
    let (yes_mint, no_mint) = (
        pda(&[thesis::constants::PM_YES_MINT_SEED, conviction.pm_market.as_ref()], &thesis::pm_amm::ID),
        pda(&[thesis::constants::PM_NO_MINT_SEED, conviction.pm_market.as_ref()], &thesis::pm_amm::ID),
    );
    let own = Trader {
        kp: creator.insecure_clone(),
        usdc: Pubkey::new_unique(),
        yes: anchor_spl::associated_token::get_associated_token_address(&creator.pubkey(), &yes_mint),
        no: anchor_spl::associated_token::get_associated_token_address(&creator.pubkey(), &no_mint),
    };
    let mint = env.usdc_mint;
    env.put_token(own.usdc, mint, creator.pubkey(), 50 * USDC);
    env.put_token(own.yes, yes_mint, creator.pubkey(), 0);
    env.put_token(own.no, no_mint, creator.pubkey(), 0);
    trade(&mut env, &own, thesis, &conviction, TradeSide::BuyNo, 5 * USDC).expect("self trade");
    let t: Thesis = env.read(thesis);
    assert_eq!(t.volume_usdc, 15 * USDC);
    assert_eq!(t.self_volume_usdc, 5 * USDC);

    // Some time passes; the follower sells half their YES back.
    let now = env.now();
    env.set_clock(now + 30);
    let half = env.token_amount(follower.yes) / 2;
    let usdc_before = env.token_amount(follower.usdc);
    let cu = trade(&mut env, &follower, thesis, &conviction, TradeSide::SellYes, half).expect("sell");
    println!("[cu] trade (sell, after 30 s): {cu}");
    let received = env.token_amount(follower.usdc) - usdc_before;
    let t: Thesis = env.read(thesis);
    assert_eq!(t.volume_usdc, 15 * USDC + received);
    let fees = env.token_amount(env.treasury) - treasury_start;
    assert_eq!(t.fees_attributed, fees, "every treasury fee came through `trade`");
    let s: CreatorStats = env.read(creator_stats_pda(&creator.pubkey()));
    assert_eq!(s.total_volume, t.volume_usdc);

    // Protection trades count toward the same thesis.
    let hedger = trader_for(&mut env, protection.pm_market, 100 * USDC);
    trade(&mut env, &hedger, thesis, &protection, TradeSide::BuyYes, 2 * USDC).expect("protect");
    assert_eq!(env.read::<Thesis>(thesis).volume_usdc, 17 * USDC + received);
}

#[test]
fn creator_claims_half_of_attributed_fees_once() {
    let Fixture { mut env, creator, conviction, thesis, .. } = fixture();
    let follower = trader_for(&mut env, conviction.pm_market, 100 * USDC);
    trade(&mut env, &follower, thesis, &conviction, TradeSide::BuyYes, 40 * USDC).unwrap();
    let fees = env.read::<Thesis>(thesis).fees_attributed;
    assert_eq!(fees, 400_000);

    let payout = Pubkey::new_unique();
    let mint = env.usdc_mint;
    env.put_token(payout, mint, creator.pubkey(), 0);
    let stranger = env.funded_keypair(1_000_000_000);
    expect_err(claim_creator_fees(&mut env, &stranger, thesis, payout), "Error");

    let treasury_before = env.token_amount(env.treasury);
    claim_creator_fees(&mut env, &creator, thesis, payout).expect("claim");
    assert_eq!(env.token_amount(payout), 200_000, "50% creator share");
    assert_eq!(env.token_amount(env.treasury), treasury_before - 200_000);
    expect_err(claim_creator_fees(&mut env, &creator, thesis, payout), "NothingToClaim");
    let s: CreatorStats = env.read(creator_stats_pda(&creator.pubkey()));
    assert_eq!(s.total_fees_earned, 200_000);

    // New trading makes more claimable.
    trade(&mut env, &follower, thesis, &conviction, TradeSide::BuyNo, 10 * USDC).unwrap();
    claim_creator_fees(&mut env, &creator, thesis, payout).expect("second claim");
    assert_eq!(env.token_amount(payout), 250_000);
}

#[test]
fn trade_guards() {
    let Fixture { mut env, conviction, protection, thesis, .. } = fixture();
    let admin = env.admin.insecure_clone();

    // A market outside the thesis.
    let stray = create_market(&mut env, Create::default()).unwrap();
    let t = trader_for(&mut env, stray.pm_market, 100 * USDC);
    expect_err(trade(&mut env, &t, thesis, &stray, TradeSide::BuyYes, USDC), "MarketNotInThesis");

    // Cover cap on the protection market: YES balance is the cover.
    update_config(&mut env, &admin, UpdateConfigArgs { max_cover_per_wallet: Some(20 * USDC), ..Default::default() }).unwrap();
    let hedger = trader_for(&mut env, protection.pm_market, 100 * USDC);
    expect_err(trade(&mut env, &hedger, thesis, &protection, TradeSide::BuyYes, 15 * USDC), "CoverCapExceeded");
    trade(&mut env, &hedger, thesis, &protection, TradeSide::BuyYes, 2 * USDC).expect("small cover");
    // The cap doesn't apply to the conviction market.
    let backer = trader_for(&mut env, conviction.pm_market, 100 * USDC);
    trade(&mut env, &backer, thesis, &conviction, TradeSide::BuyYes, 15 * USDC).expect("conviction uncapped");

    // Paused.
    update_config(&mut env, &admin, UpdateConfigArgs { paused: Some(true), ..Default::default() }).unwrap();
    expect_err(trade(&mut env, &backer, thesis, &conviction, TradeSide::BuyYes, USDC), "Paused");
    update_config(&mut env, &admin, UpdateConfigArgs { paused: Some(false), ..Default::default() }).unwrap();

    // Touched: trading through Thesis closes.
    let tm: TouchMarket = env.read(conviction.touch_market);
    let p = env.put_price(good_update(env.now(), tm.strike + 1));
    prove(&mut env, conviction.touch_market, p).unwrap();
    expect_err(trade(&mut env, &backer, thesis, &conviction, TradeSide::BuyYes, USDC), "MarketClosed");
}

#[test]
fn settle_records_hit_and_miss() {
    let Fixture { mut env, creator, conviction, protection, thesis } = fixture();
    let stats = creator_stats_pda(&creator.pubkey());
    let tm: TouchMarket = env.read(conviction.touch_market);
    let p = env.put_price(good_update(env.now() + 60, tm.strike));
    env.set_clock(START_TS + 60);
    prove(&mut env, conviction.touch_market, p).unwrap();
    env.set_clock(tm.end_ts + GRACE as i64);

    expect_err(settle(&mut env, &conviction), "MissingThesisAccounts");
    let wrong_stats = Some((thesis, creator_stats_pda(&Pubkey::new_unique())));
    assert!(settle_with(&mut env, &conviction, wrong_stats).is_err());
    settle_with(&mut env, &conviction, Some((thesis, stats))).expect("settle conviction");
    assert_eq!(env.read::<Thesis>(thesis).outcome, 1, "hit");
    // Protection settles NO without changing the thesis outcome.
    settle_with(&mut env, &protection, Some((thesis, stats))).expect("settle protection");
    assert_eq!(env.read::<Thesis>(thesis).outcome, 1);
    let s: CreatorStats = env.read(stats);
    assert_eq!((s.hit, s.missed), (1, 0));

    // A second thesis that misses.
    let c2 = create_market(&mut env, Create::default()).unwrap();
    let t2 = create_thesis(&mut env, &creator, c2.touch_market, None).unwrap();
    let end = env.read::<TouchMarket>(c2.touch_market).end_ts;
    env.set_clock(end + GRACE as i64);
    settle_with(&mut env, &c2, Some((t2, stats))).unwrap();
    assert_eq!(env.read::<Thesis>(t2).outcome, 2);
    let s: CreatorStats = env.read(stats);
    assert_eq!((s.posted, s.hit, s.missed), (2, 1, 1));
}

#[test]
fn watcher_bundle_prove_and_treasury_buy() {
    let mut env = setup();
    let keeper = env.admin.insecure_clone();
    let c = create_market(&mut env, Create { strike: spot_plus_bps(-50), window: 600, ..Default::default() }).unwrap();

    let ix = treasury_buy_yes_ix(&mut env, &keeper.pubkey(), &c, 5 * USDC);
    expect_err(env.send(&[compute_budget(1_400_000), ix], &keeper, &[]), "NotTouched");
    let stranger = env.funded_keypair(1_000_000_000);

    // 30 s later price crosses; one transaction proves and buys.
    env.set_clock(START_TS + 30);
    let p = env.put_price(good_update(START_TS + 30, spot_plus_bps(-55)));
    let treasury_before = env.token_amount(env.treasury);
    let bundle = [
        compute_budget(1_400_000),
        prove_ix(&env, &keeper.pubkey(), c.touch_market, p),
        treasury_buy_yes_ix(&mut env, &keeper.pubkey(), &c, 5 * USDC),
    ];
    let cu = env.send(&bundle, &keeper, &[]).expect("prove + treasury buy in one tx");
    println!("[cu] watcher bundle (prove_touch + treasury_buy_yes): {cu}");
    let (yes, _) = treasury_outcome_accounts(&mut env, c.pm_market);
    let bought = env.token_amount(yes);
    let paid = treasury_before - env.token_amount(env.treasury);
    println!("[watcher] treasury paid {} USDC for {} YES (worth $1 each at settle)", paid as f64 / 1e6, bought as f64 / 1e6);
    assert!(bought > paid, "post-touch YES is cheaper than its $1 payout");

    let ix = treasury_buy_yes_ix(&mut env, &stranger.pubkey(), &c, USDC);
    expect_err(env.send(&[compute_budget(1_400_000), ix], &stranger, &[]), "Unauthorized");
}
