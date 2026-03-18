/**
 * HireChain Orchestrator Agent
 * 
 * The off-chain brain that:
 * 1. Posts tasks on-chain via HireRegistry
 * 2. Decomposes tasks into subtasks
 * 3. Assigns workers and issues delegations
 * 4. Monitors deliverables and triggers verification
 * 5. Records reputation on completion
 */
const { publicClient, walletClient, account, CONTRACTS } = require('./config');
const { parseEther, formatEther, encodeFunctionData, keccak256, toBytes } = require('viem');

// Load ABIs
const HireRegistryABI = require('./abi/HireRegistry.json');
const EscrowVaultABI = require('./abi/EscrowVault.json');
const DeliverableVerifierABI = require('./abi/DeliverableVerifier.json');
const ReputationLedgerABI = require('./abi/ReputationLedger.json');
const DelegationModuleABI = require('./abi/DelegationModule.json');

class HireChainOrchestrator {
  constructor() {
    this.registry = CONTRACTS.hireRegistry;
    this.escrow = CONTRACTS.escrowVault;
    this.verifier = CONTRACTS.deliverableVerifier;
    this.reputation = CONTRACTS.reputationLedger;
    this.delegation = CONTRACTS.delegationModule;
  }

  // ─── Task Management ─────────────────────────────────────────────
  async postTask(description, budgetEth, deadlineSeconds, expectedCid = null) {
    const expectedHash = expectedCid
      ? keccak256(toBytes(expectedCid))
      : '0x0000000000000000000000000000000000000000000000000000000000000000';

    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);

    console.log(`📋 Posting task: "${description.slice(0, 50)}..." | Budget: ${budgetEth} ETH`);

    const hash = await walletClient.writeContract({
      address: this.registry,
      abi: HireRegistryABI,
      functionName: 'postTask',
      args: [description, expectedHash, deadline],
      value: parseEther(budgetEth),
    });

    console.log(`✅ Task posted! TX: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    // Parse TaskPosted event to get taskId
    const taskPostedLog = receipt.logs.find(l =>
      l.address.toLowerCase() === this.registry.toLowerCase()
    );

    console.log(`📍 Block: ${receipt.blockNumber} | Gas: ${receipt.gasUsed}`);
    return { hash, receipt };
  }

  async createSubtask(parentTaskId, description, budget, deadlineSeconds) {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);

    console.log(`  📎 Creating subtask under #${parentTaskId}: "${description.slice(0, 40)}..."`);

    const hash = await walletClient.writeContract({
      address: this.registry,
      abi: HireRegistryABI,
      functionName: 'createSubtask',
      args: [
        BigInt(parentTaskId),
        description,
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        parseEther(budget),
        deadline,
      ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ✅ Subtask created! TX: ${hash}`);
    return { hash, receipt };
  }

  // ─── Bidding ─────────────────────────────────────────────────────
  async submitBid(taskId, amountEth, proposal) {
    console.log(`🤝 Bidding on task #${taskId}: ${amountEth} ETH`);

    const hash = await walletClient.writeContract({
      address: this.registry,
      abi: HireRegistryABI,
      functionName: 'submitBid',
      args: [BigInt(taskId), parseEther(amountEth), proposal],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ Bid submitted! TX: ${hash}`);
    return { hash, receipt };
  }

  async acceptBid(taskId, bidIndex) {
    console.log(`✔️ Accepting bid #${bidIndex} on task #${taskId}`);

    const hash = await walletClient.writeContract({
      address: this.registry,
      abi: HireRegistryABI,
      functionName: 'acceptBid',
      args: [BigInt(taskId), BigInt(bidIndex)],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ Bid accepted! TX: ${hash}`);
    return { hash, receipt };
  }

  // ─── Deliverable Verification ────────────────────────────────────
  async setExpectedHash(taskId, cidString) {
    const cidHash = keccak256(toBytes(cidString));

    const hash = await walletClient.writeContract({
      address: this.verifier,
      abi: DeliverableVerifierABI,
      functionName: 'setExpectedHash',
      args: [BigInt(taskId), cidHash],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`🔒 Expected hash set for task #${taskId}`);
    return { hash, receipt };
  }

  async submitDeliverable(taskId, cidString) {
    const cidHash = keccak256(toBytes(cidString));
    console.log(`📦 Submitting deliverable for task #${taskId}: ${cidString}`);

    const hash = await walletClient.writeContract({
      address: this.verifier,
      abi: DeliverableVerifierABI,
      functionName: 'submitDeliverable',
      args: [BigInt(taskId), cidHash, cidString],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ Deliverable submitted! TX: ${hash}`);
    return { hash, receipt };
  }

  async approveDeliverable(taskId) {
    console.log(`👍 Manually approving deliverable for task #${taskId}`);

    const hash = await walletClient.writeContract({
      address: this.verifier,
      abi: DeliverableVerifierABI,
      functionName: 'approveDeliverable',
      args: [BigInt(taskId)],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ Deliverable approved! TX: ${hash}`);
    return { hash, receipt };
  }

  // ─── Delegation ──────────────────────────────────────────────────
  async issueDelegation(workerAddress, maxSpendEth, allowedSelectors, expiryBlocks, taskId) {
    const currentBlock = await publicClient.getBlockNumber();
    const expiryBlock = currentBlock + BigInt(expiryBlocks);

    console.log(`🔑 Issuing delegation to ${workerAddress} | Max: ${maxSpendEth} ETH | Expiry: block ${expiryBlock}`);

    const hash = await walletClient.writeContract({
      address: this.delegation,
      abi: DelegationModuleABI,
      functionName: 'issueDelegation',
      args: [workerAddress, parseEther(maxSpendEth), allowedSelectors, expiryBlock, BigInt(taskId)],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ Delegation issued! TX: ${hash}`);
    return { hash, receipt };
  }

  // ─── Reputation ──────────────────────────────────────────────────
  async recordCompletion(agentAddress, taskId, deliveryTimeSec, earnedEth) {
    console.log(`⭐ Recording completion for ${agentAddress} on task #${taskId}`);

    const hash = await walletClient.writeContract({
      address: this.reputation,
      abi: ReputationLedgerABI,
      functionName: 'recordCompletion',
      args: [agentAddress, BigInt(taskId), BigInt(deliveryTimeSec), parseEther(earnedEth)],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ Completion recorded! TX: ${hash}`);
    return { hash, receipt };
  }

  // ─── Read Functions ──────────────────────────────────────────────
  async getTask(taskId) {
    return publicClient.readContract({
      address: this.registry,
      abi: HireRegistryABI,
      functionName: 'getTask',
      args: [BigInt(taskId)],
    });
  }

  async getReputation(agentAddress) {
    return publicClient.readContract({
      address: this.reputation,
      abi: ReputationLedgerABI,
      functionName: 'getReputation',
      args: [agentAddress],
    });
  }

  async getScore(agentAddress) {
    return publicClient.readContract({
      address: this.reputation,
      abi: ReputationLedgerABI,
      functionName: 'getScore',
      args: [agentAddress],
    });
  }

  async getEscrowBalance(taskId) {
    return publicClient.readContract({
      address: this.escrow,
      abi: EscrowVaultABI,
      functionName: 'getBalance',
      args: [BigInt(taskId)],
    });
  }

  async isDeliverableVerified(taskId) {
    return publicClient.readContract({
      address: this.verifier,
      abi: DeliverableVerifierABI,
      functionName: 'isVerified',
      args: [BigInt(taskId)],
    });
  }
}

module.exports = { HireChainOrchestrator };
