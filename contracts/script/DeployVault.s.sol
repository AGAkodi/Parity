// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ParityVault.sol";
import "../src/ParityKeeper.sol";

contract DeployVault is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address keeperWallet = vm.envOr("KEEPER_WALLET_ADDRESS", address(0x9999));

        // Base Sepolia / Mainnet configurations
        address assetAddress = vm.envOr("USDC_ADDRESS", address(0x036CbD53842c5426634e7929541eC2318f3dCF7e));
        address mUSDCAddress = vm.envOr("MOONWELL_MUSDC", address(0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22)); // fallback to mainnet fork value
        address comptrollerAddress = vm.envOr("MOONWELL_COMPTROLLER", address(0xfBb21d0380beE3312B33c4353c8936a0F13EF26C));

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy ParityVault
        ParityVault vault = new ParityVault(
            IERC20(assetAddress),
            IMToken(mUSDCAddress),
            IComptroller(comptrollerAddress),
            "Parity Vault",
            "prtUSDC"
        );

        // 2. Deploy ParityKeeper
        ParityKeeper keeper = new ParityKeeper(address(vault), keeperWallet);

        // 3. Authorize Keeper Contract on the Vault
        vault.setKeeper(address(keeper));

        console.log("ParityVault deployed at:", address(vault));
        console.log("ParityKeeper deployed at:", address(keeper));
        console.log("Keeper wallet configured as:", keeperWallet);

        vm.stopBroadcast();
    }
}
