// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAggregatorV3 {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

contract OracleHub {
    struct PriceSnapshot {
        uint256 price;
        uint256 timestamp;
    }

    // Current epoch (validators choose epochs externally)
    uint256 public currentEpoch;

    // epoch => token => snapshot
    mapping(uint256 => mapping(address => PriceSnapshot)) public prices;

    // token => Chainlink feed
    mapping(address => address) public chainlinkFeed;

    event EpochRolled(uint256 newEpoch);
    event ManualPriceSet(address indexed token, uint256 price);
    event ChainlinkFeedSet(address indexed token, address indexed feed);

    constructor() {}

    // -------------------------------------------------------
    // 1. Configure Chainlink feed for token
    // -------------------------------------------------------
    function setChainlinkFeed(address token, address feed) external {
        require(token != address(0), "token=0");
        require(feed != address(0), "feed=0");

        chainlinkFeed[token] = feed;
        emit ChainlinkFeedSet(token, feed);
    }

    // -------------------------------------------------------
    // 2. Manual fallback
    // -------------------------------------------------------
    function setPrice(address token, uint256 price) external {
        prices[currentEpoch][token] =
            PriceSnapshot(price, block.timestamp);

        emit ManualPriceSet(token, price);
    }

    // -------------------------------------------------------
    // 3. Read price: prefer Chainlink, fallback to manual
    // -------------------------------------------------------
    function getPrice(uint256 epochId, address token)
        external
        view
        returns (uint256 price, uint256 ts)
    {
        address feed = chainlinkFeed[token];

        if (feed != address(0)) {
            // Try chainlink
            (
                ,
                int256 answer,
                ,
                uint256 updatedAt,

            ) = IAggregatorV3(feed).latestRoundData();

            if (answer > 0) {
                return (uint256(answer), updatedAt);
            }
        }

        // fallback: manual
        PriceSnapshot memory snap = prices[epochId][token];
        return (snap.price, snap.timestamp);
    }

    // -------------------------------------------------------
    // 4. Epoch rolling
    // -------------------------------------------------------
    function newEpoch() external {
        currentEpoch++;
        emit EpochRolled(currentEpoch);
    }
}