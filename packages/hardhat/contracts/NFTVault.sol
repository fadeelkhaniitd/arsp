// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract NFTVault is IERC721Receiver {
    // token => tokenId => logical owner inside vault
    mapping(address => mapping(uint256 => address)) public ownerOf;

    // token => tokenId => reserved settlementId (0 = free)
    mapping(address => mapping(uint256 => uint256)) public reservedForSettlement;

    address public settlementManager;

    modifier onlySettlementManager() {
        require(msg.sender == settlementManager, "NFTVault: not settlement manager");
        _;
    }

    constructor() {
        settlementManager = msg.sender; // will be updated via setSettlementManager
    }

    function setSettlementManager(address _settlementManager) external {
        require(msg.sender == settlementManager, "NFTVault: not allowed");
        settlementManager = _settlementManager;
    }

    /// @notice Deposit an NFT into the vault. Caller must have approved NFTVault.
    function deposit(address token, uint256 tokenId) external {
        IERC721(token).safeTransferFrom(msg.sender, address(this), tokenId);
        ownerOf[token][tokenId] = msg.sender;
        // not reserved yet
        reservedForSettlement[token][tokenId] = 0;
    }

    /// @notice Withdraw an NFT from the vault.
    /// Fails if the NFT is reserved in a pending settlement.
    function withdraw(address token, uint256 tokenId) external {
        require(ownerOf[token][tokenId] == msg.sender, "NFTVault: not owner");
        require(reservedForSettlement[token][tokenId] == 0, "NFTVault: locked in settlement");

        ownerOf[token][tokenId] = address(0);
        IERC721(token).safeTransferFrom(address(this), msg.sender, tokenId);
    }

    /// @notice Reserve this NFT for a given settlementId (called on submit).
    function reserveForSettlement(address token, uint256 tokenId, uint256 settlementId)
        external
        onlySettlementManager
    {
        require(ownerOf[token][tokenId] != address(0), "NFTVault: not deposited");
        require(reservedForSettlement[token][tokenId] == 0, "NFTVault: already reserved");
        reservedForSettlement[token][tokenId] = settlementId;
    }

    /// @notice Finalize: change logical owner, keep NFT in vault.
    function finalizeForSettlement(
        address token,
        uint256 tokenId,
        address to,
        uint256 settlementId
    ) external onlySettlementManager {
        require(reservedForSettlement[token][tokenId] == settlementId, "NFTVault: wrong settlement");
        // old owner is ownerOf[token][tokenId], we just overwrite
        reservedForSettlement[token][tokenId] = 0;
        ownerOf[token][tokenId] = to;
    }

    /// @notice Rollback: cancel reservation, keep original owner.
    function cancelReservation(
        address token,
        uint256 tokenId,
        uint256 settlementId
    ) external onlySettlementManager {
        require(reservedForSettlement[token][tokenId] == settlementId, "NFTVault: wrong settlement");
        reservedForSettlement[token][tokenId] = 0;
        // ownerOf stays as original owner
    }

    /// @notice Allow this contract to receive ERC-721 via safeTransferFrom
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}