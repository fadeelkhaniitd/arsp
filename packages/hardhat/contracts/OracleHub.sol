// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract OracleHub {
    struct EpochSnapshot {
        uint256 epochId;
        uint256 timestamp;
        mapping(address => uint256) price; // token => price (1e18, e.g. USD or ETH units)
    }

    address public owner;
    uint256 public currentEpoch;
    uint256 public maxSnapshotAge; // in seconds

    mapping(uint256 => EpochSnapshot) internal snapshots;

    modifier onlyOwner() {
        require(msg.sender == owner, "OracleHub: not owner");
        _;
    }

    constructor(uint256 _maxSnapshotAge) {
        owner = msg.sender;
        maxSnapshotAge = _maxSnapshotAge;
    }

    function setPrice(address token, uint256 price) external onlyOwner {
        EpochSnapshot storage snap = snapshots[currentEpoch];
        if (snap.timestamp == 0) {
            snap.epochId = currentEpoch;
            snap.timestamp = block.timestamp;
        }
        snap.price[token] = price;
    }

    function rollEpoch() external onlyOwner {
        currentEpoch += 1;
    }

    function getPrice(uint256 epochId, address token)
        external
        view
        returns (uint256 price, uint256 timestamp)
    {
        EpochSnapshot storage snap = snapshots[epochId];
        return (snap.price[token], snap.timestamp);
    }
}