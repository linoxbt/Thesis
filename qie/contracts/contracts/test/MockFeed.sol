// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Chainlink-style feed with settable rounds (tests only).
contract MockFeed {
    struct Round { int256 answer; uint256 updatedAt; }
    mapping(uint80 => Round) public rounds;
    uint80 public latest;
    string public description;

    constructor(string memory description_) { description = description_; }

    function decimals() external pure returns (uint8) { return 8; }

    function push(int256 answer, uint256 updatedAt) external returns (uint80 id) {
        id = ++latest;
        rounds[id] = Round(answer, updatedAt);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = rounds[latest];
        return (latest, r.answer, r.updatedAt, r.updatedAt, latest);
    }

    function getRoundData(uint80 id) external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = rounds[id];
        require(r.updatedAt != 0, "No data present");
        return (id, r.answer, r.updatedAt, r.updatedAt, id);
    }
}
