/**
 * Filecoin Onchain Cloud agentic storage evidence.
 *
 * This repo's integration-test currently uses a deterministic CID string for
 * deliverables during the on-chain lifecycle. During local/offline runs,
 * we cannot upload to Filecoin without secrets and a working API endpoint.
 *
 * So we implement two modes:
 * - online (if upload URL + token env vars are present): attempt an upload and
 *   capture the API response into evidence.
 * - offline fallback: generate chain-grounded evidence from the CID used
 *   on-chain so the sponsor can still correlate storage intent and tx hashes.
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

async function maybeUploadToFilecoin({ cid }) {
  const uploadUrl = process.env.FILECOIN_ONCHAIN_CLOUD_UPLOAD_URL || '';
  const token = process.env.FILECOIN_ONCHAIN_CLOUD_TOKEN || '';

  if (!uploadUrl || !token) {
    return {
      uploadMode: 'offline-fallback',
      uploaded: false,
      apiResponse: null,
    };
  }

  // Best-effort: endpoint contract is unknown here, so we keep the request
  // generic and only store whatever comes back.
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ cid }),
  });

  const text = await res.text();
  let apiResponse = null;
  try {
    apiResponse = JSON.parse(text);
  } catch {
    apiResponse = { raw: text };
  }

  return {
    uploadMode: 'online-attempt',
    uploaded: res.ok,
    status: res.status,
    apiResponse,
  };
}

async function buildFilecoinEvidence({
  taskId,
  cid,
  cidHashHex,
  submitDeliverableTxHash,
  justification,
}) {
  const upload = await maybeUploadToFilecoin({ cid });

  // Deterministic "piece CID"-like value for evidence correlation.
  const pieceCidMock = keccak256(toBytes('filecoin-piece-mock:' + cid));

  const evidence = {
    type: 'filecoin-onchaincloud-storage-evidence',
    taskId: String(taskId),
    deliverable: {
      cid,
      cidHashHex,
      pieceCidMock,
    },
    submitDeliverableTxHash,
    justification: justification || 'Deliverable CID submitted for verifiable storage evidence',
    filecoin: upload,
    generatedAt: new Date().toISOString(),
  };

  return toJsonSafe(evidence);
}

module.exports = { buildFilecoinEvidence };

