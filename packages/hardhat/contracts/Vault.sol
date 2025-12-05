// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Vault {
    // token => user => free balance
    mapping(address => mapping(address => uint256)) public balanceOf;

    // token => settlementId => user => locked amount
    mapping(address => mapping(uint256 => mapping(address => uint256))) public locked;

    address public settlementManager;

    modifier onlySettlementManager() {
        require(msg.sender == settlementManager, "Vault: not settlement manager");
        _;
    }

    constructor() {
        // will be updated later via setSettlementManager
        settlementManager = msg.sender;
    }

    function setSettlementManager(address _settlementManager) external {
        // only current settlementManager can change it (initially deployer)
        require(msg.sender == settlementManager, "Vault: not allowed");
        settlementManager = _settlementManager;
    }

    function deposit(address token, uint256 amount) external {
        require(amount > 0, "Vault: amount=0");
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        balanceOf[token][msg.sender] += amount;
    }

    function withdraw(address token, uint256 amount) external {
        require(balanceOf[token][msg.sender] >= amount, "Vault: insufficient balance");
        balanceOf[token][msg.sender] -= amount;
        IERC20(token).transfer(msg.sender, amount);
    }

    // Lock funds for a settlement
    function lock(address token, address from, uint256 amount, uint256 settlementId)
        external
        onlySettlementManager
    {
        require(balanceOf[token][from] >= amount, "Vault: insufficient free");
        balanceOf[token][from] -= amount;
        locked[token][settlementId][from] += amount;
    }

    // Finalization: move locked funds to receiver free balance
    function transferLocked(
        address token,
        address from,
        address to,
        uint256 amount,
        uint256 settlementId
    ) external onlySettlementManager {
        require(locked[token][settlementId][from] >= amount, "Vault: insufficient locked");
        locked[token][settlementId][from] -= amount;
        balanceOf[token][to] += amount;
    }

    // Rollback: unlock back to original owner
    function unlock(address token, address from, uint256 amount, uint256 settlementId)
        external
        onlySettlementManager
    {
        require(locked[token][settlementId][from] >= amount, "Vault: insufficient locked");
        locked[token][settlementId][from] -= amount;
        balanceOf[token][from] += amount;
    }
}