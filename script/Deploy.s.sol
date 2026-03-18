// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/EscrowVault.sol";
import "../src/HireRegistry.sol";
import "../src/DeliverableVerifier.sol";
import "../src/ReputationLedger.sol";
import "../src/DelegationModule.sol";

contract DeployHireChain is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        // 1. Deploy EscrowVault first (no deps)
        EscrowVault escrow = new EscrowVault();
        console.log("EscrowVault:", address(escrow));

        // 2. Deploy HireRegistry (needs escrow)
        HireRegistry registry = new HireRegistry(address(escrow));
        console.log("HireRegistry:", address(registry));

        // 3. Deploy DeliverableVerifier (needs escrow)
        DeliverableVerifier verifier = new DeliverableVerifier(address(escrow));
        console.log("DeliverableVerifier:", address(verifier));

        // 4. Deploy ReputationLedger (no deps)
        ReputationLedger reputation = new ReputationLedger();
        console.log("ReputationLedger:", address(reputation));

        // 5. Deploy DelegationModule (no deps)
        DelegationModule delegation = new DelegationModule();
        console.log("DelegationModule:", address(delegation));

        // ─── Wire up permissions ─────────────────────────────────────
        // EscrowVault: authorize registry + verifier
        escrow.setRegistry(address(registry));
        escrow.setVerifier(address(verifier));

        // DeliverableVerifier: authorize registry
        verifier.setRegistry(address(registry));

        // ReputationLedger: authorize registry + verifier
        reputation.authorizeCaller(address(registry));
        reputation.authorizeCaller(address(verifier));

        vm.stopBroadcast();

        console.log("\n=== HireChain Deployed ===");
        console.log("Network: Base");
        console.log("EscrowVault:        ", address(escrow));
        console.log("HireRegistry:       ", address(registry));
        console.log("DeliverableVerifier:", address(verifier));
        console.log("ReputationLedger:   ", address(reputation));
        console.log("DelegationModule:   ", address(delegation));
    }
}
