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
        AssetTransfer[]  transfers;
    }

    Vault     public vault;
    NFTVault  public nftVault;
    OracleHub public oracleHub;

    uint256 public challengeWindowBlocks;

    mapping(address => mapping(uint256 => bool)) public nonceUsed;
    mapping(uint256 => SettlementRecord) public settlements;
    uint256 public nextSettlementId;

    // --- EIP-712 setup ---

    bytes32 public DOMAIN_SEPARATOR;
    bytes32 public constant USER_INTENT_TYPEHASH =
        keccak256("UserIntent(address party,uint256 nonce,uint256 expiry,uint256 epochId,bytes32 settlementHash)");

    event SettlementPending(uint256 indexed id, uint256 epochId, bytes32 hash);
    event SettlementFinalized(uint256 indexed id);
    event SettlementInvalidated(uint256 indexed id, address challenger);

    constructor(
        address _vault,
        address _nftVault,
        address _oracleHub,
        uint256 _challengeWindowBlocks
    ) {
        vault = Vault(_vault);
        nftVault = NFTVault(_nftVault);
        oracleHub = OracleHub(_oracleHub);
        challengeWindowBlocks = _challengeWindowBlocks;

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

    // ----------------- INTERNAL HELPERS -----------------

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
        // For v0, we only check that the provided epoch matches currentEpoch
        require(epochId == oracleHub.currentEpoch(), "wrong epoch");

        // 1. Compute settlementHash
        bytes32 settlementHash = keccak256(abi.encode(epochId, transfers));

        // 2. Verify all intents (signatures, nonces, expiry, hash)
        for (uint256 i = 0; i < intents.length; i++) {
            SignedIntent calldata it = intents[i];
            address signer = _verifyIntent(it, settlementHash);
            require(signer == it.party, "bad sig");
            require(it.epochId == epochId, "epoch mismatch");
            require(block.timestamp <= it.expiry, "expired");
            require(!nonceUsed[it.party][it.nonce], "nonce used");
            require(it.settlementHash == settlementHash, "hash mismatch");
            nonceUsed[it.party][it.nonce] = true;
        }

        // 3. Create settlement record & lock assets
        settlementId = ++nextSettlementId;
        SettlementRecord storage rec = settlements[settlementId];
        rec.status = SettlementStatus.Pending;
        rec.epochId = epochId;
        rec.commitBlock = block.number;
        rec.settlementHash = settlementHash;

        for (uint256 j = 0; j < transfers.length; j++) {
            AssetTransfer calldata t = transfers[j];
            rec.transfers.push(t);

            if (t.isERC721) {
                // NFT must already be deposited in NFTVault by 'from'
                require(nftVault.ownerOf(t.token, t.tokenId) == t.from, "NFT not in vault");
                nftVault.reserveForSettlement(t.token, t.tokenId, settlementId);
            } else {
                // Lock ERC-20 inside Vault
                vault.lock(t.token, t.from, t.amount, settlementId);
            }
        }

        emit SettlementPending(settlementId, epochId, settlementHash);
    }

    // ----------------- FINALIZE -----------------

    function finalizeSettlement(uint256 settlementId) external {
        SettlementRecord storage rec = settlements[settlementId];
        require(rec.status == SettlementStatus.Pending, "not pending");
        require(block.number > rec.commitBlock + challengeWindowBlocks, "challenge window");

        // Move locked balances / NFTs to recipients
        for (uint256 j = 0; j < rec.transfers.length; j++) {
            AssetTransfer storage t = rec.transfers[j];
            if (t.isERC721) {
                nftVault.finalizeForSettlement(t.token, t.tokenId, t.to, settlementId);
            } else {
                vault.transferLocked(t.token, t.from, t.to, t.amount, settlementId);
            }
        }

        rec.status = SettlementStatus.Finalized;
        emit SettlementFinalized(settlementId);
    }

    // ----------------- CHALLENGE (v0 stub) -----------------

    // For now, allow INVALIDATION by anyone during the challenge window.
    // In v1, we'll add real oracle/invariant checks here.
    function challengeSettlement(uint256 settlementId) external {
        SettlementRecord storage rec = settlements[settlementId];
        require(rec.status == SettlementStatus.Pending, "not pending");
        require(block.number <= rec.commitBlock + challengeWindowBlocks, "too late");

        // Rollback: unlock everything and clear NFT reservations
        for (uint256 j = 0; j < rec.transfers.length; j++) {
            AssetTransfer storage t = rec.transfers[j];
            if (t.isERC721) {
                nftVault.cancelReservation(t.token, t.tokenId, settlementId);
            } else {
                vault.unlock(t.token, t.from, t.amount, settlementId);
            }
        }

        rec.status = SettlementStatus.Invalid;
        emit SettlementInvalidated(settlementId, msg.sender);
    }
}