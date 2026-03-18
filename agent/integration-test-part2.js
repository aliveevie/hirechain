/**
 * HireChain Integration Test Part 2 — Steps 6-8
 * Continues from where part 1 left off (task #1 already posted, bid accepted, delegation issued)
 */
const { publicClient, walletClient, account, CONTRACTS } = require('./config');
const { parseEther, formatEther, keccak256, toBytes } = require('viem');

const HireRegistryABI = require('./abi/HireRegistry.json');
const EscrowVaultABI = require('./abi/EscrowVault.json');
const DeliverableVerifierABI = require('./abi/DeliverableVerifier.json');
const ReputationLedgerABI = require('./abi/ReputationLedger.json');
const DelegationModuleABI = require('./abi/DelegationModule.json');

const TX_LOG = [];
function log(step, msg) { console.log(`[${new Date().toISOString().slice(11,19)}] Step ${step}: ${msg}`); }
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

async function main() {
  console.log('\n🏗️  HireChain Integration Test — Part 2 (Steps 6-8)');
  console.log('═'.repeat(60));

  const TASK_BUDGET = '0.0005';
  const FILECOIN_CID = 'QmTestHireChainDeliverable2026';
  const CID_HASH = keccak256(toBytes(FILECOIN_CID));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400);

  // ─── STEP 6: Create subtask ──────────────────────────────────────
  log(6, 'Creating subtask...');
  const h6 = await walletClient.writeContract({
    address: CONTRACTS.hireRegistry,
    abi: HireRegistryABI,
    functionName: 'createSubtask',
    args: [1n, 'Frontend: Build React dashboard for task management', '0x0000000000000000000000000000000000000000000000000000000000000000', parseEther('0.0002'), deadline],
  });
  await waitTx(h6);
  logTx('CreateSubtask', h6);

  const subtasks = await publicClient.readContract({
    address: CONTRACTS.hireRegistry, abi: HireRegistryABI,
    functionName: 'getSubtaskIds', args: [1n],
  });
  log(6, `✅ Subtask created | Parent #1 has ${subtasks.length} subtask(s)`);

  // ─── STEP 7: Submit deliverable (matching CID → auto-verify + release) ─
  log(7, `Worker submitting deliverable: ${FILECOIN_CID}`);
  const h7 = await walletClient.writeContract({
    address: CONTRACTS.deliverableVerifier,
    abi: DeliverableVerifierABI,
    functionName: 'submitDeliverable',
    args: [1n, CID_HASH, FILECOIN_CID],
  });
  await waitTx(h7);
  logTx('SubmitDeliverable', h7);

  const verified = await publicClient.readContract({
    address: CONTRACTS.deliverableVerifier, abi: DeliverableVerifierABI,
    functionName: 'isVerified', args: [1n],
  });
  const escrowBal = await publicClient.readContract({
    address: CONTRACTS.escrowVault, abi: EscrowVaultABI,
    functionName: 'getBalance', args: [1n],
  });
  log(7, `✅ Verified: ${verified} | Escrow remaining: ${formatEther(escrowBal)} ETH`);

  // ─── STEP 8: Record reputation ───────────────────────────────────
  log(8, 'Recording completion to ReputationLedger...');
  const h8 = await walletClient.writeContract({
    address: CONTRACTS.reputationLedger,
    abi: ReputationLedgerABI,
    functionName: 'recordCompletion',
    args: [account.address, 1n, 3600n, parseEther(TASK_BUDGET)],
  });
  await waitTx(h8);
  logTx('RecordCompletion', h8);

  const rep = await publicClient.readContract({
    address: CONTRACTS.reputationLedger, abi: ReputationLedgerABI,
    functionName: 'getReputation', args: [account.address],
  });
  const score = await publicClient.readContract({
    address: CONTRACTS.reputationLedger, abi: ReputationLedgerABI,
    functionName: 'getScore', args: [account.address],
  });
  log(8, `✅ Reputation: ${rep.tasksCompleted} completed | Score: ${score}/1000`);
  log(8, `💰 Total earned on-chain: ${formatEther(rep.totalEarned)} ETH`);

  // ─── SUMMARY ─────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('🎉 ALL 8 STEPS COMPLETE!');
  console.log('═'.repeat(60));
  console.log('\n📋 Part 2 Transactions:');
  TX_LOG.forEach((tx, i) => console.log(`  ${i+1}. ${tx.name}: ${tx.url}`));

  const bal = await publicClient.getBalance({ address: account.address });
  console.log(`\n💰 Final balance: ${formatEther(bal)} ETH`);

  // Save
  const fs = require('fs');
  fs.writeFileSync(__dirname + '/integration-results-part2.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    transactions: TX_LOG,
    reputation: { tasksCompleted: Number(rep.tasksCompleted), score: Number(score) },
  }, null, 2));
}

main().catch(err => {
  console.error('❌ Failed:', err.message || err);
  process.exit(1);
});
