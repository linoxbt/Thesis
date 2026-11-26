// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TouchMath} from "../TouchMath.sol";

contract TouchMathHarness {
    function touchProbabilityBps(uint256 spot, uint256 strike, uint256 sigmaBps, uint256 tauSecs) external pure returns (uint256) {
        return TouchMath.touchProbabilityBps(spot, strike, sigmaBps, tauSecs, 0);
    }
    function touchProbabilityBpsDiscrete(uint256 spot, uint256 strike, uint256 sigmaBps, uint256 tauSecs, uint256 monitorSecs)
        external
        pure
        returns (uint256)
    {
        return TouchMath.touchProbabilityBps(spot, strike, sigmaBps, tauSecs, monitorSecs);
    }
    function staleMoveBps(uint256 sigmaBps, uint256 ageSecs, uint256 zTenths) external pure returns (uint256) {
        return TouchMath.staleMoveBps(sigmaBps, ageSecs, zTenths);
    }
    function erfc(uint256 y) external pure returns (uint256) { return TouchMath.erfc(y); }
}
