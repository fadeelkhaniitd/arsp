// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Vault } from "./Vault.sol";
import { NFTVault } from "./NFTVault.sol";
import { OracleHub } from "./OracleHub.sol";

contract SettlementManager {
    enum SettlementStatus { None, Pending, Finalized, Invalid }

    struct AssetTransfer {
        address token;
        address from;
        address to;
        uint256 amount;   // ERC-20 amount
        uint256 tokenId;  // ERC-721 id
        bool    isERC721;
    }

    struct SignedIntent {
        address party;
        uint256 nonce;
        uint256 expiry;
        uint256 epochId;
        bytes32 settlementHash;
        bytes   signature;
    }

    struct SettlementRecord {
        SettlementStatus status;
        uint256          epochId;
        uint256          commitBlock;
        bytes32          settlementHash;
        address          submitter;
        AssetTransfer[]  transfers;
    }

    Vault     public vault;
    NFTVault  public nftVault;
    OracleHub public oracleHub;

    uint256 public challengeWindowBlocks;

    // EIP-712 domain
    bytes32 public DOMAIN_SEPARATOR;
    bytes32 public constant USER_INTENT_TYPEHASH =
        keccak256("UserIntent(address party,uint256 nonce,uint256 expiry,uint256 epochId,bytes32 settlementHash)");

    // Nonces and settlements
    mapping(address => mapping(uint256 => bool)) public nonceUsed;
    mapping(uint256 => SettlementRecord) public settlements;
    uint256 public nextSettlementId;

    // --- submitter staking & slashing ---

    address public owner;
    mapping(address => uint256) public submitterStake;           // submitter => ETH stake
    mapping(address => uint256) public pendingSettlementsCount;  // submitter => number of pending settlements

    uint256 public minSubmitterStake;  // minimum stake required to submit
    uint256 public slashAmount;        // amount of stake to slash on invalidation (in wei)

    event SettlementPending(uint256 indexed id, uint256 epochId, bytes32 hash, address submitter);
    event SettlementFinalized(uint256 indexed id);
    event SettlementInvalidated(uint256 indexed id, address challenger);
    event SubmitterStaked(address indexed submitter, uint256 amount);
    event SubmitterUnstaked(address indexed submitter, uint256 amount);
    event SubmitterSlashed(address indexed submitter, uint256 amount, address indexed challenger, uint256 reward);

    modifier onlyOwner() {
        require(msg.sender == owner, "SettlementManager: not owner");
        _;
    }

    constructor(
        address _vault,
        address _nftVault,
        address _oracleHub,
        uint256 _challengeWindowBlocks,
        uint256 _minSubmitterStake,
        uint256 _slashAmount
    ) {
        vault = Vault(_vault);
        nftVault = NFTVault(_nftVault);
        oracleHub = OracleHub(_oracleHub);
        challengeWindowBlocks = _challengeWindowBlocks;

        owner = msg.sender;
        minSubmitterStake = _minSubmitterStake;
        slashAmount = _slashAmount;

        uint256 chainId;
        assembly {
            chainId := chainid()
        }

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("SettlementManager")),
                keccak256(bytes("1")),
                chainId,
                address(this)
            )
        );
    }

    // ----------------- OWNER CONFIG -----------------

    function setMinSubmitterStake(uint256 _minStake) external onlyOwner {
        minSubmitterStake = _minStake;
    }

    function setSlashAmount(uint256 _slashAmount) external onlyOwner {
        slashAmount = _slashAmount;
    }

    // ----------------- SUBMITTER STAKING -----------------

    /// @notice Stake ETH to become a submitter.
    function stake() external payable {
        require(msg.value > 0, "stake: no value");
        submitterStake[msg.sender] += msg.value;
        emit SubmitterStaked(msg.sender, msg.value);
    }

    /// @notice Unstake ETH. You must have no pending settlements.
    function unstake(uint256 amount) external {
        require(pendingSettlementsCount[msg.sender] == 0, "unstake: pending settlements");
        require(submitterStake[msg.sender] >= amount, "unstake: insufficient stake");

        submitterStake[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "unstake: ETH transfer failed");

        emit SubmitterUnstaked(msg.sender, amount);
    }

    // ----------------- INTERNAL HELPERS (EIP-712) -----------------

    function _hashUserIntent(
        address party,
        uint256 nonce,
        uint256 expiry,
        uint256 epochId,
        bytes32 settlementHash
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                USER_INTENT_TYPEHASH,
                party,
                nonce,
                expiry,
                epochId,
                settlementHash
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function _recoverSigner(bytes32 digest, bytes memory signature) internal pure returns (address) {
        require(signature.length == 65, "bad sig length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "bad v");
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "ecrecover failed");
        return signer;
    }

    function _verifyIntent(SignedIntent memory intent, bytes32 settlementHash)
        internal
        view
        returns (address signer)
    {
        bytes32 digest = _hashUserIntent(
            intent.party,
            intent.nonce,
            intent.expiry,
            intent.epochId,
            settlementHash
        );
        signer = _recoverSigner(digest, intent.signature);
    }

    // ----------------- CORE: SUBMIT -----------------

    function submitSettlement(
        uint256 epochId,
        AssetTransfer[] calldata transfers,
        SignedIntent[] calldata intents
    ) external returns (uint256 settlementId) {
        // require submitter has enough stake
        require(submitterStake[msg.sender] >= minSubmitterStake, "submit: insufficient stake");

        // epoch check (using OracleHub just as an epoch source in v0)
        require(epochId == oracleHub.currentEpoch(), "submit: wrong epoch");

        // compute settlementHash
        bytes32 settlementHash = keccak256(abi.encode(epochId, transfers));

        // verify intents
        for (uint256 i = 0; i < intents.length; i++) {
            SignedIntent calldata it = intents[i];
            address signer = _verifyIntent(it, settlementHash);
            require(signer == it.party, "submit: bad sig");
            require(it.epochId == epochId, "submit: epoch mismatch");
            require(block.timestamp <= it.expiry, "submit: expired");
            require(!nonceUsed[it.party][it.nonce], "submit: nonce used");
            require(it.settlementHash == settlementHash, "submit: hash mismatch");
            nonceUsed[it.party][it.nonce] = true;
        }

        // create record & lock assets
        settlementId = nextSettlementId++;
        SettlementRecord storage rec = settlements[settlementId];
        rec.status = SettlementStatus.Pending;
        rec.epochId = epochId;
        rec.commitBlock = block.number;
        rec.settlementHash = settlementHash;
        rec.submitter = msg.sender;

        pendingSettlementsCount[msg.sender] += 1;

        bool hasFeeTransfer = false;

        for (uint256 j = 0; j < transfers.length; j++) {
            AssetTransfer calldata t = transfers[j];
            rec.transfers.push(t);

            if (t.isERC721) {
                // NFT must already be deposited in NFTVault by 'from'
                require(nftVault.ownerOf(t.token, t.tokenId) == t.from, "submit: NFT not in vault");
                nftVault.reserveForSettlement(t.token, t.tokenId, settlementId);
            } else {
                // Lock ERC-20 inside Vault
                vault.lock(t.token, t.from, t.amount, settlementId);

                // Consider any ERC-20 transfer to the submitter as fee
                if (t.to == msg.sender && t.amount > 0) {
                    hasFeeTransfer = true;
                }
            }
        }

        // enforce that submitter gets at least some ERC-20 as fee
        require(hasFeeTransfer, "submit: no fee for submitter");

        emit SettlementPending(settlementId, epochId, settlementHash, msg.sender);
    }

    // ----------------- FINALIZE -----------------

    function finalizeSettlement(uint256 settlementId) external {
        SettlementRecord storage rec = settlements[settlementId];
        require(rec.status == SettlementStatus.Pending, "finalize: not pending");
        require(block.number > rec.commitBlock + challengeWindowBlocks, "finalize: challenge window");

        for (uint256 j = 0; j < rec.transfers.length; j++) {
            AssetTransfer storage t = rec.transfers[j];
            if (t.isERC721) {
                // keep NFT in vault; change logical owner
                nftVault.finalizeForSettlement(t.token, t.tokenId, t.to, settlementId);
            } else {
                vault.transferLocked(t.token, t.from, t.to, t.amount, settlementId);
            }
        }

        rec.status = SettlementStatus.Finalized;
        pendingSettlementsCount[rec.submitter] -= 1;

        emit SettlementFinalized(settlementId);
    }

    // ----------------- CHALLENGE + SLASH -----------------

    /// @notice In v0, any call during the challenge window invalidates the settlement.
    /// Later, we will add oracle-based checks here.
    function challengeSettlement(uint256 settlementId) external {
        SettlementRecord storage rec = settlements[settlementId];
        require(rec.status == SettlementStatus.Pending, "challenge: not pending");
        require(block.number <= rec.commitBlock + challengeWindowBlocks, "challenge: too late");

        // rollback: unlock assets and clear NFT reservations
        for (uint256 j = 0; j < rec.transfers.length; j++) {
            AssetTransfer storage t = rec.transfers[j];
            if (t.isERC721) {
                nftVault.cancelReservation(t.token, t.tokenId, settlementId);
            } else {
                vault.unlock(t.token, t.from, t.amount, settlementId);
            }
        }

        rec.status = SettlementStatus.Invalid;
        pendingSettlementsCount[rec.submitter] -= 1;

        // slash submitter
        address submitter = rec.submitter;
        uint256 staked = submitterStake[submitter];
        uint256 penalty = slashAmount <= staked ? slashAmount : staked;

        if (penalty > 0) {
            uint256 reward = penalty / 2; // 50% to challenger, 50% stays in contract
            submitterStake[submitter] -= penalty;

            if (reward > 0) {
                (bool ok, ) = msg.sender.call{value: reward}("");
                require(ok, "challenge: reward transfer failed");
            }

            emit SubmitterSlashed(submitter, penalty, msg.sender, reward);
        }

        emit SettlementInvalidated(settlementId, msg.sender);
    }

    // allow contract to receive ETH (for staking) directly if needed
    receive() external payable {}
}