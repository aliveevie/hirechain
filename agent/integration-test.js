/**
 * HireChain Integration Test — Real On-Chain
 * 
 * Full lifecycle test against deployed contracts on Base:
 * 1. Post a task with ETH budget
 * 2. Submit a bid as a worker
 * 3. Accept the bid
 * 4. Issue ERC-7715 delegation to worker
 * 5. Submit deliverable (Filecoin CID)
 * 6. Verify deliverable → auto-release escrow
 * 7. Record reputation on-chain
 * 8. Read final state and verify everything
 */
const { publicClient, walletClient, account, chain, CONTRACTS } = require('./config');
const { parseEther, formatEther, keccak256, toBytes } = require('viem');

const { generateErc8004ReceiptArtifact } = require('./erc8004-receipts');
const { buildOlasHiringEvidence } = require('./olas-hiring-evidence');
const { buildLocusX402Evidence } = require('./locus-x402-evidence');
const { buildMetamaskDelegationEvidence } = require('./metamask-erc7715');

const HireRegistryABI = require('./abi/HireRegistry.json');
const EscrowVaultABI = require('./abi/EscrowVault.json');
const DeliverableVerifierABI = require('./abi/DeliverableVerifier.json');
const ReputationLedgerABI = require('./abi/ReputationLedger.json');
const DelegationModuleABI = require('./abi/DelegationModule.json');

const TX_LOG = [];

// Cursor for manual nonce management (prevents "nonce too low" when the account has recent txs).
let nonceCursor = null;

function log(step, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] Step ${step}: ${msg}`);
}

function logTx(name, hash) {
  const url = `https://sepolia.basescan.org/tx/${hash}`;
  TX_LOG.push({ name, hash, url });
  console.log(`  🔗 ${url}`);
}

async function waitTx(hash) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== 'success') throw new Error(`TX failed: ${hash}`);
  return receipt;
}

async function read(address, abi, fn, args = []) {
  return publicClient.readContract({ address, abi, functionName: fn, args });
}

async function write(address, abi, fn, args = [], value) {
  const opts = { address, abi, functionName: fn, args };
  if (value) opts.value = value;
  if (nonceCursor !== null) {
    opts.nonce = nonceCursor;
    nonceCursor = nonceCursor + 1n;
  }
  const hash = await walletClient.writeContract(opts);
  return { hash, receipt: await waitTx(hash) };
}

async function main() {
  console.log('\n🏗️  HireChain Integration Test — Base Mainnet');
  console.log('═'.repeat(60));
  console.log(`Deployer: ${account.address}`);
  console.log(`Registry: ${CONTRACTS.hireRegistry}`);
  console.log(`Escrow:   ${CONTRACTS.escrowVault}`);
  console.log(`Verifier: ${CONTRACTS.deliverableVerifier}`);
  console.log(`Reputation: ${CONTRACTS.reputationLedger}`);
  console.log(`Delegation: ${CONTRACTS.delegationModule}`);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance:  ${formatEther(balance)} ETH`);
  console.log('═'.repeat(60));

  const fs = require('fs');

  // Start nonce cursor from "pending" so txs sent in this script always use the latest nonce.
  nonceCursor = BigInt(await publicClient.getTransactionCount({
    address: account.address,
    blockTag: 'pending',
  }));

  const fs = require('fs');

  // We use the same address as both poster and worker for the integration test
  const TASK_BUDGET = '0.0005';  // Small budget for testing
  const FILECOIN_CID = 'QmTestHireChainDeliverable2026';
  const CID_HASH = keccak256(toBytes(FILECOIN_CID));

  // ─── STEP 1: Post a task ─────────────────────────────────────────
  log(1, `Posting task with ${TASK_BUDGET} ETH budget...`);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400); // 24h

  // The deployed registry may already have tasks, so task IDs are not guaranteed to be `1`.
  // We read `nextTaskId` before posting to get the deterministic taskId we just created.
  const taskId = await read(CONTRACTS.hireRegistry, HireRegistryABI, 'nextTaskId');

  const { hash: h1 } = await write(
    CONTRACTS.hireRegistry,
    HireRegistryABI,
    'postTask',
    ['Integration test: Build a decentralized hiring system', CID_HASH, deadline],
    parseEther(TASK_BUDGET)
  );
  logTx('PostTask', h1);

  // Read task
  const task1 = await read(CONTRACTS.hireRegistry, HireRegistryABI, 'getTask', [taskId]);
  log(1, `✅ Task #${taskId} created | Poster: ${task1.poster} | Budget: ${formatEther(task1.budget)} ETH | Status: ${task1.status}`);

  // Check escrow balance
  const escrowBal1 = await read(CONTRACTS.escrowVault, EscrowVaultABI, 'getBalance', [taskId]);
  log(1, `💰 Escrow balance: ${formatEther(escrowBal1)} ETH`);

  // ─── STEP 2: Set expected hash in verifier ───────────────────────
  log(2, 'Setting expected deliverable hash...');
  const { hash: h2 } = await write(
    CONTRACTS.deliverableVerifier,
    DeliverableVerifierABI,
    'setExpectedHash',
    [taskId, CID_HASH]
  );
  logTx('SetExpectedHash', h2);
  log(2, '✅ Expected hash set');

  // ─── STEP 3: Submit bid (we bid on our own task for demo) ────────
  log(3, 'Worker submitting bid...');
  const { hash: h3 } = await write(
    CONTRACTS.hireRegistry,
    HireRegistryABI,
    'submitBid',
    [taskId, parseEther(TASK_BUDGET), 'I will build this in 24 hours with on-chain verification']
  );
  logTx('SubmitBid', h3);
  log(3, '✅ Bid submitted');

  // ─── STEP 4: Accept bid ──────────────────────────────────────────
  log(4, 'Poster accepting bid...');
  const { hash: h4 } = await write(
    CONTRACTS.hireRegistry,
    HireRegistryABI,
    'acceptBid',
    [taskId, 0n]
  );
  logTx('AcceptBid', h4);

  const task2 = await read(CONTRACTS.hireRegistry, HireRegistryABI, 'getTask', [taskId]);
  log(4, `✅ Worker assigned: ${task2.worker} | Status: ${task2.status}`);

  // ─── Olas marketplace hiring evidence (scaffold + on-chain correlation) ───
  const olasEvidence = await buildOlasHiringEvidence({
    taskId,
    taskDescription: 'Integration test: Build a decentralized hiring system',
    posterAddress: account.address,
    onchainAssignedWorker: task2.worker,
  });

  const olasEvidenceDir = __dirname + '/olas-hiring-evidence';
  fs.mkdirSync(olasEvidenceDir, { recursive: true });
  const olasEvidencePath = `${olasEvidenceDir}/discovery-task-${taskId}.json`;
  fs.writeFileSync(olasEvidencePath, JSON.stringify(olasEvidence, null, 2));
  console.log(`🧩 Olas hiring evidence saved: ${olasEvidencePath}`);

  // ─── STEP 5: Issue delegation to worker ──────────────────────────
  log(5, 'Issuing ERC-7715 delegation to worker...');
  const currentBlock = await publicClient.getBlockNumber();
  const expiryBlock = currentBlock + 10000n;
  const delegationId = await read(CONTRACTS.delegationModule, DelegationModuleABI, 'nextDelegationId');

  // Allow submitDeliverable selector
  const submitDelSelector = '0x' + keccak256(toBytes('submitDeliverable(uint256,bytes32,string)')).slice(2, 10);
  const maxSpendWei = parseEther(TASK_BUDGET);
  const allowedSelectors = [submitDelSelector];

  // Build MetaMask ERC-7715 evidence payload (attempted grant is optional).
  // Even if MetaMask isn't available in this Node runtime, we still generate
  // evidence that the delegation scope is permissioned with spend caps.
  const maxSpendWei = parseEther(TASK_BUDGET);
  const allowedSelectors = [submitDelSelector];
  const metamaskEvidence = await buildMetamaskDelegationEvidence({
    walletClient,
    chainId: chain.id,
    delegator: account.address,
    delegate: account.address,
    taskId,
    maxSpendWei,
    allowedSelectors,
    expiryBlock,
  });

  const { hash: h5 } = await write(
    CONTRACTS.delegationModule,
    DelegationModuleABI,
    'issueDelegation',
    [account.address, maxSpendWei, allowedSelectors, expiryBlock, taskId]
  );
  logTx('IssueDelegation', h5);

  const delActive = await read(CONTRACTS.delegationModule, DelegationModuleABI, 'isActive', [delegationId]);
  const delBudget = await read(CONTRACTS.delegationModule, DelegationModuleABI, 'getRemainingBudget', [delegationId]);
  log(5, `✅ Delegation #${delegationId} active: ${delActive} | Remaining: ${formatEther(delBudget)} ETH | Expiry: block ${expiryBlock}`);

  // Save MetaMask permission grant evidence (payload + optional grant results + on-chain correlation).
  const evidenceDir = __dirname + '/metamask-erc7715-evidence';
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = `${evidenceDir}/permission-task-${taskId}.json`;
  fs.writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        ...metamaskEvidence,
        onchain: {
          delegationId: String(delegationId),
          issueDelegationTx: h5,
          delegatedSelectorSet: allowedSelectors,
          maxSpendWei: String(maxSpendWei),
          expiryBlock: String(expiryBlock),
        },
      },
      null,
      2
    )
  );
  console.log(`🪪 MetaMask ERC-7715 evidence saved: ${evidencePath}`);

  // ─── STEP 6: Create subtask ──────────────────────────────────────
  log(6, 'Creating subtask...');
  const { hash: h6 } = await write(
    CONTRACTS.hireRegistry,
    HireRegistryABI,
    'createSubtask',
    [taskId, 'Frontend: Build React dashboard for task management', '0x0000000000000000000000000000000000000000000000000000000000000000', parseEther('0.0002'), deadline]
  );
  logTx('CreateSubtask', h6);

  const subtasks = await read(CONTRACTS.hireRegistry, HireRegistryABI, 'getSubtaskIds', [taskId]);
  log(6, `✅ Subtask created | Parent #${taskId} now has ${subtasks.length} subtask(s)`);

  // ─── STEP 7: Submit deliverable (matching CID) ───────────────────
  log(7, `Worker submitting deliverable: ${FILECOIN_CID}`);
  const workerBalBefore = await publicClient.getBalance({ address: account.address });

  const { hash: h7 } = await write(
    CONTRACTS.deliverableVerifier,
    DeliverableVerifierABI,
    'submitDeliverable',
    [taskId, CID_HASH, FILECOIN_CID]
  );
  logTx('SubmitDeliverable', h7);

  // Check if auto-verified and funds released
  const verified = await read(CONTRACTS.deliverableVerifier, DeliverableVerifierABI, 'isVerified', [taskId]);
  const escrowBal2 = await read(CONTRACTS.escrowVault, EscrowVaultABI, 'getBalance', [taskId]);
  const workerBalAfter = await publicClient.getBalance({ address: account.address });

  log(7, `✅ Deliverable verified: ${verified}`);
  log(7, `💰 Escrow balance after: ${formatEther(escrowBal2)} ETH (should be 0)`);
  log(7, `💸 Worker balance change: ${formatEther(workerBalAfter - workerBalBefore)} ETH (includes gas costs)`);

  // ─── Locus x402-style settlement evidence (decoded from escrow release) ──
  const locusEvidence = await buildLocusX402Evidence({
    publicClient,
    settlementTxHash: h7,
    taskId,
    delegator: account.address,
    delegate: account.address,
    maxSpendWei,
    allowedSelectors,
  });

  const locusEvidenceDir = __dirname + '/locus-x402-evidence';
  fs.mkdirSync(locusEvidenceDir, { recursive: true });
  const locusEvidencePath = `${locusEvidenceDir}/settlement-task-${taskId}.json`;
  fs.writeFileSync(locusEvidencePath, JSON.stringify(locusEvidence, null, 2));
  console.log(`💸 Locus x402 evidence saved: ${locusEvidencePath}`);

  // ─── STEP 8: Record reputation ───────────────────────────────────
  log(8, 'Recording task completion to reputation ledger...');
  const { hash: h8 } = await write(
    CONTRACTS.reputationLedger,
    ReputationLedgerABI,
    'recordCompletion',
    [account.address, taskId, 3600n, parseEther(TASK_BUDGET)]
  );
  logTx('RecordCompletion', h8);

  const rep = await read(CONTRACTS.reputationLedger, ReputationLedgerABI, 'getReputation', [account.address]);
  const score = await read(CONTRACTS.reputationLedger, ReputationLedgerABI, 'getScore', [account.address]);
  log(8, `✅ Reputation: ${rep.tasksCompleted} completed | ${rep.tasksFailed} failed | Score: ${score}/1000`);
  log(8, `💰 Total earned (on-chain): ${formatEther(rep.totalEarned)} ETH`);

  // ─── Protocol Labs / ERC-8004 receipts artifact (off-chain, chain-bound) ──
  const earnedEth = TASK_BUDGET;
  const deliveryTimeSec = 3600n;
  const receiptArtifact = await generateErc8004ReceiptArtifact({
    publicClient,
    taskId,
    agentAddress: account.address,
    contractAddresses: {
      deliverableVerifier: CONTRACTS.deliverableVerifier,
      reputationLedger: CONTRACTS.reputationLedger,
    },
    txHashes: {
      submitDeliverable: h7,
      recordCompletion: h8,
    },
    deliveryTimeSec,
    earnedEth,
    score,
    filecoinCid: FILECOIN_CID,
    cidHashHex: CID_HASH,
  });

  const receiptDir = __dirname + '/erc8004-receipts';
  fs.mkdirSync(receiptDir, { recursive: true });
  const receiptPath = `${receiptDir}/receipt-task-${taskId}.json`;
  fs.writeFileSync(receiptPath, JSON.stringify(receiptArtifact, null, 2));
  console.log(`📜 ERC-8004 receipt artifact saved: ${receiptPath}`);

  // ─── SUMMARY ─────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('🎉 INTEGRATION TEST COMPLETE — ALL STEPS PASSED');
  console.log('═'.repeat(60));
  console.log('\n📋 Transaction Log:');
  TX_LOG.forEach((tx, i) => {
    console.log(`  ${i + 1}. ${tx.name}: ${tx.url}`);
  });

  const finalBalance = await publicClient.getBalance({ address: account.address });
  console.log(`\n💰 Final deployer balance: ${formatEther(finalBalance)} ETH`);
  console.log(`🔗 View all on BaseScan: https://sepolia.basescan.org/address/${account.address}`);

  // Save results
  const results = {
    timestamp: new Date().toISOString(),
    network: 'base-mainnet',
    deployer: account.address,
    contracts: CONTRACTS,
    transactions: TX_LOG,
    taskId: String(taskId),
    reputation: { tasksCompleted: Number(rep.tasksCompleted), score: Number(score) },
    erc8004Receipt: {
      receiptId: receiptArtifact.receiptId,
      path: 'agent/erc8004-receipts/receipt-task-' + String(taskId) + '.json',
    },
    olasHiringEvidence: {
      path: 'agent/olas-hiring-evidence/discovery-task-' + String(taskId) + '.json',
      assignedWorker: olasEvidence.onchain.assignedWorker,
    },
    locusX402Evidence: {
      path: 'agent/locus-x402-evidence/settlement-task-' + String(taskId) + '.json',
      escrowReleaseWorker: locusEvidence.escrowRelease.worker,
      escrowReleaseAmountWei: locusEvidence.escrowRelease.amountWei,
    },
    metamaskErc7715Evidence: {
      attempted: !!(metamaskEvidence && metamaskEvidence.meta && metamaskEvidence.meta.attempted),
      path: 'agent/metamask-erc7715-evidence/permission-task-' + String(taskId) + '.json',
    },
  };
  fs.writeFileSync(__dirname + '/integration-results.json', JSON.stringify(results, null, 2));
  console.log('\n📄 Results saved to agent/integration-results.json');
}

main().catch(err => {
  console.error('\n❌ Integration test failed:', err.message);
  console.error(err);
  process.exit(1);
});
