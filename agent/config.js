require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { createPublicClient, createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { base, baseSepolia } = require('viem/chains');

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const USE_TESTNET = process.env.USE_TESTNET === 'true';

const chain = USE_TESTNET ? baseSepolia : base;
const rpcUrl = USE_TESTNET
  ? (process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')
  : (process.env.BASE_RPC_URL || 'https://mainnet.base.org');

const account = privateKeyToAccount(PRIVATE_KEY);

const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl, { timeout: 60000 }),
});

const walletClient = createWalletClient({
  account,
  chain,
  transport: http(rpcUrl, { timeout: 60000 }),
});

// Contract addresses — filled after deployment
const CONTRACTS = {
  escrowVault: process.env.ESCROW_VAULT || '',
  hireRegistry: process.env.HIRE_REGISTRY || '',
  deliverableVerifier: process.env.DELIVERABLE_VERIFIER || '',
  reputationLedger: process.env.REPUTATION_LEDGER || '',
  delegationModule: process.env.DELEGATION_MODULE || '',
};

module.exports = { account, publicClient, walletClient, chain, CONTRACTS, PRIVATE_KEY };
