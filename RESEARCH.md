# Parity — Protocol Research & Interfaces

This document summarizes the research and confirmed smart contract interfaces for **Moonwell** and **Morpho** lending/yield protocols on **Base Sepolia Testnet**.

> [!NOTE]
> Since Moonwell and Morpho do not maintain public deployments on Base Sepolia testnet, we deploy custom mock protocol contracts mimicking their Compound v2 and ERC-4626 designs to enable full end-to-end autonomous testing on Sepolia.

---

## 📍 Protocol Addresses

### Base Sepolia Testnet (Mocks)
These are the contract addresses deployed for the Base Sepolia Testnet and local fork simulations:

| Contract / Asset | Address | Role |
| :--- | :--- | :--- |
| **Native USDC** | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | Official Base Sepolia USDC gas token |
| **Mock Comptroller** | `0x6C19DF9bb8C05630A5405987b16EAEc2f2Eed4E9` | Moonwell Comptroller mock |
| **Mock mUSDC Market** | `0x02527E38AC89cf0324Ba597234Cf1bf95B125c16` | Moonwell mUSDC lending pool mock |
| **Mock Price Oracle** | `0x47BBbD68058Cb2Ccae91f13Fe3401E7b68478Ab0` | Price oracle mock ($1 USDC return) |
| **Mock Morpho Vault** | `0x06d092041995FE765872DCF85B67f82f8Fc4faff` | Morpho Moonwell Flagship vault mock |

### Base Mainnet (Production Reference)
These are the verified smart contract addresses on Base Mainnet:

| Contract / Asset | Address | Role |
| :--- | :--- | :--- |
| **Native USDC** | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Mainnet underlying asset |
| **Moonwell Comptroller** | `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C` | Entry point for Moonwell lending |
| **Moonwell mUSDC Market** | `0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22` | Moonwell supplied USDC token |
| **Morpho USDC Vault** | `0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca` | MetaMorpho flagship yield venue |

---

## 1. Moonwell Protocol Research (Base)

Moonwell is a lending protocol built on the **Compound V2** architecture. The main interaction points are the **Comptroller**, individual **mToken** contracts, and the **Price Oracle**.

### Interest Rate Curve & Risk Parameters (USDC Market)
- **Collateral Factor (Max LTV):** **80%** (`0.80 * 1e18` or `800000000000000000`).
- **Liquidation Threshold:** **80%** (matching the collateral factor under Compound architecture).
- **Liquidation Incentive:** **10%** (`1.10 * 1e18` or `1100000000000000000`). 
  - *Note:* Liquidators receive a 7% bonus, and 3% goes to the protocol reserve.
- **Kink Utilization:** **80%** (`0.80`).
  - Below Kink: Interest rates increase linearly at a lower slope.
  - Above Kink: Interest rates jump steeply to discourage full utilization and preserve withdrawal liquidity.

### Oracle Source & Pricing
- **Oracle Source:** Moonwell uses a custom Price Oracle wrapper around **Chainlink Price Feeds**.
- **USDC/USD Feed Address (Base Mainnet Reference):** `0x7e86d2673322E73f8e562308E20E30485547BC6B`.
- **Price Scaling:** 
  - Compound Price Oracles return prices scaled by `10 ** (36 - underlyingDecimals)`.
  - Since USDC has 6 decimals, the price returned by `getUnderlyingPrice` will be scaled by **$10^{30}$** (e.g., $1.00 USD is represented as `1000000000000000000000000000000`).

---

## 2. Morpho Moonwell Flagship USDC Vault

The secondary yield venue is the **Moonwell Flagship USDC** vault on **Morpho Blue**.
- **Contract Address (Base Mainnet Reference):** `0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca`.
- **Contract Type:** MetaMorpho Vault.
- **Standard:** Fully compliant with **ERC-4626**.
- **Yield Mechanism:** Single-sided USDC deposit that receives vault shares, automatically routing capital to selected Morpho Blue USDC borrow markets curated by B.Protocol and Block Analitica.

---

## 3. Exact Function Signatures to Call

To implement the vault looping and agent keeper logic, we will call these exact functions:

### A. Token Operations (`IERC20`)
- Approve spender (e.g., Comptroller or mToken):
  ```solidity
  function approve(address spender, uint256 value) external returns (bool);
  ```
- Check balance:
  ```solidity
  function balanceOf(address account) external view returns (uint256);
  ```

### B. Supplying & Borrowing on Moonwell (`IMToken` at `0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22`)
- Supply USDC (returns 0 on success):
  ```solidity
  function mint(uint256 mintAmount) external returns (uint256);
  ```
- Redeem/Withdraw USDC by specifying mToken amount (returns 0 on success):
  ```solidity
  function redeem(uint256 redeemTokens) external returns (uint256);
  ```
- Redeem/Withdraw USDC by specifying underlying USDC amount (returns 0 on success):
  ```solidity
  function redeemUnderlying(uint256 redeemAmount) external returns (uint256);
  ```
- Borrow USDC (returns 0 on success):
  ```solidity
  function borrow(uint256 borrowAmount) external returns (uint256);
  ```
- Repay Borrowed USDC (returns 0 on success):
  ```solidity
  function repayBorrow(uint256 repayAmount) external returns (uint256);
  ```
- Get Stored Borrow Balance (no gas cost, doesn't accrue interest):
  ```solidity
  function borrowBalanceStored(address account) external view returns (uint256);
  ```
- Get Current Borrow Balance (accrues interest, state-changing/costs gas):
  ```solidity
  function borrowBalanceCurrent(address account) external returns (uint256);
  ```
- Get Stored Exchange Rate:
  ```solidity
  function exchangeRateStored() external view returns (uint256);
  ```

### C. Collateral Activation (`IComptroller` at `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C`)
- Enter USDC market to use supplied USDC as collateral for borrowing:
  ```solidity
  function enterMarkets(address[] calldata mTokens) external returns (uint256[] memory);
  ```
- Check account liquidity (returns `(error, liquidity, shortfall)`):
  ```solidity
  function getAccountLiquidity(address account) external view returns (uint256, uint256, uint256);
  ```

### D. Oracle Pricing (`IPriceOracle` from `Comptroller.oracle()`)
- Query underlying price:
  ```solidity
  function getUnderlyingPrice(address mToken) external view returns (uint256);
  ```

### E. Secondary Venue Operations (`IERC4626` at `0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca`)
- Deposit USDC into Morpho vault:
  ```solidity
  function deposit(uint256 assets, address receiver) external returns (uint256 shares);
  ```
- Withdraw USDC from Morpho vault:
  ```solidity
  function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
  ```
- Query total assets in Morpho vault:
  ```solidity
  function totalAssets() external view returns (uint256);
  ```
