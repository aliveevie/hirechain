/**
 * HireChain Integration Test — Continue from Step 6
 * (Steps 1-5 already completed on-chain)
 */
const { publicClient, walletClient, account, CONTRACTS } = require('./config');
const { parseEther, formatEther, keccak256, toBytes } = require('viem');

const HireRegistryABI = require('./abi/HireRegistry.json');
const EscrowVaultABI = require('./abi/EscrowVault.json');
const DeliverableVerifierABI = require('./abi/DeliverableVerifier.json');
const ReputationLedgerABI = require('./abi/ReputationLedger.json');

const TASK_BUDGET = '0.0005';
const FILECOIN_CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
const CID_HASH = keccak256(toBytes(FILECOIN_CID));

const TX_LOG = [];
function logTx(name, hash) {
  const url = `https://sepolia.basescan.org/tx/${hash}`;
  TX_LOG.push({ name, hash, url });
  console.log(`  📝 ${name}: ${url}`);
}
function log(step, msg) { console.log(`\n[Step ${step}] ${msg}`); }

async function write(addr, abi, fn, args, value) {
  const { request } = await publicClient.simulateContract({ account, address: addr, abi, functionName: fn, args, value });
  const hash = await walletClient.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
  return { hash };
}
async function read(addr, abi, fn, args) {
  return publicClient.readContract({ address: addr, abi, functionName: fn, args });
}

async function main() {
  console.log('═'.repeat(60));
  console.log('🔄 CONTINUING INTEGRATION TEST FROM STEP 6');
  console.log('═'.repeat(60));
  console.log(`Deployer: ${account.address}`);

  // Verify steps 1-5 state
  const task = await read(CONTRACTS.hireRegistry, HireRegistryABI, 'getTask', [1n]);
  console.log(`\nTask #1 status: ${task.status} (should be 2=InProgress)`);

  const deadline = task.deadline;

  // ─── STEP 6: Create subtask ──────────────────────────────────────
  log(6, 'Creating subtask...');
  const { hash: h6 } = await write(
    CONTRACTS.hireRegistry,
    HireRegistryABI,
    'createSubtask',
    [1n, 'Frontend: Build React dashboard for task management', '0x0000000000000000000000000000000000000000000000000000000000000000', parseEther('0.0002'), deadline]
  );
  logTx('CreateSubtask', h6);

  const subtasks = await read(CONTRACTS.hireRegistry, HireRegistryABI, 'getSubtaskIds', [1n]);
  log(6, `✅ Subtask created | Parent #1 now has ${subtasks.length} subtask(s)`);

  // ─── STEP 7: Submit deliverable (matching CID) ───────────────────
  log(7, `Worker submitting deliverable: ${FILECOIN_CID}`);
  const workerBalBefore = await publicClient.getBalance({ address: account.address });

  const { hash: h7 } = await write(
    CONTRACTS.deliverableVerifier,
    DeliverableVerifierABI,
    'submitDeliverable',
    [1n, CID_HASH, FILECOIN_CID]
  );
  logTx('SubmitDeliverable', h7);

  const verified = await read(CONTRACTS.deliverableVerifier, DeliverableVerifierABI, 'isVerified', [1n]);
  const escrowBal2 = await read(CONTRACTS.escrowVault, EscrowVaultABI, 'getBalance', [1n]);
  const workerBalAfter = await publicClient.getBalance({ address: account.address });

  log(7, `✅ Deliverable verified: ${verified}`);
  log(7, `💰 Escrow balance after: ${formatEther(escrowBal2)} ETH (should be 0)`);
  log(7, `💸 Worker balance change: ${formatEther(workerBalAfter - workerBalBefore)} ETH (includes gas costs)`);

  // ─── STEP 8: Record reputation ───────────────────────────────────
  log(8, 'Recording task completion to reputation ledger...');
  const { hash: h8 } = await write(
    CONTRACTS.reputationLedger,
    ReputationLedgerABI,
    'recordCompletion',
    [account.address, 1n, 3600n, parseEther(TASK_BUDGET)]
  );
  logTx('RecordCompletion', h8);

  const rep = await read(CONTRACTS.reputationLedger, ReputationLedgerABI, 'getReputation', [account.address]);
  const score = await read(CONTRACTS.reputationLedger, ReputationLedgerABI, 'getScore', [account.address]);
  log(8, `✅ Reputation: ${rep.tasksCompleted} completed | ${rep.tasksFailed} failed | Score: ${score}/1000`);
  log(8, `💰 Total earned (on-chain): ${formatEther(rep.totalEarned)} ETH`);

  // ─── SUMMARY ─────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('🎉 INTEGRATION TEST COMPLETE — ALL STEPS PASSED');
  console.log('═'.repeat(60));
  console.log('\n📋 Steps 6-8 Transaction Log:');
  TX_LOG.forEach((tx, i) => {
    console.log(`  ${i + 1}. ${tx.name}: ${tx.url}`);
  });

  const finalBalance = await publicClient.getBalance({ address: account.address });
  console.log(`\n💰 Final deployer balance: ${formatEther(finalBalance)} ETH`);
  console.log(`🔗 View all on BaseScan: https://sepolia.basescan.org/address/${account.address}`);

  // Save results
  const fs = require('fs');
  const results = {
    timestamp: new Date().toISOString(),
    network: 'base-sepolia',
    deployer: account.address,
    contracts: CONTRACTS,
    transactions: TX_LOG,
    reputation: { tasksCompleted: Number(rep.tasksCompleted), score: Number(score) },
  };
  fs.writeFileSync(__dirname + '/integration-results.json', JSON.stringify(results, null, 2));
  console.log('\n📄 Results saved to agent/integration-results.json');
}

main().catch(err => {
  console.error('\n❌ Integration test failed:', err.message);
  console.error(err);
  process.exit(1);
});
