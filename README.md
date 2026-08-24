# Parity

Parity is an autonomous leveraged yield optimization agent operating on Base Sepolia (or local fork). It maximizes USDC yield for depositors by automatically routing capital and managing leverage loops between Moonwell and Morpho, while enforcing deterministic risk limits and dual-model consensus reasoning.

---

## 📁 Repository Structure

The repository is structured as a monorepo containing the following components:

*   [`/contracts`](file:///c:/Users/User/Desktop/Gideon/parity/contracts): Foundry project containing the core Solidity smart contracts.
    *   `ParityVault.sol`: An ERC-4626 compliant vault that handles deposits, withdrawals, and leverages USDC yield via Moonwell and Morpho.
    *   `ParityKeeper.sol`: Access-controlled keeper contract that exposes administrative functions for rebalancing, deleveraging, and venue migration.
*   [`/agent`](file:///c:/Users/User/Desktop/Gideon/parity/agent): TypeScript Node.js autonomous agent that monitors yield and executes keeper transactions.
    *   `agent.ts`: Monitors health factors, APYs, utilization, and gas costs. Calls a dual-model LLM consensus layer (Model A: `openai/gpt-oss-20b` and Model B: `openai/gpt-oss-120b` via Groq) to agree on discretionary actions before submitting transactions.
    *   `simulate.ts`: Scenario-based integration testing suite running on local Anvil fork.

---

## 🚀 Getting Started

### Smart Contracts (Foundry)

Ensure you have [Foundry](https://book.getfoundry.sh/getting-started/installation) installed.

1. Navigate to the contracts directory:
   ```bash
   cd contracts
   ```
2. Build the smart contracts:
   ```bash
   forge build
   ```
3. Run unit tests:
   ```bash
   forge test
   ```

### Off-Chain Keeper Agent (Node.js/TypeScript)

Ensure you have [Node.js](https://nodejs.org/) installed.

1. Navigate to the agent directory:
   ```bash
   cd agent
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Compile the TypeScript codebase:
   ```bash
   npm run build
   ```
4. Run the local decision simulator (starts Anvil locally in another terminal first, or runs automatically in dry-run/mock mode):
   ```bash
   npm run simulate
   ```

---

## 🔒 Configuration

Copy the `.env.example` file to `.env` at the root of the repository and configure your private keys and RPC URLs:
```ini
BASE_SEPOLIA_RPC_URL=...
KEEPER_PRIVATE_KEY=...
GROQ_API_KEY=...
```
*(The real `.env` file containing secrets is automatically ignored by Git and will never be committed.)*
