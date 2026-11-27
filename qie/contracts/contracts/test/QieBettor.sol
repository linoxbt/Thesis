// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IThesisCalls {
    function bet(uint256 id, bool yes, uint256 amount) external payable;
    function claim(uint256 id) external returns (uint256);
    function claimCreatorFees(address token) external returns (uint256);
}

/// @notice A contract wallet that bets in native QIE and then either accepts
/// its payout, refuses it, or tries to re-enter the contract while receiving.
contract QieBettor {
    enum Mode {
        Accept,
        Refuse,
        Reenter
    }

    IThesisCalls public immutable calls;
    Mode public mode;
    uint256 public reenterId;
    bool public reentered;
    bool public reentryFailed;

    constructor(IThesisCalls calls_) {
        calls = calls_;
    }

    function setMode(Mode m, uint256 id) external {
        mode = m;
        reenterId = id;
    }

    function bet(uint256 id, bool yes) external payable {
        calls.bet{value: msg.value}(id, yes, msg.value);
    }

    function claim(uint256 id) external returns (uint256) {
        return calls.claim(id);
    }

    receive() external payable {
        if (mode == Mode.Refuse) revert("no QIE");
        if (mode == Mode.Reenter && !reentered) {
            reentered = true;
            try calls.claim(reenterId) {} catch {
                reentryFailed = true;
            }
        }
    }
}
