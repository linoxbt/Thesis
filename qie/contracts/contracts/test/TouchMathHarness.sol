// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TouchMath} from "../TouchMath.sol";

contract TouchMathHarness {
    function touchProbabilityBps(uint256 spot, uint256 strike, uint256 sigmaBps, uint256 tauSecs) external pure returns (uint256) {
        return TouchMath.touchProbabilityBps(spot, strike, sigmaBps, tauSecs);
    }
    function erfc(uint256 y) external pure returns (uint256) { return TouchMath.erfc(y); }
}
