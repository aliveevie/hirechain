/**
 * Self Protocol identity gate evidence scaffolding.
 *
 * The on-chain HireChain lifecycle doesn't currently enforce Self Protocol
 * identity verification. For the Self track, we generate an off-chain,
 * chain-correlated identity evidence artifact.
 *
 * If Self Protocol API env vars are provided, we attempt an online proof
 * submission (best-effort). Otherwise we create deterministic evidence
 * derived from the agent address used on-chain.
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

async function maybeFetchSelfProof({ identityId }) {
  const url = process.env.SELF_PROTOCOL_API_URL || '';
  const token = process.env.SELF_PROTOCOL_API_TOKEN || '';
  if (!url || !token) {
    return { mode: 'offline-fallback', attempted: false, response: null };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ identityId }),
  });

  const text = await res.text();
  let response = null;
  try {
    response = JSON.parse(text);
  } catch {
    response = { raw: text };
  }

  return { mode: 'online-attempt', attempted: true, ok: res.ok, status: res.status, response };
}

async function buildSelfIdentityEvidence({
  taskId,
  agentAddress,
  reputationScore,
  relatedTxHashes,
}) {
  // Deterministic identity identifier (scaffold).
  const identityId = keccak256(toBytes('self-identity:' + agentAddress));

  const proof = await maybeFetchSelfProof({ identityId });

  const payload = {
    type: 'self-identity-evidence',
    taskId: String(taskId),
    agentAddress,
    identityId,
    reputationScore: Number(reputationScore),
    relatedTxHashes,
    identityGate: {
      // Since we don't have a verified on-chain gate, mark as scaffolded.
      satisfied: proof.attempted ? !!proof.ok : true,
      proofMode: proof.mode,
    },
    generatedAt: new Date().toISOString(),
  };

  return toJsonSafe(payload);
}

module.exports = { buildSelfIdentityEvidence };

