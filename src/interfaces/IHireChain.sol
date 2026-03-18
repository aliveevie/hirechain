// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IEscrowVault {
    function deposit(uint256 taskId) external payable;
    function release(uint256 taskId, address worker, uint256 amount) external;
    function refund(uint256 taskId, address poster) external;
    function getBalance(uint256 taskId) external view returns (uint256);
}

interface IDeliverableVerifier {
    function submitDeliverable(uint256 taskId, bytes32 cidHash) external;
    function verifyAndRelease(uint256 taskId) external;
    function getDeliverable(uint256 taskId) external view returns (bytes32 cidHash, address worker, uint256 submittedAt, bool verified);
}

interface IReputationLedger {
    struct AgentReputation {
        uint256 tasksCompleted;
        uint256 tasksFailed;
        uint256 avgDeliveryTime;
        uint256 totalEarned;
        uint256 lastUpdated;
    }

    function recordCompletion(address agent, uint256 deliveryTime, uint256 earned) external;
    function recordFailure(address agent) external;
    function getReputation(address agent) external view returns (AgentReputation memory);
    function getScore(address agent) external view returns (uint256);
}

interface IDelegationModule {
    struct Delegation {
        address delegator;
        address delegate;
        uint256 maxSpend;
        bytes4[] allowedSelectors;
        uint256 expiryBlock;
        bool revoked;
    }

    function issueDelegation(address delegate, uint256 maxSpend, bytes4[] calldata allowedSelectors, uint256 expiryBlock) external returns (uint256 delegationId);
    function revokeDelegation(uint256 delegationId) external;
    function checkDelegation(uint256 delegationId, bytes4 selector, uint256 amount) external view returns (bool);
}
