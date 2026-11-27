// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TouchMath} from "./TouchMath.sol";

/// @title TouchMathLib
/// @notice TouchMath deployed once as its own library contract, so the odds
/// math doesn't count toward ThesisCalls' 24 KB code-size limit. ThesisCalls
/// links to it (DELEGATECALL); it holds no state and nothing to configure.
library TouchMathLib {
    function distanceBps(uint256 spot, uint256 strike) public pure returns (uint256) {
        return TouchMath.distanceBps(spot, strike);
    }

    function staleMoveBps(uint256 sigmaBps, uint256 ageSecs, uint256 zTenths) public pure returns (uint256) {
        return TouchMath.staleMoveBps(sigmaBps, ageSecs, zTenths);
    }

    function touchProbabilityBps(uint256 spot, uint256 strike, uint256 sigmaBps, uint256 tauSecs, uint256 monitorSecs)
        public
        pure
        returns (uint256)
    {
        return TouchMath.touchProbabilityBps(spot, strike, sigmaBps, tauSecs, monitorSecs);
    }
}
