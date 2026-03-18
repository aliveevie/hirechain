// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ReputationLedger
 * @notice On-chain reputation system for HireChain agents. Every task completion/failure
 *         is permanently recorded, feeding into ERC-8004 identity and bond.credit scores.
 * @dev Reputation is immutable history — scores are derived, not stored.
 */
contract ReputationLedger {
    // ─── Types ───────────────────────────────────────────────────────
    struct AgentReputation {
        uint256 tasksCompleted;
        uint256 tasksFailed;
        uint256 totalDeliveryTime;   // Cumulative seconds across all tasks
        uint256 totalEarned;         // Cumulative wei earned
        uint256 lastUpdated;
        uint256 streak;              // Consecutive completions
        uint256 bestStreak;
    }

    struct ReputationEvent {
        uint256 taskId;
        bool completed;              // true = success, false = failure
        uint256 deliveryTime;        // Seconds to deliver (0 if failed)
        uint256 earned;              // Wei earned (0 if failed)
        uint256 timestamp;
    }

    // ─── State ───────────────────────────────────────────────────────
    address public owner;
    mapping(address => bool) public authorizedCallers; // Registry + Verifier

    mapping(address => AgentReputation) public reputations;
    mapping(address => ReputationEvent[]) public history;

    // ─── Events ──────────────────────────────────────────────────────
    event CompletionRecorded(address indexed agent, uint256 indexed taskId, uint256 deliveryTime, uint256 earned, uint256 newScore);
    event FailureRecorded(address indexed agent, uint256 indexed taskId, uint256 newScore);
    event CallerAuthorized(address indexed caller);
    event CallerRevoked(address indexed caller);

    // ─── Errors ──────────────────────────────────────────────────────
    error OnlyOwner();
    error OnlyAuthorized();

    // ─── Constructor ─────────────────────────────────────────────────
    constructor() {
        owner = msg.sender;
    }

    function authorizeCaller(address caller) external {
        if (msg.sender != owner) revert OnlyOwner();
        authorizedCallers[caller] = true;
        emit CallerAuthorized(caller);
    }

    function revokeCaller(address caller) external {
        if (msg.sender != owner) revert OnlyOwner();
        authorizedCallers[caller] = false;
        emit CallerRevoked(caller);
    }

    // ─── Recording ───────────────────────────────────────────────────
    /**
     * @notice Record a successful task completion
     * @param agent Worker agent address
     * @param taskId Task ID completed
     * @param deliveryTime Seconds taken to complete
     * @param earned Wei earned for this task
     */
    function recordCompletion(
        address agent,
        uint256 taskId,
        uint256 deliveryTime,
        uint256 earned
    ) external {
        if (!authorizedCallers[msg.sender]) revert OnlyAuthorized();

        AgentReputation storage rep = reputations[agent];
        rep.tasksCompleted++;
        rep.totalDeliveryTime += deliveryTime;
        rep.totalEarned += earned;
        rep.lastUpdated = block.timestamp;
        rep.streak++;
        if (rep.streak > rep.bestStreak) {
            rep.bestStreak = rep.streak;
        }

        history[agent].push(ReputationEvent({
            taskId: taskId,
            completed: true,
            deliveryTime: deliveryTime,
            earned: earned,
            timestamp: block.timestamp
        }));

        uint256 score = getScore(agent);
        emit CompletionRecorded(agent, taskId, deliveryTime, earned, score);
    }

    /**
     * @notice Record a task failure
     * @param agent Worker agent address
     * @param taskId Task ID failed
     */
    function recordFailure(address agent, uint256 taskId) external {
        if (!authorizedCallers[msg.sender]) revert OnlyAuthorized();

        AgentReputation storage rep = reputations[agent];
        rep.tasksFailed++;
        rep.lastUpdated = block.timestamp;
        rep.streak = 0; // Reset streak

        history[agent].push(ReputationEvent({
            taskId: taskId,
            completed: false,
            deliveryTime: 0,
            earned: 0,
            timestamp: block.timestamp
        }));

        uint256 score = getScore(agent);
        emit FailureRecorded(agent, taskId, score);
    }

    // ─── Views ───────────────────────────────────────────────────────
    /**
     * @notice Calculate agent's reputation score (0-1000)
     * @dev Score = (completionRate * 600) + (streakBonus * 200) + (experienceBonus * 200)
     *      - completionRate: completed / total * 600
     *      - streakBonus: min(currentStreak * 20, 200)
     *      - experienceBonus: min(tasksCompleted * 10, 200)
     */
    function getScore(address agent) public view returns (uint256) {
        AgentReputation storage rep = reputations[agent];
        uint256 total = rep.tasksCompleted + rep.tasksFailed;

        if (total == 0) return 0;

        // Completion rate component (max 600)
        uint256 completionScore = (rep.tasksCompleted * 600) / total;

        // Streak bonus (max 200)
        uint256 streakBonus = rep.streak * 20;
        if (streakBonus > 200) streakBonus = 200;

        // Experience bonus (max 200)
        uint256 expBonus = rep.tasksCompleted * 10;
        if (expBonus > 200) expBonus = 200;

        return completionScore + streakBonus + expBonus;
    }

    function getReputation(address agent) external view returns (AgentReputation memory) {
        return reputations[agent];
    }

    function getAvgDeliveryTime(address agent) external view returns (uint256) {
        AgentReputation storage rep = reputations[agent];
        if (rep.tasksCompleted == 0) return 0;
        return rep.totalDeliveryTime / rep.tasksCompleted;
    }

    function getHistory(address agent) external view returns (ReputationEvent[] memory) {
        return history[agent];
    }

    function getHistoryLength(address agent) external view returns (uint256) {
        return history[agent].length;
    }
}
