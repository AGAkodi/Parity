# Parity — Build TODO

Chain: **Base** (testnet first, e.g. Base Sepolia)
Contracts: **Solidity** (Foundry recommended for testing/deploy speed)
Agent/keeper service: **TypeScript/Node** (or Python — pick one, keep it consistent)
Frontend: **Next.js + wagmi/viem**
Lending venues: **Moonwell** (primary), **Morpho — Moonwell Flagship USDC vault** (secondary)
Asset: **USDC** only for v1

---

## 0. Environment Setup
- [x] Install Foundry (`forge`, `cast`, `anvil`)
- [x] Set up repo structure: `/contracts`, `/agent`, `/frontend`
- [x] Get Base Sepolia testnet ETH (faucet) for gas
- [x] Get testnet USDC on Base Sepolia (Circle faucet or bridge)
- [x] Set up `.env` for RPC URL, deployer private key, keeper private key — keep deployer and keeper keys separate
- [x] Confirm Moonwell is deployed on Base Sepolia (or decide to demo against Base mainnet fork instead if testnet liquidity is thin)

## 1. Research & Confirm Protocol Interfaces
- [x] Pull Moonwell's mToken contract ABI (supply, withdraw, borrow, repay, getAccountLiquidity / health factor equivalent)
- [x] Confirm Moonwell's interest rate curve params (kink utilization %, base rate, liquidation LTV) for USDC market
- [x] Pull Morpho / Moonwell Flagship USDC vault ABI (for secondary venue migration logic)
- [x] Confirm oracle source Moonwell uses for USDC pricing (should be near 1:1, but verify)
- [x] Document exact function signatures you'll call — no guessing later mid-build

## 2. Vault Contract (ERC-4626)
- [x] Write `ParityVault.sol` — standard ERC-4626, USDC as underlying asset
- [x] Implement deposit/withdraw/redeem/totalAssets overrides to account for funds deployed into Moonwell
- [x] Write unit tests: deposit, withdraw, share price accounting under yield accrual
- [ ] Deploy to Base Sepolia, verify on explorer

## 3. Leverage Loop (Manual First)
- [x] Write vault logic (or separate `LeverageManager.sol`) to: supply USDC to Moonwell → borrow USDC → resupply → repeat to target LTV
- [x] Write the reverse: unwind loop (repay → withdraw → repay → withdraw) down to a target LTV or full exit
- [x] Hardcode a manual/owner-triggered version first — confirm the math and gas costs actually work before automating
- [x] Test on testnet: deposit → loop to target leverage → confirm health factor and position size match expected formula
- [x] Test full unwind path end-to-end

## 4. Keeper Contract
- [x] Write `ParityKeeper.sol` with restricted `onlyKeeper` modifier
- [x] Expose functions: `rebalance()`, `deleverage()`, `migrate(venue)` — callable only by the keeper address
- [x] Add on-chain event/log emission for every action: `{ action, reason, HF_before, HF_after, apySnapshot, timestamp }`
- [x] Add circuit breaker: manual pause function in case of emergency (owner-only)
- [x] Test access control — confirm non-keeper calls revert

## 5. Off-Chain Agent (Monitoring Service)
- [x] Set up service that polls, on an interval: current health factor, Moonwell supply APY, Moonwell borrow APY, utilization rate
- [x] Pull equivalent numbers from Morpho/Moonwell Flagship vault for comparison
- [x] Implement decision tree in priority order:
  - [x] 1. If HF < safety threshold → call `deleverage()` immediately, skip rest
  - [x] 2. If spread inverted or utilization near kink → call `rebalance()` (partial deleverage)
  - [x] 3. If better net APY elsewhere (after gas/slippage) → call `migrate()`
  - [x] 4. If spread healthy and HF above target → loop further (increase leverage)
  - [x] 5. Always log the decision and reasoning, even "no action taken"
- [x] Connect service to keeper contract via signed transactions (keeper private key)
- [x] Add basic retry/error handling for RPC failures — don't let a dropped call go silent
- [x] Test the full automated loop on testnet: let it run and observe at least one real rebalance/deleverage cycle

## 6. Attestation / Transparency Layer
- [x] Confirm on-chain logs are readable and complete (can reconstruct full decision history from events alone)
- [x] Write a small indexer/script that reads past events and formats them human-readably (for frontend feed)

## 7. Frontend
- [ ] Deposit/withdraw UI (connect wallet, ERC-4626 interactions)
- [ ] Live dashboard: current vault APY, current leverage, current health factor
- [ ] Action log feed — human-readable version of on-chain attestations ("Rebalanced: spread compressed from X% to Y%")
- [ ] Basic responsive polish — this is what judges see first

## 8. Demo Prep
- [ ] Script a scenario that forces a visible rebalance or deleverage within the demo window (e.g. manually spike utilization on testnet, or simulate a rate shift)
- [ ] Record 90-second demo: deposit → autonomous agent action → on-chain log proof
- [ ] Prepare a one-line answer for "what happens if the off-chain agent goes down" (centralization caveat — have this ready, don't dodge it)
- [ ] Prepare a one-line answer for realistic yield expectations (don't oversell APY given current Moonwell base rates)

## 9. Final Checks Before Submission
- [ ] All contracts verified on Base Sepolia explorer
- [ ] Vault + keeper + agent running end-to-end without manual intervention for at least one full demo cycle
- [ ] README with architecture summary, deployed addresses, and how to run the agent locally
- [ ] Submission requirements for the hackathon double-checked (demo video, socials post, any required registration steps)

---

## End Goal Definition (you're done when...)
A live Base testnet deployment where:
1. A user can deposit USDC into the Parity vault
2. Parity autonomously loops the position into leveraged Moonwell supply/borrow up to a safe target LTV
3. The off-chain agent continuously monitors health factor, rate spread, and utilization
4. Without any manual trigger, Parity has executed at least one real rebalance or deleverage action during testing
5. Every action is logged on-chain with a clear, human-readable reason
6. The frontend shows all of this live — deposit, current state, and the action history
