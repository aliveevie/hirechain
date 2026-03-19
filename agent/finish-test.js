/**
 * HireChain — Finish remaining steps, skip already-done ones
 */
const { publicClient, walletClient, account, CONTRACTS } = require('./config');
const { parseEther, formatEther, keccak256, toBytes } = require('viem');

const HireRegistryABI = require('./abi/HireRegistry.json');
const EscrowVaultABI = require('./abi/EscrowVault.json');
const DeliverableVerifierABI = require('./abi/DeliverableVerifier.json');
const ReputationLedgerABI = require('./abi/ReputationLedger.json');

const TASK_BUDGET = '0.0005';
const TX_LOG = [];
function logTx(name, hash) {
  const url = `https://sepolia.basescan.org/tx/${hash}`;
  TX_LOG.push({ name, hash, url });
  console.log(`  📝 ${name}: ${url}`);
}

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
  console.log('Checking current state...\n');

  // Check deliverable
  const verified = await read(CONTRACTS.deliverableVerifier, DeliverableVerifierABI, 'isVerified', [1n]);
  console.log(`Task #1 deliverable verified: ${verified}`);

  const escrowBal = await read(CONTRACTS.escrowVault, EscrowVaultABI, 'getBalance', [1n]);
  console.log(`Escrow balance: ${formatEther(escrowBal)} ETH`);

  // Check subtasks
  const subtasks = await read(CONTRACTS.hireRegistry, HireRegistryABI, 'getSubtaskIds', [1n]);
  console.log(`Subtasks: ${subtasks.length}`);

  // Check reputation
  try {
    const rep = await read(CONTRACTS.reputationLedger, ReputationLedgerABI, 'getReputation', [account.address]);
    console.log(`Reputation: ${rep.tasksCompleted} completed`);
    
    if (Number(rep.tasksCompleted) > 0) {
      console.log('\n✅ All steps already completed!');
      const score = await read(CONTRACTS.reputationLedger, ReputationLedgerABI, 'getScore', [account.address]);
      console.log(`Score: ${score}/1000`);
      console.log(`Total earned: ${formatEther(rep.totalEarned)} ETH`);
    } else {
      // Need to record reputation
      console.log('\nRecording reputation...');
      const { hash: h8 } = await write(
        CONTRACTS.reputationLedger,
        ReputationLedgerABI,
        'recordCompletion',
        [account.address, 1n, 3600n, parseEther(TASK_BUDGET)]
      );
      logTx('RecordCompletion', h8);
      
      const rep2 = await read(CONTRACTS.reputationLedger, ReputationLedgerABI, 'getReputation', [account.address]);
      const score = await read(CONTRACTS.reputationLedger, ReputationLedgerABI, 'getScore', [account.address]);
      console.log(`✅ Reputation: ${rep2.tasksCompleted} completed | Score: ${score}/1000`);
      console.log(`💰 Total earned: ${formatEther(rep2.totalEarned)} ETH`);
    }
  } catch(e) {
    console.log(`Reputation check error: ${e.message}`);
    // Try recording
    console.log('\nRecording reputation...');
    const { hash: h8 } = await write(
      CONTRACTS.reputationLedger,
      ReputationLedgerABI,
      'recordCompletion',
      [account.address, 1n, 3600n, parseEther(TASK_BUDGET)]
    );
    logTx('RecordCompletion', h8);
  }

  // If deliverable not verified, try approving it
  if (!verified) {
    console.log('\nDeliverable not verified yet, trying approveDeliverable...');
    const { hash } = await write(
      CONTRACTS.deliverableVerifier,
      DeliverableVerifierABI,
      'approveDeliverable',
      [1n]
    );
    logTx('ApproveDeliverable', hash);
  }

  const finalBalance = await publicClient.getBalance({ address: account.address });
  console.log(`\n💰 Final balance: ${formatEther(finalBalance)} ETH`);
  
  if (TX_LOG.length > 0) {
    console.log('\n📋 New transactions:');
    TX_LOG.forEach((tx, i) => console.log(`  ${i+1}. ${tx.name}: ${tx.url}`));
  }

  // Save complete results
  const fs = require('fs');
  const allTxs = [
    { name: 'PostTask', hash: '0x6f0742a5a86fd306beef766903d722f8361d71ec833d8e7c7bb55a88f27607b0' },
    { name: 'SetExpectedHash', hash: '0xa649ef880bc09adcd0ab75bccbd6d0ec4d7d028d948738a0b63bd26f4eb5865b' },
    { name: 'SubmitBid', hash: '0x8dcdfe991a704c5119baf95f5f98ea2d58004ef66e877b4ea419116ac1633ef1' },
    { name: 'AcceptBid', hash: '0x0dcd98f95ebc11a9d459246d3870d8f7585e07d2e14ded1ec4f655467a5c65bd' },
    { name: 'CreateSubtask', hash: '0x5210135398e8a77aa9842c26315995b536eeaa8eabfbe431972b5d4df91178b4' },
    ...TX_LOG,
  ];
  const results = {
    timestamp: new Date().toISOString(),
    network: 'base-sepolia',
    deployer: account.address,
    contracts: CONTRACTS,
    transactions: allTxs.map(t => ({ ...t, url: `https://sepolia.basescan.org/tx/${t.hash}` })),
  };
  fs.writeFileSync(__dirname + '/integration-results.json', JSON.stringify(results, null, 2));
  console.log('📄 Results saved.');
}

main().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
