// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title DelegationModule
 * @notice Implements ERC-7715 style sub-delegations for the HireChain labor market.
 *         Orchestrator holds master delegation from human wallet and issues scoped
 *         sub-delegations to each worker agent with spend caps and selector whitelists.
 */
contract DelegationModule {
    // ─── Types ───────────────────────────────────────────────────────
    struct Delegation {
        address delegator;          // Who issued this delegation
        address delegate;           // Who receives the delegation
        uint256 maxSpend;           // Maximum wei the delegate can spend
        uint256 spent;              // Wei already spent under this delegation
        bytes4[] allowedSelectors;  // Function selectors the delegate can call
        uint256 expiryBlock;        // Block number after which delegation expires
        uint256 taskId;             // Associated task (0 for master delegations)
        bool revoked;
        uint256 createdAt;
    }

    // ─── State ───────────────────────────────────────────────────────
    uint256 public nextDelegationId = 1;
    mapping(uint256 => Delegation) public delegations;
    mapping(address => uint256[]) public delegatorDelegations;  // delegator => ids
    mapping(address => uint256[]) public delegateDelegations;   // delegate => ids
    mapping(address => mapping(address => uint256)) public activeDelegation; // delegator => delegate => id

    // ─── Events ──────────────────────────────────────────────────────
    event DelegationIssued(
        uint256 indexed delegationId,
        address indexed delegator,
        address indexed delegate,
        uint256 maxSpend,
        uint256 expiryBlock,
        uint256 taskId
    );
    event DelegationRevoked(uint256 indexed delegationId);
    event DelegationSpent(uint256 indexed delegationId, uint256 amount, uint256 totalSpent);

    // ─── Errors ──────────────────────────────────────────────────────
    error NotDelegator();
    error DelegationExpired();
    error DelegationRevoked_();
    error SpendCapExceeded();
    error SelectorNotAllowed();
    error DelegationNotFound();
    error InvalidDelegate();

    // ─── Core ────────────────────────────────────────────────────────
    /**
     * @notice Issue a scoped sub-delegation to a worker agent
     * @param delegate Worker agent address
     * @param maxSpend Maximum wei the worker can spend
     * @param allowedSelectors Function selectors the worker can call
     * @param expiryBlock Block after which this delegation expires
     * @param taskId Associated task ID (0 for master delegations)
     */
    function issueDelegation(
        address delegate,
        uint256 maxSpend,
        bytes4[] calldata allowedSelectors,
        uint256 expiryBlock,
        uint256 taskId
    ) external returns (uint256 delegationId) {
        if (delegate == address(0)) revert InvalidDelegate();

        delegationId = nextDelegationId++;

        Delegation storage d = delegations[delegationId];
        d.delegator = msg.sender;
        d.delegate = delegate;
        d.maxSpend = maxSpend;
        d.allowedSelectors = allowedSelectors;
        d.expiryBlock = expiryBlock;
        d.taskId = taskId;
        d.createdAt = block.timestamp;

        delegatorDelegations[msg.sender].push(delegationId);
        delegateDelegations[delegate].push(delegationId);
        activeDelegation[msg.sender][delegate] = delegationId;

        emit DelegationIssued(delegationId, msg.sender, delegate, maxSpend, expiryBlock, taskId);
    }

    /**
     * @notice Revoke a delegation (only delegator can revoke)
     * @param delegationId The delegation to revoke
     */
    function revokeDelegation(uint256 delegationId) external {
        Delegation storage d = delegations[delegationId];
        if (d.delegator == address(0)) revert DelegationNotFound();
        if (msg.sender != d.delegator) revert NotDelegator();

        d.revoked = true;
        activeDelegation[msg.sender][d.delegate] = 0;

        emit DelegationRevoked(delegationId);
    }

    /**
     * @notice Record spend against a delegation (called by authorized contracts)
     * @param delegationId The delegation ID
     * @param amount Amount being spent
     */
    function recordSpend(uint256 delegationId, uint256 amount) external {
        Delegation storage d = delegations[delegationId];
        if (d.delegator == address(0)) revert DelegationNotFound();
        if (d.revoked) revert DelegationRevoked_();
        if (block.number > d.expiryBlock) revert DelegationExpired();
        if (d.spent + amount > d.maxSpend) revert SpendCapExceeded();

        d.spent += amount;

        emit DelegationSpent(delegationId, amount, d.spent);
    }

    // ─── Validation ──────────────────────────────────────────────────
    /**
     * @notice Check if a delegation is valid for a given action
     * @param delegationId The delegation ID
     * @param selector Function selector being called
     * @param amount Amount being spent
     * @return valid Whether the action is allowed
     */
    function checkDelegation(
        uint256 delegationId,
        bytes4 selector,
        uint256 amount
    ) external view returns (bool valid) {
        Delegation storage d = delegations[delegationId];

        if (d.delegator == address(0)) return false;
        if (d.revoked) return false;
        if (block.number > d.expiryBlock) return false;
        if (d.spent + amount > d.maxSpend) return false;

        // Check selector whitelist
        bool selectorAllowed = d.allowedSelectors.length == 0; // Empty = allow all
        for (uint256 i = 0; i < d.allowedSelectors.length; i++) {
            if (d.allowedSelectors[i] == selector) {
                selectorAllowed = true;
                break;
            }
        }

        return selectorAllowed;
    }

    // ─── Views ───────────────────────────────────────────────────────
    function getDelegation(uint256 delegationId) external view returns (Delegation memory) {
        return delegations[delegationId];
    }

    function getDelegatorDelegations(address delegator) external view returns (uint256[] memory) {
        return delegatorDelegations[delegator];
    }

    function getDelegateDelegations(address delegate) external view returns (uint256[] memory) {
        return delegateDelegations[delegate];
    }

    function getRemainingBudget(uint256 delegationId) external view returns (uint256) {
        Delegation storage d = delegations[delegationId];
        if (d.spent >= d.maxSpend) return 0;
        return d.maxSpend - d.spent;
    }

    function isActive(uint256 delegationId) external view returns (bool) {
        Delegation storage d = delegations[delegationId];
        return d.delegator != address(0) && !d.revoked && block.number <= d.expiryBlock;
    }
}
