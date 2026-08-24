# Parity — Environment & Protocol Setup

This document outlines the environment setup and protocol contract addresses for the **Parity** yield optimization engine.

---

## 🚀 Quick Start & Repo Structure

The repository has been structured as follows:
- [`/contracts`](file:///c:/Users/User/Desktop/Gideon/parity/contracts): Foundry project containing the ERC-4626 smart contracts (`ParityVault.sol`, `ParityKeeper.sol`, etc.).
- [`/agent`](file:///c:/Users/User/Desktop/Gideon/parity/agent): Node.js/TypeScript monitoring and auto-rebalancing service.
- [`/frontend`](file:///c:/Users/User/Desktop/Gideon/parity/frontend): Next.js web application for deposit/withdraw/monitoring UI.

---

## 🌐 Network Strategy: Base Mainnet Forking (Recommended)

While Base Sepolia testnet is supported, it is highly recommended to run tests and demo the agent using a **Base Mainnet Fork** because:
1. **Guaranteed Liquidity:** Testnet markets often lack sufficient mock USDC liquidity or suffer from stale oracle prices.
2. **Accurate Yield Curves:** Interest rate slopes (utilization, kink, borrow rate calculations) reflect real-world dynamics.
3. **No Faucet Hassles:** You can impersonate any rich USDC holder or mint tokens locally within the fork using Foundry's `vm.deal` and `vm.prank`.

### Running a Local Mainnet Fork via Anvil:
To start a local development node that forks Base Mainnet:
```bash
anvil --fork-url <YOUR_BASE_MAINNET_RPC_URL>
```

---

## 📍 Protocol Addresses (Base Mainnet)

These are the verified smart contract addresses on Base Mainnet to target for our local fork simulations and mainnet deployments:

| Contract / Asset | Address | Role |
| :--- | :--- | :--- |
| **Native USDC** | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Underlying asset for the vault |
| **Moonwell Comptroller** | `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C` | Entry point for Moonwell lending markets |
| **Moonwell mUSDC Market** | `0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22` | Token representing supplied USDC in Moonwell |
| **Morpho Moonwell Flagship USDC Vault** | `0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca` | Secondary yield venue for migration logic |

---

## 🚰 Testnet Faucets (Base Sepolia)

If deploying to the live Base Sepolia testnet, use the following resources to get tokens:

### 1. Gas Token (Base Sepolia ETH)
- **Coinbase Developer Platform Faucet:** [faucets.coinbase.com](https://faucets.coinbase.com/) (Recommended, supports daily claims)
- **QuickNode Faucet:** [faucet.quicknode.com/base/sepolia](https://faucet.quicknode.com/base/sepolia)
- **Alchemy Faucet:** [basefaucet.com](https://www.basefaucet.com/)

### 2. Base Sepolia Testnet USDC
- **Circle Sandbox Faucet:** [faucet.circle.com](https://faucet.circle.com/) (Select "USDC" and "Base Sepolia" network)
- **Base Sepolia USDC Token Address:** `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

---

## 🔑 Environment Variables (`.env`)

A `.env` file has been created in the workspace root. Configure it with your RPC URLs and private keys:

```ini
# RPC URLs
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_MAINNET_RPC_URL=https://mainnet.base.org

# Private Keys (Separate for security)
DEPLOYER_PRIVATE_KEY=0x...
KEEPER_PRIVATE_KEY=0x...

# Block Explorer Verification
ETHERSCAN_API_KEY=your_basescan_api_key_here
```
