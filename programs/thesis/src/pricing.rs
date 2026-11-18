//! Opening price of a touch market.
//!
//! With log-price treated as a driftless random walk, the reflection principle
//! gives the chance that price touches the strike K before expiry:
//!
//! ```text
//! P(touch) = 2 * Phi( -|ln(K/S)| / (sigma * sqrt(tau)) )
//! ```
//!
//! S = spot, sigma = annualised volatility, tau = window in years. The result
//! is the pm-AMM `initial_price_bps` of the YES side. It is a starting point;
//! traders move the price after that.
//!
//! Computed in f64. SBF programs run IEEE-754 soft-float, which is deterministic,
//! and the result is rounded to whole basis points, so offchain previews that
//! use the same formula agree to within 1 bp.

pub const SECONDS_PER_YEAR: f64 = 31_536_000.0;

/// Standard normal CDF via Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7).
pub fn normal_cdf(z: f64) -> f64 {
    let x = z.abs() / core::f64::consts::SQRT_2;
    let t = 1.0 / (1.0 + 0.327_591_1 * x);
    let poly = t
        * (0.254_829_592
            + t * (-0.284_496_736 + t * (1.421_413_741 + t * (-1.453_152_027 + t * 1.061_405_429))));
    let erf = 1.0 - poly * (-x * x).exp();
    if z >= 0.0 {
        0.5 * (1.0 + erf)
    } else {
        0.5 * (1.0 - erf)
    }
}

/// Probability that price touches `strike` before expiry. `spot` and `strike`
/// share one exponent; `sigma_bps` is annualised volatility in bps (6000 = 60%).
/// Returns None for non-positive inputs.
pub fn touch_probability(spot: i64, strike: i64, sigma_bps: u32, tau_secs: i64) -> Option<f64> {
    if spot <= 0 || strike <= 0 || sigma_bps == 0 || tau_secs <= 0 {
        return None;
    }
    let sigma = sigma_bps as f64 / 10_000.0;
    let tau = tau_secs as f64 / SECONDS_PER_YEAR;
    let d = (strike as f64 / spot as f64).ln().abs() / (sigma * tau.sqrt());
    Some((2.0 * normal_cdf(-d)).clamp(0.0, 1.0))
}

/// `touch_probability` in whole basis points, rounded to nearest.
pub fn opening_price_bps(spot: i64, strike: i64, sigma_bps: u32, tau_secs: i64) -> Option<u16> {
    let p = touch_probability(spot, strike, sigma_bps, tau_secs)?;
    Some((p * 10_000.0).round() as u16)
}

/// |strike - spot| / spot in basis points, rounded down. None if spot <= 0.
pub fn distance_bps(spot: i64, strike: i64) -> Option<u64> {
    if spot <= 0 {
        return None;
    }
    let diff = (strike as i128 - spot as i128).unsigned_abs();
    u64::try_from(diff.checked_mul(10_000)? / spot as u128).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reference values from Python's math.erfc (exact to double precision):
    ///   p = erfc(abs(log(K/S)) / (sigma*sqrt(tau)) / sqrt(2))
    /// (2*Phi(-d) == erfc(d/sqrt(2))).
    #[test]
    fn matches_reference_values() {
        let s = 7_477_778_734i64; // $74.78, expo -8
        let cases: &[(f64, u32, i64, f64)] = &[
            // (strike / spot, sigma_bps, tau_secs, expected P)
            (0.95, 6000, 48 * 3600, 0.248_135_304_4),
            (1.10, 6000, 7 * 86_400, 0.251_357_571_8),
            (0.995, 6000, 600, 0.055_455_586_5),
            (0.5, 6000, 86_400, 0.0),
            (1.5, 8000, 24 * 3600, 0.0),
            (0.999, 6000, 7 * 86_400, 0.990_392_885_2),
        ];
        for &(ratio, sigma, tau, want) in cases {
            let k = (s as f64 * ratio).round() as i64;
            let got = touch_probability(s, k, sigma, tau).unwrap();
            assert!((got - want).abs() < 2e-6, "ratio {ratio} tau {tau}: got {got}, want {want}");
        }
    }

    #[test]
    fn symmetric_in_log_space_and_monotone() {
        let s = 10_000_000_000i64;
        // ln(K/S) symmetric: K = S*e^x and K = S*e^-x give the same probability.
        let up = (s as f64 * 0.05f64.exp()).round() as i64;
        let down = (s as f64 * (-0.05f64).exp()).round() as i64;
        let a = touch_probability(s, up, 6000, 86_400).unwrap();
        let b = touch_probability(s, down, 6000, 86_400).unwrap();
        assert!((a - b).abs() < 1e-6);
        // Farther strike -> lower; longer window -> higher.
        let near = touch_probability(s, s * 99 / 100, 6000, 86_400).unwrap();
        let far = touch_probability(s, s * 90 / 100, 6000, 86_400).unwrap();
        let long = touch_probability(s, s * 90 / 100, 6000, 7 * 86_400).unwrap();
        assert!(near > far && long > far);
    }

    #[test]
    fn bps_and_distance() {
        assert_eq!(opening_price_bps(100, 100, 6000, 600), Some(10_000)); // at spot: certain
        assert_eq!(distance_bps(20_000, 19_900), Some(50));
        assert_eq!(distance_bps(20_000, 30_000), Some(5_000));
        assert_eq!(touch_probability(0, 1, 1, 1), None);
        assert_eq!(touch_probability(1, 1, 0, 1), None);
    }
}
