//! Minimal reader for the Pyth receiver's `PriceUpdateV2` account.
//!
//! Decoded by its published Borsh layout instead of depending on
//! `pyth-solana-receiver-sdk`, which pins an older Anchor than this program.
//!
//! ```text
//! [0..8)   discriminator = sha256("account:PriceUpdateV2")[..8]
//! [8..40)  write_authority: Pubkey
//!          verification_level: enum { Partial { num_signatures: u8 } = 0, Full = 1 }
//!          price_message: { feed_id [u8;32], price i64, conf u64, exponent i32,
//!                           publish_time i64, prev_publish_time i64,
//!                           ema_price i64, ema_conf u64 }
//!          posted_slot: u64
//! ```

use crate::errors::ThesisError;
use anchor_lang::prelude::*;

pub const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PriceUpdate {
    pub fully_verified: bool,
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
}

fn take<const N: usize>(data: &[u8], at: &mut usize) -> Result<[u8; N]> {
    let end = at.checked_add(N).ok_or(ThesisError::BadPriceAccount)?;
    let bytes: [u8; N] = data
        .get(*at..end)
        .ok_or(ThesisError::BadPriceAccount)?
        .try_into()
        .map_err(|_| ThesisError::BadPriceAccount)?;
    *at = end;
    Ok(bytes)
}

/// Reads a `PriceUpdateV2` and applies the checks every caller needs: owned by
/// the Pyth receiver, fully verified, the configured feed, positive price,
/// confidence within `max_conf_bps` of price.
pub fn verified_price(
    info: &AccountInfo,
    receiver: &Pubkey,
    feed_id: &[u8; 32],
    max_conf_bps: u16,
) -> Result<PriceUpdate> {
    require_keys_eq!(*info.owner, *receiver, ThesisError::WrongPriceOwner);
    let p = {
        let data = info.try_borrow_data()?;
        parse_price_update(&data)?
    };
    require!(p.fully_verified, ThesisError::NotFullyVerified);
    require!(&p.feed_id == feed_id, ThesisError::WrongFeed);
    require!(p.price > 0, ThesisError::NonPositivePrice);
    require!(
        (p.conf as i128) * 10_000 <= (p.price as i128) * (max_conf_bps as i128),
        ThesisError::ConfTooWide
    );
    Ok(p)
}

pub fn parse_price_update(data: &[u8]) -> Result<PriceUpdate> {
    let mut at = 0usize;
    let disc: [u8; 8] = take(data, &mut at)?;
    require!(disc == PRICE_UPDATE_V2_DISCRIMINATOR, ThesisError::BadPriceAccount);
    let _write_authority: [u8; 32] = take(data, &mut at)?;
    let [level] = take::<1>(data, &mut at)?;
    let fully_verified = match level {
        0 => {
            let _num_signatures = take::<1>(data, &mut at)?;
            false
        }
        1 => true,
        _ => return err!(ThesisError::BadPriceAccount),
    };
    let feed_id: [u8; 32] = take(data, &mut at)?;
    let price = i64::from_le_bytes(take(data, &mut at)?);
    let conf = u64::from_le_bytes(take(data, &mut at)?);
    let exponent = i32::from_le_bytes(take(data, &mut at)?);
    let publish_time = i64::from_le_bytes(take(data, &mut at)?);
    Ok(PriceUpdate { fully_verified, feed_id, price, conf, exponent, publish_time })
}

/// Serialises a `PriceUpdateV2` the way the receiver stores it. Used by tests
/// and by tooling that builds fixtures; never called onchain.
#[cfg(any(test, feature = "test-utils"))]
pub fn encode_price_update(u: &PriceUpdate, write_authority: [u8; 32], posted_slot: u64) -> Vec<u8> {
    let mut v = Vec::with_capacity(134);
    v.extend_from_slice(&PRICE_UPDATE_V2_DISCRIMINATOR);
    v.extend_from_slice(&write_authority);
    if u.fully_verified {
        v.push(1);
    } else {
        v.push(0);
        v.push(3);
    }
    v.extend_from_slice(&u.feed_id);
    v.extend_from_slice(&u.price.to_le_bytes());
    v.extend_from_slice(&u.conf.to_le_bytes());
    v.extend_from_slice(&u.exponent.to_le_bytes());
    v.extend_from_slice(&u.publish_time.to_le_bytes());
    v.extend_from_slice(&u.publish_time.saturating_sub(1).to_le_bytes()); // prev_publish_time
    v.extend_from_slice(&u.price.to_le_bytes()); // ema_price
    v.extend_from_slice(&u.conf.to_le_bytes()); // ema_conf
    v.extend_from_slice(&posted_slot.to_le_bytes());
    v.resize(134, 0); // receiver allocates the Partial-sized maximum
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(full: bool) -> PriceUpdate {
        PriceUpdate {
            fully_verified: full,
            feed_id: [7u8; 32],
            price: 18_512_345_678,
            conf: 9_876_543,
            exponent: -8,
            publish_time: 1_763_000_000,
        }
    }

    #[test]
    fn round_trips_full_and_partial() {
        for full in [true, false] {
            let u = sample(full);
            let data = encode_price_update(&u, [1u8; 32], 42);
            assert_eq!(parse_price_update(&data).unwrap(), u);
        }
    }

    /// A real `PriceUpdateV2` account (Pyth's sponsored SOL/USD feed on devnet,
    /// 7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE), fetched on 2026-11-18.
    #[test]
    fn decodes_real_devnet_account() {
        let data = include_bytes!("../../../tests/fixtures/sol_usd_price_update_devnet.bin");
        let u = parse_price_update(data).unwrap();
        assert!(u.fully_verified);
        assert_eq!(
            u.feed_id,
            [
                0xef, 0x0d, 0x8b, 0x6f, 0xda, 0x2c, 0xeb, 0xa4, 0x1d, 0xa1, 0x5d, 0x40, 0x95, 0xd1,
                0xda, 0x39, 0x2a, 0x0d, 0x2f, 0x8e, 0xd0, 0xc6, 0xc7, 0xbc, 0x0f, 0x4c, 0xfa, 0xc8,
                0xc2, 0x80, 0xb5, 0x6d,
            ]
        );
        assert_eq!(u.exponent, -8);
        assert_eq!(u.price, 7_477_778_734);
        assert_eq!(u.publish_time, 1_794_993_029);
    }

    #[test]
    fn rejects_wrong_discriminator_and_short_data() {
        let mut data = encode_price_update(&sample(true), [1u8; 32], 42);
        data[0] ^= 1;
        assert!(parse_price_update(&data).is_err());
        assert!(parse_price_update(&[0u8; 20]).is_err());
    }
}
