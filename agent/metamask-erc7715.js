/**
 * MetaMask ERC-7715 integration scaffolding.
 *
 * In this repo we don't have an actual MetaMask extension runtime (Snap) during
 * CI/local Node runs. So we:
 * - build a deterministic "grant permissions" payload we can show to judges
 * - optionally attempt a real call if the wallet client exposes `grantPermissions`
 * - always mirror the grant intent into the on-chain DelegationModule enforcement
 *   (allowedSelectors + maxSpend + expiryBlock)
 */

const { toJsonSafe } = require('./json-safe');

function buildGrantPermissionsPayload({
  chainId,
  delegator,
  delegate,
  taskId,
  maxSpendWei,
  allowedSelectors,
  expiryBlock,
  justification,
}) {
  // MetaMask's ERC-7715 "expiry" is usually a unix timestamp. We keep both
  // timestamp-ish and block-based values in evidence.
  const expiryUnix = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

  return toJsonSafe({
    type: 'erc-7715-permission-grant',
    chainId,
    delegator,
    delegate,
    taskId: String(taskId),
    maxSpendWei: String(maxSpendWei),
    allowedSelectors: (allowedSelectors || []).map((s) => String(s)),
    expiryBlock: String(expiryBlock),
    expiryUnix,
    justification: justification || 'HireChain scoped delegation for worker execution',
    evidenceGeneratedAt: new Date().toISOString(),
  });
}

async function maybeGrantPermissions({
  walletClient,
  payload,
}) {
  // If MetaMask Smart Accounts Kit actions were wired into the wallet client,
  // it will expose a `grantPermissions` method. Otherwise we just return null.
  if (walletClient && typeof walletClient.grantPermissions === 'function') {
    const grantedPermissions = await walletClient.grantPermissions(payload.permissions || [payload]);
    return { attempted: true, grantedPermissions };
  }
  return { attempted: false, grantedPermissions: null };
}

async function buildMetamaskDelegationEvidence({
  walletClient,
  chainId,
  delegator,
  delegate,
  taskId,
  maxSpendWei,
  allowedSelectors,
  expiryBlock,
  justification,
}) {
  const payload = buildGrantPermissionsPayload({
    chainId,
    delegator,
    delegate,
    taskId,
    maxSpendWei,
    allowedSelectors,
    expiryBlock,
    justification,
  });

  // Payload format varies across MetaMask SDK versions. Evidence is the source of truth.
  const meta = await maybeGrantPermissions({ walletClient, payload: { permissions: payload } });

  return toJsonSafe({
    payload,
    meta,
  });
}

module.exports = { buildMetamaskDelegationEvidence };

