/**
 * bond.credit evidence scaffolding.
 *
 * This repo's on-chain lifecycle already produces an agent credit-like score
 * via `ReputationLedger.getScore(address)`. For the bond.credit track, we
 * generate an off-chain evidence artifact that ties the on-chain outcome to
 * a credit-score update intent.
 *
 * If bond.credit API env vars are provided, we attempt an online update
 * (best-effort) and include the API response; otherwise we fall back to
 * offline evidence only.
 */

const { toBytes, keccak256 } = require('viem');

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

async function maybePushToBondCredit({ payload }) {
  const url = process.env.BONDCREDIT_API_URL || '';
  const token = process.env.BONDCREDIT_API_TOKEN || '';
  if (!url || !token) {
    return { pushed: false, response: null, mode: 'offline-fallback' };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let response = null;
  try {
    response = JSON.parse(text);
  } catch {
    response = { raw: text };
  }

  return { pushed: res.ok, response, mode: 'online-attempt', status: res.status };
}

async function buildBondCreditEvidence({
  taskId,
  agentAddress,
  reputationScore,
  creditModel,
  recordCompletionTxHash,
}) {
  const creditIntentId = keccak256(
    toBytes(`bondcredit-intent:${agentAddress}:${taskId}:${String(reputationScore)}`)
  );

  const payload = {
    type: 'bondcredit-credit-update-intent',
    intentId: creditIntentId,
    taskId: String(taskId),
    agentAddress,
    creditScore: Number(reputationScore),
    creditModel: creditModel || 'HireChain->ReputationLedger score mapping',
    correlatedTx: recordCompletionTxHash,
    generatedAt: new Date().toISOString(),
  };

  const api = await maybePushToBondCredit({ payload });

  return toJsonSafe({
    type: 'bondcredit-evidence',
    taskId: String(taskId),
    agentAddress,
    reputationScore: Number(reputationScore),
    creditModel: payload.creditModel,
    recordCompletionTxHash,
    creditIntentId: creditIntentId,
    push: api,
  });
}

module.exports = { buildBondCreditEvidence };

