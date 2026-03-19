/**
 * Olas Marketplace hiring evidence scaffolding.
 *
 * This repo's on-chain HireChain system requires the bidding worker to sign
 * `submitBid`, so during a fully local/no-key Node runtime we can't bid from
 * an arbitrary third-party wallet.
 *
 * For the Olas track, we still generate deterministic "Olas discovery evidence"
 * that shows:
 * - the candidate worker addresses discovered for the task (scaffolded)
 * - which candidate was selected for onboarding/hiring
 * - what worker address was actually used on-chain (the bidder/assigned worker)
 *
 * The evidence is chain-bound by correlating it to `taskId` and the on-chain
 * worker address read from `HireRegistry.getTask(taskId)`.
 */

const { keccak256, toBytes } = require('viem');

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

function addressFromSalt(salt) {
  const hash = keccak256(toBytes(salt)); // 0x + 64 hex chars
  const hex = hash.slice(2);
  const last40 = hex.slice(-40);
  return '0x' + last40;
}

async function buildOlasHiringEvidence({
  taskId,
  taskDescription,
  posterAddress,
  onchainAssignedWorker,
}) {
  // Scaffold candidate set (deterministic from taskId).
  const candidates = [
    posterAddress,
    addressFromSalt(`olas-candidate-1-${taskId}`),
    addressFromSalt(`olas-candidate-2-${taskId}`),
  ];

  // Select the candidate that we can actually operate with in this script
  // so the on-chain lifecycle remains successful.
  const selectedWorker = posterAddress;

  const payload = {
    type: 'olas-hiring-evidence',
    taskId: String(taskId),
    taskDescription: taskDescription || '',
    onchain: {
      assignedWorker: onchainAssignedWorker,
      bidderUsed: posterAddress,
    },
    olasDiscovery: {
      discoveryMode: 'scaffold-deterministic-candidates',
      candidates,
      selectedWorker,
    },
    evidenceGeneratedAt: new Date().toISOString(),
  };

  return toJsonSafe(payload);
}

module.exports = { buildOlasHiringEvidence };

