// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title EscrowVault
 * @notice Holds task funds in escrow until delivery is confirmed or deadline passes.
 *         Supports partial releases for milestone-based tasks and deadline slashing.
 */
contract EscrowVault {
    // ─── State ───────────────────────────────────────────────────────
    address public registry;
    address public verifier;
    address public owner;

    struct Escrow {
        uint256 totalDeposited;
        uint256 released;
        address poster;
        bool settled;
    }

    mapping(uint256 => Escrow) public escrows;

    // ─── Events ──────────────────────────────────────────────────────
    event Deposited(uint256 indexed taskId, uint256 amount);
    event Released(uint256 indexed taskId, address indexed worker, uint256 amount);
    event Refunded(uint256 indexed taskId, address indexed poster, uint256 amount);

    // ─── Errors ──────────────────────────────────────────────────────
    error OnlyRegistry();
    error OnlyRegistryOrVerifier();
    error OnlyOwner();
    error AlreadySettled();
    error InsufficientBalance();
    error TransferFailed();

    // ─── Constructor ─────────────────────────────────────────────────
    constructor() {
        owner = msg.sender;
    }

    // ─── Admin ───────────────────────────────────────────────────────
    function setRegistry(address _registry) external {
        if (msg.sender != owner) revert OnlyOwner();
        registry = _registry;
    }

    function setVerifier(address _verifier) external {
        if (msg.sender != owner) revert OnlyOwner();
        verifier = _verifier;
    }

    // ─── Core ────────────────────────────────────────────────────────
    /**
     * @notice Deposit funds for a task (called by HireRegistry on task creation)
     * @param taskId The task ID
     */
    function deposit(uint256 taskId) external payable {
        if (msg.sender != registry) revert OnlyRegistry();

        escrows[taskId].totalDeposited += msg.value;
        escrows[taskId].poster = tx.origin; // Store original poster

        emit Deposited(taskId, msg.value);
    }

    /**
     * @notice Release funds to worker after deliverable verification
     * @param taskId The task ID
     * @param worker Worker address to pay
     * @param amount Amount to release
     */
    function release(uint256 taskId, address worker, uint256 amount) external {
        if (msg.sender != registry && msg.sender != verifier) revert OnlyRegistryOrVerifier();

        Escrow storage e = escrows[taskId];
        if (e.settled) revert AlreadySettled();
        if (e.totalDeposited - e.released < amount) revert InsufficientBalance();

        e.released += amount;
        if (e.released == e.totalDeposited) {
            e.settled = true;
        }

        (bool ok,) = worker.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Released(taskId, worker, amount);
    }

    /**
     * @notice Refund remaining funds to poster (cancellation or deadline slash)
     * @param taskId The task ID
     * @param poster Address to refund
     */
    function refund(uint256 taskId, address poster) external {
        if (msg.sender != registry && msg.sender != verifier) revert OnlyRegistryOrVerifier();

        Escrow storage e = escrows[taskId];
        if (e.settled) revert AlreadySettled();

        uint256 remaining = e.totalDeposited - e.released;
        e.released = e.totalDeposited;
        e.settled = true;

        (bool ok,) = poster.call{value: remaining}("");
        if (!ok) revert TransferFailed();

        emit Refunded(taskId, poster, remaining);
    }

    // ─── Views ───────────────────────────────────────────────────────
    function getBalance(uint256 taskId) external view returns (uint256) {
        Escrow storage e = escrows[taskId];
        return e.totalDeposited - e.released;
    }

    function getEscrow(uint256 taskId) external view returns (Escrow memory) {
        return escrows[taskId];
    }

    receive() external payable {}
}
