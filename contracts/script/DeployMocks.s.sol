// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../test/mocks/MockProtocol.sol";

contract DeployMocks is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployerAddress = vm.addr(deployerPrivateKey);
        vm.deal(deployerAddress, 10 ether);

        address usdcAddress = vm.envOr("USDC_ADDRESS", address(0x036CbD53842c5426634e7929541eC2318f3dCF7e));

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Moonwell Mock Comptroller
        MockComptroller comptroller = new MockComptroller();
        console.log("MockComptroller deployed at:", address(comptroller));

        // 2. Deploy Moonwell Mock mUSDC Market
        MockMToken mUSDC = new MockMToken(usdcAddress);
        console.log("MockMToken (mUSDC) deployed at:", address(mUSDC));

        // 3. Deploy Moonwell Mock Price Oracle
        MockOracle oracle = new MockOracle();
        console.log("MockOracle deployed at:", address(oracle));

        // 4. Deploy Mock Morpho Flagship USDC Vault
        MockMorphoVault morphoVault = new MockMorphoVault(usdcAddress);
        console.log("MockMorphoVault deployed at:", address(morphoVault));

        // 5. Configure mock protocol parameters
        comptroller.setOracle(address(oracle));
        comptroller.setMToken(address(mUSDC));
        comptroller.setCollateralFactor(address(mUSDC), 0.8 * 1e18); // 80% collateral factor

        // Set oracle price for mUSDC ($1.00 scaled to 30 decimals for Compound v2 Oracle)
        oracle.setPrice(address(mUSDC), 1e30);

        console.log("Mocks configured successfully!");

        vm.stopBroadcast();
    }
}
