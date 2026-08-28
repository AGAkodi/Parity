// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ParityVault.sol";
import "../src/ParityKeeper.sol";

contract DeployConservativeVault is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployerAddress = vm.addr(deployerPrivateKey);
        address keeperWallet = vm.envAddress("KEEPER_WALLET_ADDRESS");

        // Base Sepolia configurations
        address assetAddress = vm.envAddress("USDC_ADDRESS");
        address mUSDCAddress = vm.envAddress("MOONWELL_MUSDC");
        address comptrollerAddress = vm.envAddress("MOONWELL_COMPTROLLER");

        console.log("=== Resolved Deployment Addresses ===");
        console.log("Deployer Address:    ", deployerAddress);
        console.log("Keeper Wallet:       ", keeperWallet);
        console.log("USDC (Asset):        ", assetAddress);
        console.log("mUSDC (Moonwell):    ", mUSDCAddress);
        console.log("Comptroller:         ", comptrollerAddress);
        console.log("=====================================");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy ParityVault
        ParityVault vault = new ParityVault(
            IERC20(assetAddress),
            IMToken(mUSDCAddress),
            IComptroller(comptrollerAddress),
            "Parity Conservative Vault",
            "cprtUSDC"
        );

        // 2. Deploy ParityKeeper
        ParityKeeper keeper = new ParityKeeper(address(vault), keeperWallet);

        // 3. Authorize Keeper Contract on the Vault
        vault.setKeeper(address(keeper));

        console.log("Conservative ParityVault deployed at:", address(vault));
        console.log("Conservative ParityKeeper deployed at:", address(keeper));
        console.log("Keeper wallet configured as:", keeperWallet);

        vm.stopBroadcast();
    }
}
