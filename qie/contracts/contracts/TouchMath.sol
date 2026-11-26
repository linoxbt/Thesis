// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {FixedPointMathLib as F} from "solady/src/utils/FixedPointMathLib.sol";

/// @title TouchMath
/// @notice Opening odds of a touch call: the chance that price touches the
/// strike K at any moment before expiry. With log-price a driftless random
/// walk, the reflection principle gives
///
///     P(touch) = 2 * Phi( -|ln(K/S)| / (sigma * sqrt(tau)) ) = erfc(d / sqrt 2)
///
/// with S = spot, sigma = annualised volatility, tau = window in years.
/// Fixed point at 1e18 (WAD); Phi via Abramowitz & Stegun 7.1.26
/// (|error| < 1.5e-7), so results agree with a float reference to the bp.
///
/// Settlement only sees discrete oracle rounds, not every tick, so a touch is
/// less likely than the continuous formula says. `monitorSecs` (the typical
/// gap between rounds) applies the Broadie-Glasserman-Kou correction: the
/// barrier moves out by beta * sigma * sqrt(dt), beta = -zeta(1/2)/sqrt(2*pi)
/// = 0.5826. monitorSecs = 0 gives the continuous formula.
library TouchMath {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant SECONDS_PER_YEAR = 31_536_000;
    uint256 internal constant SQRT2_WAD = 1_414_213_562_373_095_049;
    uint256 internal constant BGK_BETA_WAD = 582_597_157_939_010_717; // 0.5825971579

    // A&S 7.1.26 coefficients, scaled to WAD.
    int256 internal constant P = 327_591_100_000_000_000; // 0.3275911
    int256 internal constant A1 = 254_829_592_000_000_000; // 0.254829592
    int256 internal constant A2 = -284_496_736_000_000_000; // -0.284496736
    int256 internal constant A3 = 1_421_413_741_000_000_000; // 1.421413741
    int256 internal constant A4 = -1_453_152_027_000_000_000; // -1.453152027
    int256 internal constant A5 = 1_061_405_429_000_000_000; // 1.061405429

    /// @return d = (|ln(strike/spot)| + beta*sigma*sqrt(dt)) / (sigma * sqrt(tau)), in WAD.
    function distance(uint256 spot, uint256 strike, uint256 sigmaBps, uint256 tauSecs, uint256 monitorSecs)
        internal
        pure
        returns (uint256)
    {
        int256 ln = F.lnWad(int256(F.mulDiv(strike, WAD, spot)));
        uint256 absLn = uint256(ln < 0 ? -ln : ln);
        uint256 sigma = sigmaBps * (WAD / BPS);
        if (monitorSecs > 0) {
            uint256 sqrtDt = F.sqrtWad(F.mulDiv(monitorSecs, WAD, SECONDS_PER_YEAR));
            absLn += F.mulDiv(F.mulDiv(BGK_BETA_WAD, sigma, WAD), sqrtDt, WAD);
        }
        uint256 sqrtTau = F.sqrtWad(F.mulDiv(tauSecs, WAD, SECONDS_PER_YEAR));
        uint256 denom = F.mulDiv(sigma, sqrtTau, WAD);
        return F.mulDiv(absLn, WAD, denom);
    }

    /// @notice How far price can plausibly have moved since a print `ageSecs`
    /// old: z * sigma * sqrt(age), in bps (zTenths = 30 means z = 3.0).
    function staleMoveBps(uint256 sigmaBps, uint256 ageSecs, uint256 zTenths) internal pure returns (uint256) {
        if (ageSecs == 0) return 0;
        uint256 sqrtAge = F.sqrtWad(F.mulDiv(ageSecs, WAD, SECONDS_PER_YEAR));
        return F.mulDiv(sigmaBps * zTenths, sqrtAge, WAD * 10);
    }

    /// @notice erfc(y) for y >= 0, in WAD.
    function erfc(uint256 y) internal pure returns (uint256) {
        // t = 1 / (1 + P*y)
        int256 t = int256(F.mulDiv(WAD, WAD, WAD + F.mulDiv(uint256(P), y, WAD)));
        int256 poly = A5;
        poly = A4 + (poly * t) / int256(WAD);
        poly = A3 + (poly * t) / int256(WAD);
        poly = A2 + (poly * t) / int256(WAD);
        poly = A1 + (poly * t) / int256(WAD);
        poly = (poly * t) / int256(WAD);
        // exp(-y^2); expWad returns 0 far below -41 (y > ~6.4), where erfc ~ 0 anyway.
        uint256 y2 = F.mulDiv(y, y, WAD);
        if (y2 > 41 * WAD) return 0;
        int256 e = F.expWad(-int256(y2));
        int256 r = (poly * e) / int256(WAD);
        return r <= 0 ? 0 : uint256(r);
    }

    /// @notice Touch probability in basis points (rounded to nearest), 0..10000.
    /// Inputs must be positive; `spot` and `strike` share one scale.
    function touchProbabilityBps(uint256 spot, uint256 strike, uint256 sigmaBps, uint256 tauSecs, uint256 monitorSecs)
        internal
        pure
        returns (uint256)
    {
        require(spot > 0 && strike > 0 && sigmaBps > 0 && tauSecs > 0, "TouchMath: bad input");
        uint256 d = distance(spot, strike, sigmaBps, tauSecs, monitorSecs);
        uint256 p = erfc(F.mulDiv(d, WAD, SQRT2_WAD));
        uint256 bps = (p * BPS + WAD / 2) / WAD;
        return bps > BPS ? BPS : bps;
    }

    /// @notice |strike - spot| / spot in bps, rounded down.
    function distanceBps(uint256 spot, uint256 strike) internal pure returns (uint256) {
        uint256 diff = strike > spot ? strike - spot : spot - strike;
        return (diff * BPS) / spot;
    }
}
