/**
 * ERC-8004-style receipt artifact generator.
 *
 * This repo doesn't yet write into the official ERC-8004 registries/contracts.
 * Instead, we generate receipt artifacts that are cryptographically bound to
 * on-chain events (tx hashes + decoded event args), so judges can verify
 * receipts are derived from immutable chain data.
 */

const { keccak256, toBytes } = require('viem');

const DeliverableVerifierABI = require('./abi/DeliverableVerifier.json');
const ReputationLedgerABI = require('./abi/ReputationLedger.json');

function getEventAbi(abi, name) {
  const eventAbi = abi.find((x) => x.type === 'event' && x.name === name);
  if (!eventAbi) throw new Error(`Missing event ABI: ${name}`);
  return eventAbi;
}

function toJsonSafe(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = toJsonSafe(v);
    return out;
  }
  return value;
}

function decodeReceiptEvent({ decodeEventLog, abiEvent, txReceipt }) {
  for (const l of txReceipt.logs) {
    if (!l.address) continue;
    try {
      return decodeEventLog({
        abi: [abiEvent],
        data: l.data,
        topics: l.topics,
      });
    } catch (_) {
      // ignore and continue
    }
  }
  return null;
}

async function generateErc8004ReceiptArtifact({
  publicClient,
  taskId,
  agentAddress,
  contractAddresses,
  txHashes,
  deliveryTimeSec,
  earnedEth,
  score,
  filecoinCid,
  cidHashHex,
}) {
  // Lazy import to keep node startup fast.
  const { decodeEventLog } = require('viem');

  const deliverableVerifierAddr = contractAddresses.deliverableVerifier.toLowerCase();
  const reputationLedgerAddr = contractAddresses.reputationLedger.toLowerCase();

  const completionTxHash = txHashes.recordCompletion;
  const deliverableTxHash = txHashes.submitDeliverable;

  const completionReceipt = await publicClient.getTransactionReceipt({ hash: completionTxHash });
  const deliverableReceipt = await publicClient.getTransactionReceipt({ hash: deliverableTxHash });

  const deliverableSubmittedAbi = getEventAbi(DeliverableVerifierABI, 'DeliverableSubmitted');
  const deliverableVerifiedAbi = getEventAbi(DeliverableVerifierABI, 'DeliverableVerified');
  const deliverableDisputedAbi = getEventAbi(DeliverableVerifierABI, 'DeliverableDisputed');
  const completionRecordedAbi = getEventAbi(ReputationLedgerABI, 'CompletionRecorded');

  // Decode deliverable events (best-effort: either verified or disputed).
  const deliveredEvent =
    decodeReceiptEvent({
      decodeEventLog,
      abiEvent: deliverableSubmittedAbi,
      txReceipt: deliverableReceipt,
    }) || null;

  // We prefer verified if present.
  let verifiedEvent =
    decodeReceiptEvent({
      decodeEventLog,
      abiEvent: deliverableVerifiedAbi,
      txReceipt: deliverableReceipt,
    }) || null;

  let disputedEvent =
    decodeReceiptEvent({
      decodeEventLog,
      abiEvent: deliverableDisputedAbi,
      txReceipt: deliverableReceipt,
    }) || null;

  // Decode completion recorded event.
  const completionEvent = decodeReceiptEvent({
    decodeEventLog,
    abiEvent: completionRecordedAbi,
    txReceipt: completionReceipt,
  });

  if (!deliveredEvent) {
    throw new Error('Could not decode DeliverableSubmitted from submitDeliverable tx');
  }
  if (!completionEvent) {
    throw new Error('Could not decode CompletionRecorded from recordCompletion tx');
  }

  const delivered = !!verifiedEvent && !disputedEvent;

  const receiptPayload = {
    receiptId: undefined, // filled below
    receiptType: 'erc-8004-style',
    taskId: BigInt(taskId).toString(),
    agent: agentAddress,
    delivered,
    filecoinCid,
    cidHash: cidHashHex,
    earnedEth,
    deliveryTimeSec: BigInt(deliveryTimeSec).toString(),
    score: BigInt(score).toString(),
    onchainProof: {
      deliverableVerifier: contractAddresses.deliverableVerifier,
      reputationLedger: contractAddresses.reputationLedger,
      txHashes: {
        submitDeliverable: txHashes.submitDeliverable,
        recordCompletion: txHashes.recordCompletion,
      },
      decodedEvents: {
        DeliverableSubmitted: deliveredEvent?.args || null,
        DeliverableVerified: verifiedEvent?.args || null,
        DeliverableDisputed: disputedEvent?.args || null,
        CompletionRecorded: completionEvent?.args || null,
      },
    },
    generatedAt: new Date().toISOString(),
  };

  // Bind receipt to immutable fields: taskId + tx hashes + cidHash.
  const receiptId = keccak256(
    toBytes(`${receiptPayload.taskId}:${txHashes.submitDeliverable}:${txHashes.recordCompletion}:${receiptPayload.cidHash}`)
  );
  receiptPayload.receiptId = receiptId;

  // Sanity checks to avoid accidental mismatches.
  const submittedTaskId = deliveredEvent.args.taskId?.toString?.() || String(deliveredEvent.args.taskId);
  if (submittedTaskId !== receiptPayload.taskId) {
    throw new Error(`Receipt taskId mismatch: expected ${receiptPayload.taskId}, got ${submittedTaskId}`);
  }

  return toJsonSafe(receiptPayload);
}

module.exports = { generateErc8004ReceiptArtifact };

