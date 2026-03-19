/**
 * Base agent services discoverability evidence.
 *
 * For the Base track, we provide an off-chain "service manifest" that is
 * directly grounded in the on-chain lifecycle txs and contract addresses.
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

function buildBaseServiceManifest({
  taskId,
  network,
  serviceName,
  serviceCategory,
  deployedContracts,
  receiptArtifact,
  txLog,
}) {
  const txHashes = (txLog || []).map((t) => t.hash).filter(Boolean);

  const manifest = {
    type: 'base-agent-service-manifest',
    taskId: String(taskId),
    network: network || 'base-sepolia',
    service: {
      name: serviceName || 'HireChain Orchestrator',
      category: serviceCategory || 'agent-services',
      sponsorTrack: 'Agent Services on Base',
    },
    deployedContracts: {
      hireRegistry: deployedContracts.hireRegistry,
      escrowVault: deployedContracts.escrowVault,
      deliverableVerifier: deployedContracts.deliverableVerifier,
      reputationLedger: deployedContracts.reputationLedger,
      delegationModule: deployedContracts.delegationModule,
    },
    evidence: {
      erc8004Receipt: receiptArtifact
        ? {
            receiptId: receiptArtifact.receiptId,
            path: 'agent/erc8004-receipts/receipt-task-' + String(taskId) + '.json',
          }
        : null,
      txs: {
        count: txHashes.length,
        hashes: txHashes,
      },
    },
    generatedAt: new Date().toISOString(),
  };

  return toJsonSafe(manifest);
}

module.exports = { buildBaseServiceManifest };

