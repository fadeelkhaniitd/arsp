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
        uint256 amount;   // ERC20 amount
        uint256 tokenId;  // ERC721 token id
        bool    isERC721;
    }

    // Intent now includes feeToken + feeAmount
    struct SignedIntent {
        address party;
        uint256 nonce;
        uint256 expiry;
        uint256 epochId;
        bytes32 settlementHash;
        address feeToken;
        uint256 feeAmount;
        bytes   signature;
    }

    struct FeeLock {
        address party;
        address token;
        uint256 amount;
    }

    struct SettlementRecord {
        SettlementStatus status;
        uint256          epochId;
        uint256          commitBlock;
        bytes32          settlementHash;
        address          submitter;
        AssetTransfer[]  transfers;
        FeeLock[]        feeLocks;
    }

    Vault     public vault;
    NFTVault  public nftVault;
    OracleHub public oracleHub;

    uint256 public challengeWindowBlocks;
    uint256 public maxSnapshotAge;
    uint256 public maxFairnessRatioBps;

    // EIP-712
    bytes32 public DOMAIN_SEPARATOR;

    // Must match frontend’s typed data
    bytes32 public constant USER_INTENT_TYPEHASH =
        keccak256(
            "UserIntent(address party,uint256 nonce,uint256 expiry,uint256 epochId,bytes32 settlementHash,address feeToken,uint256 feeAmount)"
        );

    // storage
    mapping(address => mapping(uint256 => bool)) public nonceUsed;
    mapping(uint256 => SettlementRecord) public settlements;
    uint256 public nextSettlementId;

    // submitter staking
    address public owner;
    mapping(address => uint256) public submitterStake;
    mapping(address => uint256) public pendingSettlementsCount;

    uint256 public minSubmitterStake;
    uint256 public slashAmount;

    event SettlementPending(uint256 indexed id, uint256 epochId, bytes32 hash, address submitter);
    event SettlementFinalized(uint256 indexed id);
    event SettlementInvalidated(uint256 indexed id, address challenger);

    event SubmitterStaked(address indexed who, uint256 amount);
    event SubmitterUnstaked(address indexed who, uint256 amount);
    event SubmitterSlashed(address indexed who, uint256 amount, address challenger, uint256 reward);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(
        address _vault,
        address _nftVault,
        address _oracleHub,
        uint256 _challengeWindowBlocks,
        uint256 _minSubmitterStake,
        uint256 _slashAmount,
        uint256 _maxSnapshotAge,
        uint256 _maxFairnessRatioBps
    ) {
        vault = Vault(_vault);
        nftVault = NFTVault(_nftVault);
        oracleHub = OracleHub(_oracleHub);

        challengeWindowBlocks = _challengeWindowBlocks;
        minSubmitterStake = _minSubmitterStake;
        slashAmount = _slashAmount;
        maxSnapshotAge = _maxSnapshotAge;
        maxFairnessRatioBps = _maxFairnessRatioBps;

        owner = msg.sender;

        uint256 chainId;
        assembly {
            chainId := chainid()
        }

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("SettlementManager")),
                keccak256(bytes("1")),
                chainId,
                address(this)
            )
        );
    }

    /*//////////////////////////////////////////////////////////////
                        OWNER CONFIG
    //////////////////////////////////////////////////////////////*/

    function setMinSubmitterStake(uint256 a) external onlyOwner {
        minSubmitterStake = a;
    }

    function setSlashAmount(uint256 a) external onlyOwner {
        slashAmount = a;
    }

    function setMaxSnapshotAge(uint256 a) external onlyOwner {
        maxSnapshotAge = a;
    }

    function setMaxFairnessRatioBps(uint256 a) external onlyOwner {
        maxFairnessRatioBps = a;
    }

    /*//////////////////////////////////////////////////////////////
                        STAKING
    //////////////////////////////////////////////////////////////*/

    function stake() external payable {
        require(msg.value > 0, "no value");
        submitterStake[msg.sender] += msg.value;
        emit SubmitterStaked(msg.sender, msg.value);
    }

    function unstake(uint256 amount) external {
        require(pendingSettlementsCount[msg.sender] == 0, "pending settlements");
        require(submitterStake[msg.sender] >= amount, "insufficient stake");

        submitterStake[msg.sender] -= amount;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "ETH transfer failed");

        emit SubmitterUnstaked(msg.sender, amount);
    }

    /*//////////////////////////////////////////////////////////////
                        EIP-712 UTILS
    //////////////////////////////////////////////////////////////*/

    function _hashIntent(SignedIntent memory it, bytes32 settlementHash)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                USER_INTENT_TYPEHASH,
                it.party,
                it.nonce,
                it.expiry,
                it.epochId,
                settlementHash,
                it.feeToken,
                it.feeAmount
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function _recover(bytes32 digest, bytes memory sig)
        internal
        pure
        returns (address)
    {
        require(sig.length == 65, "bad sig length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "bad v");
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "ecrecover fail");
        return signer;
    }

    /*//////////////////////////////////////////////////////////////
                        FAIRNESS CHECK
    //////////////////////////////////////////////////////////////*/

    function _checkFairness(uint256 epochId, AssetTransfer[] memory transfers) internal view {
        // collect unique ERC-20 tokens
        address[] memory tokensTmp = new address[](transfers.length);
        uint256 tokenCount = 0;

        for (uint256 i = 0; i < transfers.length; i++) {
            if (transfers[i].isERC721) continue;
            address tk = transfers[i].token;
            bool seen = false;
            for (uint256 j = 0; j < tokenCount; j++) {
                if (tokensTmp[j] == tk) {
                    seen = true;
                    break;
                }
            }
            if (!seen) {
                tokensTmp[tokenCount] = tk;
                tokenCount++;
            }
        }

        // load prices for each token and check snapshot age
        address[] memory tokens = new address[](tokenCount);
        uint256[] memory prices = new uint256[](tokenCount);

        for (uint256 i = 0; i < tokenCount; i++) {
            tokens[i] = tokensTmp[i];
            (uint256 p, uint256 ts) = oracleHub.getPrice(epochId, tokens[i]);
            require(ts != 0, "fairness: no price");
            require(block.timestamp - ts <= maxSnapshotAge, "fairness: stale snapshot");
            prices[i] = p;
        }

        // collect unique parties
        address[] memory partiesTmp = new address[](transfers.length * 2);
        uint256 partyCount = 0;

        for (uint256 i = 0; i < transfers.length; i++) {
            AssetTransfer memory t = transfers[i];

            // from
            bool seenFrom = false;
            for (uint256 j = 0; j < partyCount; j++) {
                if (partiesTmp[j] == t.from) {
                    seenFrom = true;
                    break;
                }
            }
            if (!seenFrom) {
                partiesTmp[partyCount] = t.from;
                partyCount++;
            }

            // to
            bool seenTo = false;
            for (uint256 j = 0; j < partyCount; j++) {
                if (partiesTmp[j] == t.to) {
                    seenTo = true;
                    break;
                }
            }
            if (!seenTo) {
                partiesTmp[partyCount] = t.to;
                partyCount++;
            }
        }

        address[] memory parties = new address[](partyCount);
        uint256[] memory valueGiven = new uint256[](partyCount);
        uint256[] memory valueReceived = new uint256[](partyCount);

        for (uint256 i = 0; i < partyCount; i++) {
            parties[i] = partiesTmp[i];
        }

        // compute per-party values (ERC-20 only; NFTs treated as zero for now)
        for (uint256 i = 0; i < transfers.length; i++) {
            AssetTransfer memory t = transfers[i];
            if (t.isERC721) {
                continue;
            }
            uint256 price = _priceForToken(tokens, prices, t.token);
            require(price > 0, "fairness: zero price");
            uint256 v = t.amount * price;

            uint256 fromIdx = _indexOfParty(parties, partyCount, t.from);
            uint256 toIdx = _indexOfParty(parties, partyCount, t.to);

            valueGiven[fromIdx] += v;
            valueReceived[toIdx] += v;
        }

        // enforce fairness: for each party that gives value, bound how much they can receive
        if (maxFairnessRatioBps > 0) {
            for (uint256 i = 0; i < partyCount; i++) {
                if (valueGiven[i] == 0) {
                    // party only receives; skip check for now
                    continue;
                }
                // valueReceived * 10000 <= valueGiven * maxFairnessRatioBps
                require(
                    valueReceived[i] * 10000 <= valueGiven[i] * maxFairnessRatioBps,
                    "fairness: ratio exceeded"
                );
            }
        }
    }

    function _find(address[] memory arr, address a) internal pure returns (uint256) {
        for (uint256 i = 0; i < arr.length; i++)
            if (arr[i] == a) return i;
        revert("party not found");
    }

    function _priceForToken(
        address[] memory tokens,
        uint256[] memory prices,
        address token
    ) internal pure returns (uint256) {
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == token) return prices[i];
        }
        return 0;
    }

    function _indexOfParty(
        address[] memory parties,
        uint256 partyCount,
        address party
    ) internal pure returns (uint256) {
        for (uint256 i = 0; i < partyCount; i++) {
            if (parties[i] == party) return i;
        }
        revert("fairness: party not found");
    }


    /*//////////////////////////////////////////////////////////////
                        PUBLIC HELPER
    //////////////////////////////////////////////////////////////*/

    function computeSettlementHash(uint256 epochId, AssetTransfer[] calldata transfers)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(epochId, transfers));
    }

    /*//////////////////////////////////////////////////////////////
                        SUBMIT SETTLEMENT
    //////////////////////////////////////////////////////////////*/

    function submitSettlement(
        uint256 epochId,
        AssetTransfer[] calldata transfers,
        SignedIntent[] calldata intents
    ) external returns (uint256 settlementId) {

        require(submitterStake[msg.sender] >= minSubmitterStake, "submit: insufficient stake");
        require(epochId == oracleHub.currentEpoch(), "submit: wrong epoch");

        bytes32 settlementHash = keccak256(abi.encode(epochId, transfers));

        // verify intents and lock fees
        uint256 totalFees = 0;

        settlementId = ++nextSettlementId;
        SettlementRecord storage rec = settlements[settlementId];
        rec.status = SettlementStatus.Pending;
        rec.epochId = epochId;
        rec.commitBlock = block.number;
        rec.submitter = msg.sender;
        rec.settlementHash = settlementHash;

        pendingSettlementsCount[msg.sender]++;

        // verify signatures + lock fee amounts
        for (uint256 i = 0; i < intents.length; i++) {
            SignedIntent memory it = intents[i];

            bytes32 digest = _hashIntent(it, settlementHash);
            address signer = _recover(digest, it.signature);

            require(signer == it.party, "submit: bad sig");
            require(it.epochId == epochId, "submit: epoch mismatch");
            require(block.timestamp <= it.expiry, "submit: expired");
            require(!nonceUsed[it.party][it.nonce], "submit: nonce used");
            require(it.settlementHash == settlementHash, "submit: hash mismatch");

            nonceUsed[it.party][it.nonce] = true;

            // Fee locking
            require(it.feeToken != address(0), "submit: feeToken zero");
            require(it.feeAmount > 0, "submit: feeAmount zero");

            vault.lock(it.feeToken, it.party, it.feeAmount, settlementId);

            rec.feeLocks.push(FeeLock({
                party: it.party,
                token: it.feeToken,
                amount: it.feeAmount
            }));

            totalFees += it.feeAmount;
        }

        require(totalFees > 0, "submit: no fees in intents");

        // fair price check
        _checkFairness(epochId, transfers);

        // lock transfers
        for (uint256 j = 0; j < transfers.length; j++) {
            AssetTransfer calldata t = transfers[j];
            rec.transfers.push(t);

            if (t.isERC721) {
                require(nftVault.ownerOf(t.token, t.tokenId) == t.from, "submit: NFT not in vault");
                nftVault.reserveForSettlement(t.token, t.tokenId, settlementId);
            } else {
                vault.lock(t.token, t.from, t.amount, settlementId);
            }
        }

        emit SettlementPending(settlementId, epochId, settlementHash, msg.sender);
    }

    /*//////////////////////////////////////////////////////////////
                        FINALIZE
    //////////////////////////////////////////////////////////////*/

    function finalizeSettlement(uint256 settlementId) external {
        SettlementRecord storage rec = settlements[settlementId];
        require(rec.status == SettlementStatus.Pending, "not pending");
        require(block.number > rec.commitBlock + challengeWindowBlocks, "challenge window");

        // transfers
        for (uint256 j = 0; j < rec.transfers.length; j++) {
            AssetTransfer storage t = rec.transfers[j];

            if (t.isERC721) {
                nftVault.finalizeForSettlement(t.token, t.tokenId, t.to, settlementId);
            } else {
                vault.transferLocked(t.token, t.from, t.to, t.amount, settlementId);
            }
        }

        // submitter receives fees
        for (uint256 k = 0; k < rec.feeLocks.length; k++) {
            FeeLock storage f = rec.feeLocks[k];
            vault.transferLocked(f.token, f.party, rec.submitter, f.amount, settlementId);
        }

        rec.status = SettlementStatus.Finalized;
        pendingSettlementsCount[rec.submitter]--;

        emit SettlementFinalized(settlementId);
    }

    /*//////////////////////////////////////////////////////////////
                        CHALLENGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Re-check settlement invariants based on current oracle data.
    /// @dev Used in challengeSettlement via try/catch.
    ///      Reverts if invariants are violated.
    function recheckSettlementInvariants(uint256 settlementId) external view {
        SettlementRecord storage rec = settlements[settlementId];
        require(rec.status == SettlementStatus.Pending, "recheck: not pending");

        uint256 len = rec.transfers.length;
        AssetTransfer[] memory memTransfers = new AssetTransfer[](len);
        for (uint256 i = 0; i < len; i++) {
            memTransfers[i] = rec.transfers[i];
        }

        // Re-run fairness check with current oracle prices.
        _checkFairness(rec.epochId, memTransfers);

        // TODO: later you can add more invariants here, e.g. multi-oracle checks.
    }

    function challengeSettlement(uint256 settlementId) external {
        SettlementRecord storage rec = settlements[settlementId];
        require(rec.status == SettlementStatus.Pending, "challenge: not pending");
        require(block.number <= rec.commitBlock + challengeWindowBlocks, "challenge: too late");

        // --- Model A: Only succeed if invariants are actually broken ---

        // We call recheckSettlementInvariants via external call so we can use try/catch.
        // If invariants still hold, this call will NOT revert -> we revert challenge.
        // If invariants are violated, recheckSettlementInvariants will revert,
        // execution jumps to catch {} branch below and we treat challenge as valid.
        try this.recheckSettlementInvariants(settlementId) {
            // Invariants still hold -> challenge is invalid.
            revert("challenge: invariants hold");
        } catch {
            // Invariants are broken -> valid challenge.
            // We proceed to rollback and slash.
        }

        // --- rollback: unlock assets and clear NFT reservations ---

        for (uint256 j = 0; j < rec.transfers.length; j++) {
            AssetTransfer storage t = rec.transfers[j];
            if (t.isERC721) {
                nftVault.cancelReservation(t.token, t.tokenId, settlementId);
            } else {
                vault.unlock(t.token, t.from, t.amount, settlementId);
            }
        }

        // unlock fees back to parties
        for (uint256 k = 0; k < rec.feeLocks.length; k++) {
            FeeLock storage f = rec.feeLocks[k];
            // if your FeeLock has token in struct, use that; otherwise adjust
            vault.unlock(f.token, f.party, f.amount, settlementId);
        }

        rec.status = SettlementStatus.Invalid;
        pendingSettlementsCount[rec.submitter] -= 1;

        // --- slash submitter and reward challenger ---

        address submitter = rec.submitter;
        uint256 staked = submitterStake[submitter];
        uint256 penalty = slashAmount <= staked ? slashAmount : staked;

        if (penalty > 0) {
            uint256 reward = penalty / 2;
            submitterStake[submitter] -= penalty;

            if (reward > 0) {
                (bool ok, ) = msg.sender.call{value: reward}("");
                require(ok, "challenge: reward transfer failed");
            }

            emit SubmitterSlashed(submitter, penalty, msg.sender, reward);
        }

        emit SettlementInvalidated(settlementId, msg.sender);
    }

        // ----------------- VIEW HELPERS FOR UI -----------------

    function getSettlementSummary(uint256 id)
        external
        view
        returns (
            SettlementStatus status,
            uint256 epochId,
            uint256 commitBlock,
            bytes32 settlementHash,
            address submitter
        )
    {
        SettlementRecord storage rec = settlements[id];
        return (rec.status, rec.epochId, rec.commitBlock, rec.settlementHash, rec.submitter);
    }

    function getSettlementTransfers(uint256 id)
        external
        view
        returns (AssetTransfer[] memory)
    {
        SettlementRecord storage rec = settlements[id];
        uint256 len = rec.transfers.length;
        AssetTransfer[] memory out = new AssetTransfer[](len);
        for (uint256 i = 0; i < len; i++) {
            out[i] = rec.transfers[i];
        }
        return out;
    }

    function getSettlementFeeLocks(uint256 id)
        external
        view
        returns (FeeLock[] memory)
    {
        SettlementRecord storage rec = settlements[id];
        uint256 len = rec.feeLocks.length;
        FeeLock[] memory out = new FeeLock[](len);
        for (uint256 i = 0; i < len; i++) {
            out[i] = rec.feeLocks[i];
        }
        return out;
    }

    receive() external payable {}
}