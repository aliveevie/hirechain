// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/EscrowVault.sol";
import "../src/HireRegistry.sol";
import "../src/DeliverableVerifier.sol";
import "../src/ReputationLedger.sol";
import "../src/DelegationModule.sol";

contract HireChainTest is Test {
    EscrowVault escrow;
    HireRegistry registry;
    DeliverableVerifier verifier;
    ReputationLedger reputation;
    DelegationModule delegation;

    address poster = makeAddr("poster");
    address worker = makeAddr("worker");
    address orchestrator = makeAddr("orchestrator");

    function setUp() public {
        escrow = new EscrowVault();
        registry = new HireRegistry(address(escrow));
        verifier = new DeliverableVerifier(address(escrow));
        reputation = new ReputationLedger();
        delegation = new DelegationModule();

        // Wire permissions
        escrow.setRegistry(address(registry));
        escrow.setVerifier(address(verifier));
        verifier.setRegistry(address(registry));
        reputation.authorizeCaller(address(registry));
        reputation.authorizeCaller(address(verifier));

        // Fund accounts
        vm.deal(poster, 10 ether);
        vm.deal(worker, 1 ether);
    }

    // ─── Task Lifecycle ──────────────────────────────────────────────
    function test_PostTask() public {
        vm.prank(poster);
        uint256 taskId = registry.postTask{value: 1 ether}(
            "Build a smart contract",
            keccak256("expected-cid"),
            block.timestamp + 7 days
        );

        assertEq(taskId, 1);
        assertEq(escrow.getBalance(taskId), 1 ether);

        HireRegistry.Task memory t = registry.getTask(taskId);
        assertEq(t.poster, poster);
        assertEq(t.budget, 1 ether);
        assertEq(uint256(t.status), uint256(HireRegistry.TaskStatus.Open));
    }

    function test_BidAndAccept() public {
        vm.prank(poster);
        uint256 taskId = registry.postTask{value: 1 ether}(
            "Build a smart contract",
            bytes32(0),
            block.timestamp + 7 days
        );

        // Worker submits bid
        vm.prank(worker);
        registry.submitBid(taskId, 0.8 ether, "I can do this in 3 days");

        HireRegistry.Bid[] memory taskBids = registry.getBids(taskId);
        assertEq(taskBids.length, 1);
        assertEq(taskBids[0].bidder, worker);

        // Poster accepts bid
        vm.prank(poster);
        registry.acceptBid(taskId, 0);

        HireRegistry.Task memory t = registry.getTask(taskId);
        assertEq(t.worker, worker);
        assertEq(uint256(t.status), uint256(HireRegistry.TaskStatus.Assigned));
    }

    function test_FullLifecycle() public {
        // 1. Post task
        vm.prank(poster);
        bytes32 expectedHash = keccak256(abi.encodePacked("QmTestCID123"));
        uint256 taskId = registry.postTask{value: 1 ether}(
            "Write documentation",
            expectedHash,
            block.timestamp + 7 days
        );

        // Set expected hash in verifier
        verifier.setExpectedHash(taskId, expectedHash);

        // 2. Worker bids
        vm.prank(worker);
        registry.submitBid(taskId, 1 ether, "Will deliver in 2 days");

        // 3. Poster accepts
        vm.prank(poster);
        registry.acceptBid(taskId, 0);

        // 4. Worker submits deliverable with matching CID
        uint256 workerBalBefore = worker.balance;
        vm.prank(worker);
        verifier.submitDeliverable(
            taskId,
            expectedHash,
            "QmTestCID123"
        );

        // 5. Verify: auto-verified because hash matches, funds released
        assertTrue(verifier.isVerified(taskId));
        assertEq(escrow.getBalance(taskId), 0);
        assertEq(worker.balance, workerBalBefore + 1 ether);
    }

    function test_CancelTask() public {
        vm.prank(poster);
        uint256 taskId = registry.postTask{value: 1 ether}(
            "Build something",
            bytes32(0),
            block.timestamp + 7 days
        );

        uint256 balBefore = poster.balance;
        vm.prank(poster);
        registry.cancelTask(taskId);

        assertEq(poster.balance, balBefore + 1 ether);
        HireRegistry.Task memory t = registry.getTask(taskId);
        assertEq(uint256(t.status), uint256(HireRegistry.TaskStatus.Cancelled));
    }

    // ─── Subtasks ────────────────────────────────────────────────────
    function test_CreateSubtask() public {
        vm.prank(poster);
        uint256 parentId = registry.postTask{value: 2 ether}(
            "Big project",
            bytes32(0),
            block.timestamp + 14 days
        );

        vm.prank(poster);
        uint256 subId = registry.createSubtask(
            parentId,
            "Frontend work",
            bytes32(0),
            1 ether,
            block.timestamp + 7 days
        );

        assertEq(subId, 2);
        uint256[] memory subs = registry.getSubtaskIds(parentId);
        assertEq(subs.length, 1);
        assertEq(subs[0], subId);

        HireRegistry.Task memory st = registry.getTask(subId);
        assertEq(st.parentTaskId, parentId);
    }

    // ─── Reputation ──────────────────────────────────────────────────
    function test_ReputationScore() public {
        // Record 3 completions
        reputation.authorizeCaller(address(this));

        reputation.recordCompletion(worker, 1, 3600, 1 ether);
        reputation.recordCompletion(worker, 2, 7200, 0.5 ether);
        reputation.recordCompletion(worker, 3, 1800, 2 ether);

        ReputationLedger.AgentReputation memory rep = reputation.getReputation(worker);
        assertEq(rep.tasksCompleted, 3);
        assertEq(rep.tasksFailed, 0);
        assertEq(rep.totalEarned, 3.5 ether);
        assertEq(rep.streak, 3);

        uint256 score = reputation.getScore(worker);
        // 100% completion = 600, streak 3*20=60, exp 3*10=30 = 690
        assertEq(score, 690);

        // Record a failure
        reputation.recordFailure(worker, 4);
        rep = reputation.getReputation(worker);
        assertEq(rep.tasksFailed, 1);
        assertEq(rep.streak, 0); // Reset

        score = reputation.getScore(worker);
        // 75% completion = 450, streak 0, exp 3*10=30 = 480
        assertEq(score, 480);
    }

    // ─── Delegation ──────────────────────────────────────────────────
    function test_DelegationLifecycle() public {
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = HireRegistry.submitBid.selector;
        selectors[1] = HireRegistry.postTask.selector;

        vm.prank(orchestrator);
        uint256 delId = delegation.issueDelegation(
            worker,
            1 ether,
            selectors,
            block.number + 1000,
            1 // taskId
        );

        assertEq(delId, 1);
        assertTrue(delegation.isActive(delId));
        assertEq(delegation.getRemainingBudget(delId), 1 ether);

        // Check valid action
        assertTrue(delegation.checkDelegation(delId, HireRegistry.submitBid.selector, 0.5 ether));

        // Check invalid selector
        assertFalse(delegation.checkDelegation(delId, HireRegistry.cancelTask.selector, 0.5 ether));

        // Check over-spend
        assertFalse(delegation.checkDelegation(delId, HireRegistry.submitBid.selector, 1.5 ether));

        // Record spend
        delegation.recordSpend(delId, 0.3 ether);
        assertEq(delegation.getRemainingBudget(delId), 0.7 ether);

        // Revoke
        vm.prank(orchestrator);
        delegation.revokeDelegation(delId);
        assertFalse(delegation.isActive(delId));
    }

    function test_DelegationExpiry() public {
        bytes4[] memory selectors = new bytes4[](0);

        vm.prank(orchestrator);
        uint256 delId = delegation.issueDelegation(
            worker,
            1 ether,
            selectors,
            block.number + 10,
            0
        );

        assertTrue(delegation.isActive(delId));

        // Roll past expiry
        vm.roll(block.number + 11);
        assertFalse(delegation.isActive(delId));
    }

    // ─── Dispute ─────────────────────────────────────────────────────
    function test_DeliverableMismatchDispute() public {
        vm.prank(poster);
        uint256 taskId = registry.postTask{value: 1 ether}(
            "Task with expected output",
            keccak256("expected"),
            block.timestamp + 7 days
        );

        verifier.setExpectedHash(taskId, keccak256("expected"));

        vm.prank(worker);
        registry.submitBid(taskId, 1 ether, "On it");

        vm.prank(poster);
        registry.acceptBid(taskId, 0);

        // Submit wrong CID
        vm.prank(worker);
        verifier.submitDeliverable(taskId, keccak256("wrong-cid"), "QmWrongCID");

        assertTrue(verifier.isDisputed(taskId));
        assertFalse(verifier.isVerified(taskId));
        // Funds still locked
        assertEq(escrow.getBalance(taskId), 1 ether);
    }

    // ─── Edge Cases ──────────────────────────────────────────────────
    function test_RevertWhen_PostTaskZeroBudget() public {
        vm.prank(poster);
        vm.expectRevert(HireRegistry.InsufficientBudget.selector);
        registry.postTask{value: 0}("No budget", bytes32(0), block.timestamp + 1 days);
    }

    function test_RevertWhen_PostTaskPastDeadline() public {
        vm.prank(poster);
        vm.expectRevert(HireRegistry.DeadlinePassed.selector);
        registry.postTask{value: 1 ether}("Past deadline", bytes32(0), block.timestamp - 1);
    }

    function test_RevertWhen_AcceptBidNotPoster() public {
        vm.prank(poster);
        uint256 taskId = registry.postTask{value: 1 ether}("Task", bytes32(0), block.timestamp + 1 days);

        vm.prank(worker);
        registry.submitBid(taskId, 1 ether, "Bid");

        vm.prank(worker);
        vm.expectRevert(HireRegistry.NotPoster.selector);
        registry.acceptBid(taskId, 0);
    }

    function test_RevertWhen_BidTooHigh() public {
        vm.prank(poster);
        uint256 taskId = registry.postTask{value: 1 ether}("Task", bytes32(0), block.timestamp + 1 days);

        vm.prank(worker);
        vm.expectRevert(HireRegistry.BidTooHigh.selector);
        registry.submitBid(taskId, 2 ether, "Too expensive");
    }
}
