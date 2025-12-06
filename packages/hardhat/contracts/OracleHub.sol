// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IApi3ReaderProxy {
    function read() external view returns (int224 value, uint32 timestamp);
}

/**
 * @title OracleHub
 * @notice Stores per-epoch price snapshots for tokens.
 *         Prices can come from API3 data feed proxies, or be set manually.
 *
 *         SettlementManager relies on:
 *           - currentEpoch()  (via public state var)
 *           - getPrice(epochId, token) -> (price, timestamp)
 */
contract OracleHub {
    struct PriceSnapshot {
        uint256 price;      // whatever decimals the feed uses
        uint256 timestamp;  // when this snapshot was taken
    }

    address public owner;
    uint256 public currentEpoch; // public -> auto-generated getter currentEpoch()

    // epoch => token => snapshot
    mapping(uint256 => mapping(address => PriceSnapshot)) public prices;

    // token => API3 reader proxy
    mapping(address => address) public api3Proxy;

    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event EpochAdvanced(uint256 newEpoch);
    event PriceSet(uint256 indexed epochId, address indexed token, uint256 price, uint256 timestamp, string source);
    event Api3ProxySet(address indexed token, address indexed proxy);

    modifier onlyOwner() {
        require(msg.sender == owner, "OracleHub: not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ---------------- OWNER CONTROL ----------------

    function setOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "OracleHub: zero owner");
        emit OwnerChanged(owner, newOwner);
        owner = newOwner;
    }

    function advanceEpoch() external onlyOwner {
        currentEpoch += 1;
        emit EpochAdvanced(currentEpoch);
    }

    // ---------------- API3 CONFIG + UPDATE ----------------

    /// @notice Configure the API3 reader proxy for a given token.
    function setApi3Proxy(address token, address proxy) external onlyOwner {
        require(token != address(0), "OracleHub: token=0");
        require(proxy != address(0), "OracleHub: proxy=0");
        api3Proxy[token] = proxy;
        emit Api3ProxySet(token, proxy);
    }

    /// @notice Pull current price from API3 and store a snapshot in the current epoch.
    function updateFromApi3(address token) external {
        address proxy = api3Proxy[token];
        require(proxy != address(0), "OracleHub: no proxy");

        (int224 value, uint32 ts) = IApi3ReaderProxy(proxy).read();
        require(value > 0, "OracleHub: bad value");

        prices[currentEpoch][token] = PriceSnapshot({
            price: uint256(int256(value)),
            timestamp: ts == 0 ? block.timestamp : uint256(ts)
        });

        emit PriceSet(currentEpoch, token, uint256(int256(value)), uint256(ts), "api3");
    }

    // ---------------- MANUAL FALLBACK ----------------

    /// @notice Manually set price for the current epoch (useful for testing or tokens without API3 feed).
    function setPrice(address token, uint256 price) external onlyOwner {
        require(token != address(0), "OracleHub: token=0");
        prices[currentEpoch][token] = PriceSnapshot({
            price: price,
            timestamp: block.timestamp
        });
        emit PriceSet(currentEpoch, token, price, block.timestamp, "manual");
    }

    // ---------------- VIEW API ----------------

    /// @notice Get price snapshot for a token in a given epoch.
    /// @return price - feed value as returned by API3 (no extra scaling)
    /// @return timestamp - snapshot timestamp
    function getPrice(uint256 epochId, address token)
        external
        view
        returns (uint256 price, uint256 timestamp)
    {
        PriceSnapshot memory snap = prices[epochId][token];
        return (snap.price, snap.timestamp);
    }
}
