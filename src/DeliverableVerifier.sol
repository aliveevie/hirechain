// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IEscrowVault} from "./interfaces/IHireChain.sol";

/**
 * @title DeliverableVerifier
 * @notice Verifies that worker-submitted Filecoin CIDs match expected deliverable hashes.
 *         On successful verification, triggers escrow release and task completion.
 *         On mismatch, opens a dispute window.
 */
contract DeliverableVerifier {
    // ─── Types ───────────────────────────────────────────────────────
    struct Deliverable {
        bytes32 cidHash;
        string filecoinCid;        // Raw CID string for off-chain reference
        address worker;
        uint256 submittedAt;
        bool verified;
        bool disputed;
    }

    // ─── State ───────────────────────────────────────────────────────
    address public registry;
    IEscrowVault public escrow;
    address public owner;
    uint256 public disputeWindow = 3 days;

    mapping(uint256 => Deliverable) public deliverables;
    mapping(uint256 => bytes32) public expectedHashes; // taskId => expected CID hash

    // ─── Events ──────────────────────────────────────────────────────
    event DeliverableSubmitted(uint256 indexed taskId, address indexed worker, bytes32 cidHash, string filecoinCid);
    event DeliverableVerified(uint256 indexed taskId, address indexed worker);
    event DeliverableDisputed(uint256 indexed taskId, bytes32 expected, bytes32 actual);
    event ExpectedHashSet(uint256 indexed taskId, bytes32 cidHash);

    // ─── Errors ──────────────────────────────────────────────────────
    error OnlyOwner();
    error OnlyRegistry();
    error AlreadySubmitted();
    error NotSubmitted();
    error AlreadyVerified();
    error HashMismatch();
    error DisputeWindowActive();

    // ─── Constructor ─────────────────────────────────────────────────
    constructor(address _escrow) {
        escrow = IEscrowVault(_escrow);
        owner = msg.sender;
    }

    function setRegistry(address _registry) external {
        if (msg.sender != owner) revert OnlyOwner();
        registry = _registry;
    }

    // ─── Expected Hash Management ────────────────────────────────────
    /**
     * @notice Set expected deliverable hash for a task (called at task creation or by poster)
     * @param taskId The task ID
     * @param cidHash Expected keccak256 hash of the Filecoin CID
     */
    function setExpectedHash(uint256 taskId, bytes32 cidHash) external {
        // Can be called by registry or task poster
        expectedHashes[taskId] = cidHash;
        emit ExpectedHashSet(taskId, cidHash);
    }

    // ─── Submission & Verification ───────────────────────────────────
    /**
     * @notice Worker submits their deliverable CID after uploading to Filecoin
     * @param taskId The task ID
     * @param cidHash keccak256 hash of the Filecoin CID
     * @param filecoinCid The raw Filecoin CID string for reference
     */
    function submitDeliverable(
        uint256 taskId,
        bytes32 cidHash,
        string calldata filecoinCid
    ) external {
        Deliverable storage d = deliverables[taskId];
        if (d.submittedAt != 0) revert AlreadySubmitted();

        d.cidHash = cidHash;
        d.filecoinCid = filecoinCid;
        d.worker = msg.sender;
        d.submittedAt = block.timestamp;

        emit DeliverableSubmitted(taskId, msg.sender, cidHash, filecoinCid);

        // Auto-verify if expected hash matches
        bytes32 expected = expectedHashes[taskId];
        if (expected != bytes32(0) && expected == cidHash) {
            _verify(taskId);
        } else if (expected != bytes32(0) && expected != cidHash) {
            d.disputed = true;
            emit DeliverableDisputed(taskId, expected, cidHash);
        }
        // If no expected hash set, manual verification needed
    }

    /**
     * @notice Manually verify a deliverable (poster approves)
     * @param taskId The task ID
     */
    function approveDeliverable(uint256 taskId) external {
        Deliverable storage d = deliverables[taskId];
        if (d.submittedAt == 0) revert NotSubmitted();
        if (d.verified) revert AlreadyVerified();

        _verify(taskId);
    }

    /**
     * @notice Internal verification logic — releases escrow and marks complete
     */
    function _verify(uint256 taskId) internal {
        Deliverable storage d = deliverables[taskId];
        d.verified = true;
        d.disputed = false;

        // Release escrow to worker
        uint256 balance = escrow.getBalance(taskId);
        if (balance > 0) {
            escrow.release(taskId, d.worker, balance);
        }

        emit DeliverableVerified(taskId, d.worker);
    }

    // ─── Views ───────────────────────────────────────────────────────
    function getDeliverable(uint256 taskId) external view returns (Deliverable memory) {
        return deliverables[taskId];
    }

    function isVerified(uint256 taskId) external view returns (bool) {
        return deliverables[taskId].verified;
    }

    function isDisputed(uint256 taskId) external view returns (bool) {
        return deliverables[taskId].disputed;
    }
}
