//! Shared LiteSVM harness: the Thesis program plus pm-AMM and Metaplex
//! bytecode dumped from devnet (scripts/fetch-fixtures.sh).
#![allow(dead_code)]

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
use thesis::instructions::{CreateTouchMarketArgs, InitializeConfigArgs, UpdateConfigArgs};
use thesis::pm_amm;
use thesis::pyth::{encode_price_update, PriceUpdate};
use thesis::state::Direction;

pub const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures");
pub const THESIS_SO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/thesis.so");
pub const MPL_ID: Pubkey = anchor_lang::pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
pub const PROTOCOL_DAO: Pubkey = anchor_lang::pubkey!("4qXyczAr5DuBVaHUwmZT5Xt6hgQ6RwqBYcFGtrv8QEph");
pub const RENT_SYSVAR: Pubkey = anchor_lang::pubkey!("SysvarRent111111111111111111111111111111111");
pub const COMPUTE_BUDGET: Pubkey = anchor_lang::pubkey!("ComputeBudget111111111111111111111111111111");
pub const TOKEN_ID: Pubkey = anchor_spl::token::ID;
pub const SOL_USD_FEED: [u8; 32] = [
    0xef, 0x0d, 0x8b, 0x6f, 0xda, 0x2c, 0xeb, 0xa4, 0x1d, 0xa1, 0x5d, 0x40, 0x95, 0xd1, 0xda, 0x39,
    0x2a, 0x0d, 0x2f, 0x8e, 0xd0, 0xc6, 0xc7, 0xbc, 0x0f, 0x4c, 0xfa, 0xc8, 0xc2, 0x80, 0xb5, 0x6d,
];
pub const USDC: u64 = 1_000_000; // 6 decimals
pub const EXPO: i32 = -8;
pub const START_TS: i64 = 1_764_000_000;
pub const GRACE: u32 = 120;
pub const VOL_BPS: u32 = 6_000;
/// SOL spot used throughout: $74.7778 (a real devnet print on 2026-11-18).
pub const SPOT: i64 = 7_477_780_000;

pub fn px(dollars: f64) -> i64 {
    (dollars * 1e8).round() as i64
}

/// `SPOT` moved by `bps` (negative = below).
pub fn spot_plus_bps(bps: i64) -> i64 {
    SPOT + SPOT * bps / 10_000
}

pub fn pda(seeds: &[&[u8]], program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(seeds, program).0
}

pub struct Env {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub usdc_mint: Pubkey,
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub config: Pubkey,
}

impl Env {
    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    pub fn set_clock(&mut self, ts: i64) {
        let mut c: Clock = self.svm.get_sysvar();
        c.unix_timestamp = ts;
        self.svm.set_sysvar(&c);
    }

    pub fn send(&mut self, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair]) -> Result<u64, String> {
        let msg = Message::new(ixs, Some(&payer.pubkey()));
        let mut all: Vec<&Keypair> = vec![payer];
        all.extend_from_slice(signers);
        let tx = Transaction::new(&all, msg, self.svm.latest_blockhash());
        let res = self
            .svm
            .send_transaction(tx)
            .map(|m| m.compute_units_consumed)
            .map_err(|e| format!("{:?}\n{}", e.err, e.meta.logs.join("\n")));
        self.svm.expire_blockhash();
        res
    }

    pub fn funded_keypair(&mut self, lamports: u64) -> Keypair {
        let kp = Keypair::new();
        self.svm.airdrop(&kp.pubkey(), lamports).unwrap();
        kp
    }

    pub fn put_token(&mut self, key: Pubkey, mint: Pubkey, owner: Pubkey, amount: u64) {
        put_token(&mut self.svm, key, mint, owner, amount)
    }

    pub fn token_amount(&self, key: Pubkey) -> u64 {
        TokenAccountState::unpack(&self.svm.get_account(&key).unwrap().data).unwrap().amount
    }

    pub fn read<T: AccountDeserialize>(&self, key: Pubkey) -> T {
        let acc = self.svm.get_account(&key).unwrap();
        T::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    /// A Pyth `PriceUpdateV2` account owned by the receiver.
    pub fn put_price(&mut self, u: PriceUpdate) -> Pubkey {
        let key = Pubkey::new_unique();
        let data = encode_price_update(&u, [9u8; 32], 1);
        self.svm
            .set_account(key, Account { lamports: 2_000_000, data, owner: PYTH_RECEIVER_ID, executable: false, rent_epoch: 0 })
            .unwrap();
        key
    }

    /// A fresh, valid spot price published now.
    pub fn put_spot(&mut self, price: i64) -> Pubkey {
        let now = self.now();
        self.put_price(good_update(now, price))
    }

    pub fn dao_usdc(&mut self) -> Pubkey {
        let key = get_associated_token_address(&PROTOCOL_DAO, &self.usdc_mint);
        if self.svm.get_account(&key).is_none() {
            let mint = self.usdc_mint;
            self.put_token(key, mint, PROTOCOL_DAO, 0);
        }
        key
    }
}

pub fn good_update(publish_time: i64, price: i64) -> PriceUpdate {
    PriceUpdate { fully_verified: true, feed_id: SOL_USD_FEED, price, conf: (price / 10_000) as u64, exponent: EXPO, publish_time }
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

pub fn default_config_args(keeper: Pubkey) -> InitializeConfigArgs {
    InitializeConfigArgs {
        keeper,
        sol_usd_feed_id: SOL_USD_FEED,
        creator_share_bps: 5000,
        grace_secs: GRACE,
        max_conf_bps: 50,
        min_seed_per_market: USDC,
        max_seed_per_market: 100 * USDC,
        max_cover_per_wallet: 250 * USDC,
        sponsor_budget: 300 * USDC,
        sol_vol_bps: VOL_BPS,
        max_vol_age_secs: 3 * 86_400,
        max_spot_age_secs: 60,
        min_strike_distance_bps: 50,
        max_strike_distance_bps: 5_000,
        min_open_bps: 100,
        max_open_bps: 9_900,
        authority_funding: 2_000_000_000,
    }
}

pub fn setup() -> Env {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(thesis::ID, THESIS_SO).unwrap();
    svm.add_program_from_file(pm_amm::ID, format!("{FIXTURES}/pm_amm.so")).unwrap();
    svm.add_program_from_file(MPL_ID, format!("{FIXTURES}/mpl_token_metadata.so")).unwrap();
    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 100_000_000_000).unwrap();
    let usdc_mint = Pubkey::new_unique();
    put_mint(&mut svm, usdc_mint);
    let config = pda(&[CONFIG_SEED], &thesis::ID);
    let authority = pda(&[AUTHORITY_SEED], &thesis::ID);
    let treasury = get_associated_token_address(&authority, &usdc_mint);
    let mut env = Env { svm, admin, usdc_mint, authority, treasury, config };
    env.set_clock(START_TS);

    let keeper = env.admin.pubkey();
    let admin = env.admin.insecure_clone();
    env.send(&[initialize_config_ix(&env, default_config_args(keeper))], &admin, &[])
        .expect("initialize_config");
    // Fund the treasury with 1,000 mock USDC (stands in for the faucet).
    let (t, m, a) = (env.treasury, env.usdc_mint, env.authority);
    env.put_token(t, m, a, 1_000 * USDC);
    env
}

pub fn initialize_config_ix(env: &Env, args: InitializeConfigArgs) -> Instruction {
    Instruction {
        program_id: thesis::ID,
        accounts: thesis::accounts::InitializeConfig {
            admin: env.admin.pubkey(),
            config: env.config,
            authority: env.authority,
            usdc_mint: env.usdc_mint,
            treasury: env.treasury,
            system_program: anchor_lang::system_program::ID,
            token_program: TOKEN_ID,
            associated_token_program: anchor_spl::associated_token::ID,
        }
        .to_account_metas(None),
        data: thesis::instruction::InitializeConfig { args }.data(),
    }
}

pub fn update_config(env: &mut Env, signer: &Keypair, args: UpdateConfigArgs) -> Result<u64, String> {
    let ix = Instruction {
        program_id: thesis::ID,
        accounts: thesis::accounts::UpdateConfig { admin: signer.pubkey(), config: env.config }.to_account_metas(None),
        data: thesis::instruction::UpdateConfig { args }.data(),
    };
    env.send(&[ix], signer, &[])
}

pub fn set_volatility(env: &mut Env, signer: &Keypair, sol_vol_bps: u32) -> Result<u64, String> {
    let ix = Instruction {
        program_id: thesis::ID,
        accounts: thesis::accounts::SetVolatility { signer: signer.pubkey(), config: env.config }.to_account_metas(None),
        data: thesis::instruction::SetVolatility { sol_vol_bps }.data(),
    };
    env.send(&[ix], signer, &[])
}

pub fn compute_budget(units: u32) -> Instruction {
    // ComputeBudgetInstruction::SetComputeUnitLimit = tag 2 + u32 LE.
    let mut data = vec![2u8];
    data.extend_from_slice(&units.to_le_bytes());
    Instruction { program_id: COMPUTE_BUDGET, accounts: vec![], data }
}

#[derive(Debug)]
pub struct Created {
    pub pm_market: Pubkey,
    pub touch_market: Pubkey,
    pub cu: u64,
}

/// Options for `create_market`; `Default` = a sponsored TouchBelow market
/// 5% under spot, 48 h window, 25 USDC seed, created by the admin.
pub struct Create<'a> {
    pub market_id: u64,
    pub direction: Direction,
    pub strike: i64,
    pub window: i64,
    pub seed: u64,
    pub sponsored: bool,
    /// None = the admin.
    pub creator: Option<&'a Keypair>,
    /// None = a fresh valid spot at `SPOT`.
    pub spot_account: Option<Pubkey>,
    /// Creator USDC account (creator-seeded markets).
    pub creator_usdc: Option<Pubkey>,
}

impl Default for Create<'_> {
    fn default() -> Self {
        Create {
            market_id: 0,
            direction: Direction::Below,
            strike: spot_plus_bps(-500),
            window: 48 * 3600,
            seed: 25 * USDC,
            sponsored: true,
            creator: None,
            spot_account: None,
            creator_usdc: None,
        }
    }
}

pub fn create_market(env: &mut Env, o: Create) -> Result<Created, String> {
    let now = env.now();
    let creator = o.creator.map(|k| k.insecure_clone()).unwrap_or_else(|| env.admin.insecure_clone());
    let spot = o.spot_account.unwrap_or_else(|| env.put_spot(SPOT));
    let market_id = if o.market_id == 0 { rand_id() } else { o.market_id };
    let pm_market = pda(&[PM_MARKET_SEED, &market_id.to_le_bytes()], &pm_amm::ID);
    let yes_mint = pda(&[PM_YES_MINT_SEED, pm_market.as_ref()], &pm_amm::ID);
    let no_mint = pda(&[PM_NO_MINT_SEED, pm_market.as_ref()], &pm_amm::ID);
    let vault = pda(&[PM_VAULT_SEED, pm_market.as_ref()], &pm_amm::ID);
    let yes_metadata = pda(&[b"metadata", MPL_ID.as_ref(), yes_mint.as_ref()], &MPL_ID);
    let no_metadata = pda(&[b"metadata", MPL_ID.as_ref(), no_mint.as_ref()], &MPL_ID);
    let seeder = if o.sponsored { env.authority } else { creator.pubkey() };
    let lp_position = pda(&[PM_LP_SEED, pm_market.as_ref(), seeder.as_ref()], &pm_amm::ID);
    let touch_market = pda(&[TOUCH_SEED, pm_market.as_ref()], &thesis::ID);

    let ix = Instruction {
        program_id: thesis::ID,
        accounts: thesis::accounts::CreateTouchMarket {
            creator: creator.pubkey(),
            config: env.config,
            authority: env.authority,
            treasury: env.treasury,
            creator_usdc: o.creator_usdc,
            usdc_mint: env.usdc_mint,
            price_update: spot,
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
            rent: RENT_SYSVAR,
        }
        .to_account_metas(None),
        data: thesis::instruction::CreateTouchMarket {
            args: CreateTouchMarketArgs {
                market_id,
                direction: o.direction,
                strike: o.strike,
                end_ts: now + o.window,
                seed_amount: o.seed,
                sponsored: o.sponsored,
                name: format!("SOL touch {market_id}"),
            },
        }
        .data(),
    };
    let cu = env.send(&[compute_budget(1_400_000), ix], &creator, &[])?;
    Ok(Created { pm_market, touch_market, cu })
}

pub fn rand_id() -> u64 {
    u64::from_le_bytes(Pubkey::new_unique().to_bytes()[..8].try_into().unwrap())
}

pub struct Trader {
    pub kp: Keypair,
    pub usdc: Pubkey,
    pub yes: Pubkey,
    pub no: Pubkey,
}

pub fn trader_for(env: &mut Env, pm_market: Pubkey, usdc: u64) -> Trader {
    let kp = env.funded_keypair(1_000_000_000);
    let yes_mint = pda(&[PM_YES_MINT_SEED, pm_market.as_ref()], &pm_amm::ID);
    let no_mint = pda(&[PM_NO_MINT_SEED, pm_market.as_ref()], &pm_amm::ID);
    let t = Trader { kp, usdc: Pubkey::new_unique(), yes: Pubkey::new_unique(), no: Pubkey::new_unique() };
    let (owner, m) = (t.kp.pubkey(), env.usdc_mint);
    env.put_token(t.usdc, m, owner, usdc);
    env.put_token(t.yes, yes_mint, owner, 0);
    env.put_token(t.no, no_mint, owner, 0);
    t
}

/// A direct pm-AMM swap (not through Thesis), creator fee to the treasury.
pub fn buy(env: &mut Env, t: &Trader, pm_market: Pubkey, yes: bool, amount_in: u64) -> Result<u64, String> {
    let dao = env.dao_usdc();
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
    env.send(&[compute_budget(1_400_000), ix], &kp, &[])?;
    Ok(env.token_amount(if yes { t.yes } else { t.no }))
}

/// Like `buy`, but returns the compute units the swap used.
pub fn buy_cu(env: &mut Env, t: &Trader, pm_market: Pubkey, yes: bool, amount_in: u64) -> Result<u64, String> {
    let dao = env.dao_usdc();
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
    env.send(&[compute_budget(1_400_000), ix], &kp, &[])
}

/// pm-AMM spot price, paper section 7: P = Phi((y - x) / L_eff),
/// x = YES reserve, y = NO reserve, L_eff = L_0 * sqrt(T - t). All I80F48.
pub fn yes_price_bps(env: &Env, pm_market: Pubkey) -> f64 {
    let m: pm_amm::accounts::Market = env.read(pm_market);
    let fx = |bits: u128| (bits as i128) as f64 / (1u64 << 48) as f64;
    let l_eff = fx(m.l_zero) * ((m.end_ts - env.now()) as f64).sqrt();
    let z = (fx(m.reserve_no) - fx(m.reserve_yes)) / l_eff;
    10_000.0 * thesis::pricing::normal_cdf(z)
}

pub fn prove(env: &mut Env, touch_market: Pubkey, price_update: Pubkey) -> Result<u64, String> {
    let prover = env.funded_keypair(100_000_000);
    let ix = Instruction {
        program_id: thesis::ID,
        accounts: thesis::accounts::ProveTouch { prover: prover.pubkey(), config: env.config, touch_market, price_update }
            .to_account_metas(None),
        data: thesis::instruction::ProveTouch {}.data(),
    };
    env.send(&[ix], &prover, &[])
}

pub fn settle(env: &mut Env, c: &Created) -> Result<u64, String> {
    let cranker = env.funded_keypair(100_000_000);
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
    env.send(&[ix], &cranker, &[])
}
