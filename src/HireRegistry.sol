// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IEscrowVault} from "./interfaces/IHireChain.sol";

/**
 * @title HireRegistry
 * @notice Entry point for the HireChain labor market. Humans/orchestrators post tasks,
 *         workers bid, and the registry manages the full task lifecycle.
 * @dev Tasks lock funds in EscrowVault on creation. Workers are assigned on bid acceptance.
 */
contract HireRegistry {
    // ─── Types ───────────────────────────────────────────────────────
    enum TaskStatus { Open, Assigned, Completed, Disputed, Cancelled }

    struct Task {
        uint256 id;
        address poster;
        address worker;
        string description;
        bytes32 expectedCidHash;     // Expected deliverable hash (set by poster)
        uint256 budget;
        uint256 deadline;
        TaskStatus status;
        uint256 createdAt;
        uint256 parentTaskId;        // 0 if root task, else subtask of parent
        uint256[] subtaskIds;
    }

    struct Bid {
        address bidder;
        uint256 amount;
        uint256 timestamp;
        string proposal;
    }

    // ─── State ───────────────────────────────────────────────────────
    IEscrowVault public immutable escrow;

    uint256 public nextTaskId = 1;
    mapping(uint256 => Task) public tasks;
    mapping(uint256 => Bid[]) public bids;
    mapping(address => uint256[]) public posterTasks;
    mapping(address => uint256[]) public workerTasks;

    // ─── Events ──────────────────────────────────────────────────────
    event TaskPosted(uint256 indexed taskId, address indexed poster, uint256 budget, uint256 deadline, string description);
    event SubtaskCreated(uint256 indexed parentTaskId, uint256 indexed subtaskId, string description);
    event BidSubmitted(uint256 indexed taskId, address indexed bidder, uint256 amount);
    event WorkerAssigned(uint256 indexed taskId, address indexed worker);
    event TaskCompleted(uint256 indexed taskId, address indexed worker);
    event TaskDisputed(uint256 indexed taskId);
    event TaskCancelled(uint256 indexed taskId);

    // ─── Errors ──────────────────────────────────────────────────────
    error TaskNotFound();
    error NotPoster();
    error NotWorker();
    error InvalidStatus();
    error DeadlinePassed();
    error InsufficientBudget();
    error BidTooHigh();

    // ─── Constructor ─────────────────────────────────────────────────
    constructor(address _escrow) {
        escrow = IEscrowVault(_escrow);
    }

    // ─── Task Creation ───────────────────────────────────────────────
    /**
     * @notice Post a new task with ETH budget locked in escrow
     * @param description Human-readable task description
     * @param expectedCidHash Expected hash of the deliverable (bytes32(0) if not known upfront)
     * @param deadline Block timestamp by which task must be completed
     */
    function postTask(
        string calldata description,
        bytes32 expectedCidHash,
        uint256 deadline
    ) external payable returns (uint256 taskId) {
        if (msg.value == 0) revert InsufficientBudget();
        if (deadline <= block.timestamp) revert DeadlinePassed();

        taskId = nextTaskId++;

        Task storage t = tasks[taskId];
        t.id = taskId;
        t.poster = msg.sender;
        t.description = description;
        t.expectedCidHash = expectedCidHash;
        t.budget = msg.value;
        t.deadline = deadline;
        t.status = TaskStatus.Open;
        t.createdAt = block.timestamp;

        posterTasks[msg.sender].push(taskId);

        // Lock funds in escrow
        escrow.deposit{value: msg.value}(taskId);

        emit TaskPosted(taskId, msg.sender, msg.value, deadline, description);
    }

    /**
     * @notice Create a subtask under a parent task (orchestrator decomposition)
     * @param parentTaskId The parent task to decompose
     * @param description Subtask description
     * @param expectedCidHash Expected deliverable hash
     * @param budget Budget allocated from parent (must not exceed parent remaining)
     * @param deadline Subtask deadline
     */
    function createSubtask(
        uint256 parentTaskId,
        string calldata description,
        bytes32 expectedCidHash,
        uint256 budget,
        uint256 deadline
    ) external returns (uint256 subtaskId) {
        Task storage parent = tasks[parentTaskId];
        if (parent.id == 0) revert TaskNotFound();
        if (msg.sender != parent.poster && msg.sender != parent.worker) revert NotPoster();

        subtaskId = nextTaskId++;

        Task storage st = tasks[subtaskId];
        st.id = subtaskId;
        st.poster = msg.sender;
        st.description = description;
        st.expectedCidHash = expectedCidHash;
        st.budget = budget;
        st.deadline = deadline;
        st.status = TaskStatus.Open;
        st.createdAt = block.timestamp;
        st.parentTaskId = parentTaskId;

        parent.subtaskIds.push(subtaskId);

        emit SubtaskCreated(parentTaskId, subtaskId, description);
    }

    // ─── Bidding ─────────────────────────────────────────────────────
    /**
     * @notice Submit a bid for an open task
     * @param taskId Task to bid on
     * @param amount Requested payment (must be ≤ task budget)
     * @param proposal Brief description of how you'll complete the task
     */
    function submitBid(uint256 taskId, uint256 amount, string calldata proposal) external {
        Task storage t = tasks[taskId];
        if (t.id == 0) revert TaskNotFound();
        if (t.status != TaskStatus.Open) revert InvalidStatus();
        if (amount > t.budget) revert BidTooHigh();

        bids[taskId].push(Bid({
            bidder: msg.sender,
            amount: amount,
            timestamp: block.timestamp,
            proposal: proposal
        }));

        emit BidSubmitted(taskId, msg.sender, amount);
    }

    /**
     * @notice Accept a bid and assign the worker
     * @param taskId Task ID
     * @param bidIndex Index of the bid to accept
     */
    function acceptBid(uint256 taskId, uint256 bidIndex) external {
        Task storage t = tasks[taskId];
        if (t.id == 0) revert TaskNotFound();
        if (msg.sender != t.poster) revert NotPoster();
        if (t.status != TaskStatus.Open) revert InvalidStatus();

        Bid storage b = bids[taskId][bidIndex];
        t.worker = b.bidder;
        t.status = TaskStatus.Assigned;

        workerTasks[b.bidder].push(taskId);

        emit WorkerAssigned(taskId, b.bidder);
    }

    // ─── Completion & Disputes ───────────────────────────────────────
    /**
     * @notice Mark task as completed (called by DeliverableVerifier after verification)
     * @param taskId Task ID
     */
    function markCompleted(uint256 taskId) external {
        Task storage t = tasks[taskId];
        if (t.id == 0) revert TaskNotFound();
        if (t.status != TaskStatus.Assigned) revert InvalidStatus();

        t.status = TaskStatus.Completed;
        emit TaskCompleted(taskId, t.worker);
    }

    /**
     * @notice Raise a dispute on a task
     * @param taskId Task ID
     */
    function raiseDispute(uint256 taskId) external {
        Task storage t = tasks[taskId];
        if (t.id == 0) revert TaskNotFound();
        if (msg.sender != t.poster && msg.sender != t.worker) revert NotPoster();
        if (t.status != TaskStatus.Assigned) revert InvalidStatus();

        t.status = TaskStatus.Disputed;
        emit TaskDisputed(taskId);
    }

    /**
     * @notice Cancel an open task and refund the poster
     * @param taskId Task ID
     */
    function cancelTask(uint256 taskId) external {
        Task storage t = tasks[taskId];
        if (t.id == 0) revert TaskNotFound();
        if (msg.sender != t.poster) revert NotPoster();
        if (t.status != TaskStatus.Open) revert InvalidStatus();

        t.status = TaskStatus.Cancelled;
        escrow.refund(taskId, t.poster);

        emit TaskCancelled(taskId);
    }

    // ─── Views ───────────────────────────────────────────────────────
    function getTask(uint256 taskId) external view returns (Task memory) {
        return tasks[taskId];
    }

    function getBids(uint256 taskId) external view returns (Bid[] memory) {
        return bids[taskId];
    }

    function getSubtaskIds(uint256 taskId) external view returns (uint256[] memory) {
        return tasks[taskId].subtaskIds;
    }

    function getPosterTasks(address poster) external view returns (uint256[] memory) {
        return posterTasks[poster];
    }

    function getWorkerTasks(address worker) external view returns (uint256[] memory) {
        return workerTasks[worker];
    }
}
