/**
 * Locus x402 evidence scaffolding.
 *
 * This repo doesn't call Locus contracts directly today. For the Locus track,
 * we generate evidence that ties together:
 * - the delegated spend scope (maxSpendWei + allowedSelectors)
 * - the settlement step that actually released escrow (EscrowVault.Released)
 * - tx hashes that judges can verify on Base Sepolia
 *
 * The evidence is chain-bound by decoding on-chain events from the settlement tx.
 */

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

const EscrowVaultABI = require('./abi/EscrowVault.json');

function decodeEscrowReleasedEvent({ decodeEventLog, txReceipt }) {
  const releasedAbi = EscrowVaultABI.find((x) => x.type === 'event' && x.name === 'Released');
  if (!releasedAbi) throw new Error('Missing EscrowVault Released event ABI');

  for (const l of txReceipt.logs) {
    if (!l.address) continue;
    try {
      return decodeEventLog({
        abi: [releasedAbi],
        data: l.data,
        topics: l.topics,
      });
    } catch (_) {
      // continue scanning
    }
  }

  return null;
}

async function buildLocusX402Evidence({
  publicClient,
  settlementTxHash,
  taskId,
  delegator,
  delegate,
  maxSpendWei,
  allowedSelectors,
  justification,
}) {
  const { decodeEventLog } = require('viem');
  const txReceipt = await publicClient.getTransactionReceipt({ hash: settlementTxHash });
  const released = decodeEscrowReleasedEvent({ decodeEventLog, txReceipt });
  if (!released) throw new Error('Could not decode EscrowVault Released from settlement tx');

  const payload = {
    type: 'locus-x402-settlement-evidence',
    taskId: String(taskId),
    delegator,
    delegate,
    maxSpendWei: String(maxSpendWei),
    allowedSelectors: (allowedSelectors || []).map((s) => String(s)),
    justification: justification || 'HireChain delegated settlement with auditability',
    settlementTxHash,
    escrowRelease: {
      taskId: released.args.taskId?.toString?.() || String(released.args.taskId),
      worker: released.args.worker,
      amountWei: released.args.amount?.toString?.() || String(released.args.amount),
    },
    generatedAt: new Date().toISOString(),
    note: 'Chain-bound evidence decoded from EscrowVault.Released; used as x402-style audit receipt substitute.',
  };

  return toJsonSafe(payload);
}

module.exports = { buildLocusX402Evidence };

