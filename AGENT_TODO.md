# Parity — Agent Layer TODO

Scope: the off-chain autonomous agent that reads market conditions and calls `ParityKeeper.sol` (`rebalance`, `deleverage`, `migrate`) without human approval per transaction.

Stack: **Coinbase AgentKit** (TypeScript) — wallet, signing, and Moonwell/Morpho data-reading handled by AgentKit; decision logic is custom.

Depends on: `ParityVault.sol` + `ParityKeeper.sol` already deployed to Base Sepolia (see main `TODO.md`).

---

## 0. Setup
- [x] Create `/agent` directory in the repo, separate Node project (`npm create onchain-agent@latest` or manual `package.json`)
- [x] Install `@coinbase/agentkit` (and langchain or whatever framework wrapper you want on top, if any)
- [x] Get CDP API key + secret (if using `CdpEvmWalletProvider`) — or generate a plain EOA private key if using `EthAccountWalletProvider` instead (simpler for a hackathon, no CDP account dependency)
- [x] Decide: CDP-managed wallet vs raw EOA wallet for the keeper. Raw EOA is faster to set up and easier to explain to judges ("this is just a private key with restricted permissions on our contract")
- [x] Fund the keeper wallet with Base Sepolia ETH for gas
- [x] Set `keeper` address on `ParityKeeper.sol` to this wallet (already scriptable via existing `DeployVault.s.sol` — confirm env var wiring)

## 1. Wallet Provider Config
- [x] Configure `EthAccountWalletProvider` (or `CdpEvmWalletProvider`) for `base-sepolia`
- [x] Confirm agent wallet can read balance and send a basic test transaction on Sepolia before wiring anything else

## 2. Data Reading (via AgentKit's Moonwell/Morpho support)
- [x] Confirm AgentKit's Moonwell action provider can read: supply APY, borrow APY, utilization for the mUSDC market
- [x] Confirm it can read equivalent data for the Morpho/Moonwell Flagship USDC vault
- [x] If AgentKit's built-in providers don't expose utilization or health-factor-equivalent data directly, fall back to direct RPC calls to `ParityVault.getHealthFactor()` and `IMToken` rate functions — don't block on AgentKit covering 100% of this

## 3. Custom Action Provider (wrap ParityKeeper)
- [x] Write a custom AgentKit action provider that exposes 3 actions: `rebalance(targetLTV, numLoops, reason, apySnapshot)`, `deleverage(targetLTV, numLoops, reason, apySnapshot)`, `migrate(venue, reason, apySnapshot)`
- [x] Wire these actions to call `ParityKeeper.sol` directly using the ABI (contract address from your deployment)
- [x] Test each action manually once (call `rebalance` by hand through the agent, confirm the on-chain `KeeperAction` event fires as expected)

## 4. Decision Logic (the actual brain — not AgentKit's job)
- [x] Implement the priority tree agreed on earlier:
  - [x] 1. Read health factor → if below safety threshold, call `deleverage()` immediately, skip rest
  - [x] 2. Read rate spread + utilization → if compressed/inverted or near kink, call `rebalance()` (partial deleverage)
  - [x] 3. Compare Moonwell vs Morpho net APY (after gas/slippage estimate) → if meaningfully better elsewhere, call `migrate()`
  - [x] 4. If spread healthy and HF above target → call `rebalance()` to increase leverage
  - [x] 5. If no action taken, log that explicitly too (don't let "did nothing" be invisible)
- [x] Pass a real `reason` string and `apySnapshot` value into every keeper call — no placeholder values, this is what makes the on-chain log meaningful
- [x] Add a polling loop (interval-based — every N minutes) that runs this decision tree

## 5. Error Handling & Safety
- [x] Wrap all RPC/agent calls in try/catch — a dropped read should not cause a silent skip of the health factor check
- [x] Add a hard-coded fallback: if health factor can't be read successfully, treat as unsafe and attempt deleverage rather than doing nothing
- [x] Add basic logging (console or file) of every tick's readings and decision, separate from the on-chain log — useful for debugging during the hackathon

## 6. Testnet Dry Run
- [ ] Run the agent against the deployed Base Sepolia contracts for an extended period (hours, not minutes) and confirm it doesn't take unintended action on stable conditions
- [ ] Manually force a scenario (e.g. simulate a rate change if using mocks, or wait for a real utilization shift) and confirm the agent reacts correctly and logs a real rebalance/deleverage

## 7. Demo Integration
- [ ] Confirm frontend's action-log feed can read events emitted by the agent's on-chain calls (should already work if `ParityKeeper`'s event schema is unchanged)
- [ ] Prepare a way to show the agent "thinking" live during the demo (terminal output of the decision tree running, alongside the on-chain result)

---

## End Goal for This Piece
The agent runs unattended against the deployed Sepolia contracts, reads live Moonwell/Morpho conditions on an interval, and has autonomously executed at least one real `rebalance` or `deleverage` call — with a human-readable reason — without anyone manually triggering it.
