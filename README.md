# Parity

An autonomous agent for leveraged USDC yield management on Base.

Parity watches leveraged stablecoin positions on Base Sepolia and manages them on its own — no manual clicking, no micromanaging. It rebalances leverage, deleverages when risk rises, and migrates to a better-paying venue when it makes sense, all without a human triggering each action.

## What Parity actually does

- You deposit USDC into a vault. Your deposit immediately supplies USDC into Moonwell as collateral.
- The vault borrows more against that collateral and resupplies it, looping until it reaches a target leverage level — 70% LTV for the Aggressive vault, 50% LTV for the Conservative vault.
- You earn the spread — Moonwell's supply rate on the larger, leveraged position, minus the borrow rate on the debt.
- The agent takes it from there. Every 30 seconds (configurable), for each vault, it:
  - Checks health factor first, in plain deterministic code — no AI involved. If it drops below a safety threshold, it deleverages immediately. This rule can never be overridden by a model.
  - If safe, consults two independent AI models (via Groq) — one proposes an action (hold, rebalance, deleverage, or migrate to Morpho), the other independently reviews it. If they agree, it executes. If they disagree, they get one reconciliation pass; if still unresolved, it defaults to the safer option.
  - Logs every decision on-chain — action, reasoning, health factor before/after, APY snapshot — so nothing is a black box.

## Architecture

```text
/contracts   — Solidity + Foundry. ParityVault (ERC-4626) + ParityKeeper (executes agent decisions)
/agent       — TypeScript. Off-chain monitoring loop + dual-model Groq consensus + Express API for live reasoning
/frontend    — Next.js. Landing page + live vault dashboard, wallet connect via wagmi
```

The three pieces only talk to each other through the blockchain (contracts + agent) and a small HTTP API (agent → frontend for live reasoning). They deploy and run independently.

## Tech stack

- **Chain:** Base Sepolia (testnet)
- **Contracts:** Solidity, Foundry
- **Agent:** TypeScript, Coinbase AgentKit patterns, Groq (openai/gpt-oss-20b + openai/gpt-oss-120b), LangChain
- **Frontend:** Next.js, wagmi/viem, Tailwind
- **Lending venues:** Moonwell (primary), Morpho / Moonwell Flagship USDC vault (secondary, migration target)
- **Hosting:** Vercel (frontend), Railway (agent, persistent background worker)

## Setup

### 1. Contracts

```bash
cd contracts
forge install
forge build
forge test
```

Deploy mocks first, then the vault/keeper pointed at the fresh mock addresses:

```bash
forge script script/DeployMocks.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
forge script script/DeployVault.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
forge script script/DeployConservativeVault.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
```

**Required env vars:** `DEPLOYER_PRIVATE_KEY`, `KEEPER_WALLET_ADDRESS`, `USDC_ADDRESS`, `MOONWELL_MUSDC`, `MOONWELL_COMPTROLLER`. The deploy scripts use `vm.envAddress()` (hard revert, no silent fallback) — if something's missing, it fails loudly instead of deploying broken.

### 2. Agent

```bash
cd agent
npm install
npm run build
npm start
```

**Required env vars (see `.env.example` for the full list):** `BASE_SEPOLIA_RPC_URL`, `KEEPER_PRIVATE_KEY`, `GROQ_API_KEY`, `GROQ_MODEL_A`, `GROQ_MODEL_B`, `VAULT_ADDRESS_AGGRESSIVE`, `KEEPER_ADDRESS_AGGRESSIVE`, `VAULT_ADDRESS_CONSERVATIVE`, `KEEPER_ADDRESS_CONSERVATIVE`, target LTVs, safety thresholds, `POLLING_INTERVAL`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

**Required env vars (all `NEXT_PUBLIC_` — none of these are secrets):** RPC URL, vault/keeper addresses for both vaults, USDC/Moonwell addresses, and `NEXT_PUBLIC_AGENT_URL` pointing at the agent's public API.

## Deploying for real

- **Contracts** → Base Sepolia, via the Foundry scripts above.
- **Agent** → Railway, as a persistent background worker (`railway.json` handles build/start/restart policy). Set Root Directory to `/agent`. The Express API must bind to `process.env.PORT`, not a hardcoded port, and Railway needs a public domain generated under Settings → Networking for the frontend to reach it.
- **Frontend** → Vercel. Set Root Directory to `/frontend`. Only `NEXT_PUBLIC_*` vars go here — never the agent's private key or Groq key.

## How to make the agent act (trigger a rebalance on demand)

Under normal conditions, if nothing in the market changes, the agent correctly does nothing — that's not a bug, it's the decision tree working as intended. To force a visible action (for testing or a demo), manipulate the mock contracts' rates directly, then let the agent's next cycle react:

```bash
cd agent
npm run test:sepolia -- healthy-spread        # expect hold or rebalance up
npm run test:sepolia -- spread-inversion      # expect deleverage / migrate
npm run test:sepolia -- health-factor-breach  # expect emergency deleverage, bypassing the AI entirely
npm run test:sepolia -- better-morpho-rate    # expect migration to Morpho
npm run test:sepolia -- reset                 # restore healthy state after testing
```

Each scenario changes the mock's supply/borrow/collateral parameters on-chain, then runs the agent's real monitoring cycle against them — same logic used in production, just with a forced condition to react to. Watch the terminal (or Railway's log viewer) for the two-model consensus playing out live, and check the resulting `KeeperAction` event on Basescan.

## Key things worth knowing (lessons from building this)

- **Health factor is a hard rule, never a model's call.** The deterministic safety check always runs first, in code, before any Groq call — confirmed via a constructor-level spy on ChatGroq in testing, so this isn't just assumed, it's verified.
- **A HOLD decision never appears in the on-chain "Decisions Feed."** Only executed transactions emit `KeeperAction` events. To see the agent's full reasoning — including cycles where it did nothing — check the "Agent Discussion" panel (reads the agent's live `/api/discussions` API), not the on-chain feed.
- **The mock contracts do not accrue interest automatically.** Supply/borrow balances only change when explicitly set via test scenarios or real borrow/repay calls — there's no passive time-based growth unless the mocks are specifically updated to simulate it.
- **Groq's free tier has a daily token cap.** Running two vaults on a 30-second poll burns through it faster than expected over a full day — widen `POLLING_INTERVAL` if you're not actively demoing.
- **Vercel env vars must be type "Config," not "Secret."** A "Secret" type is write-only and never reaches the client bundle, even with a `NEXT_PUBLIC_` prefix — this alone caused a long, confusing debugging chain. Once a variable is saved as Secret, it may need to be deleted and recreated as Config, not just edited.
- **A page that reads live wallet/contract state should be dynamic, not statically prerendered.** Add `export const dynamic = 'force-dynamic'` to any Next.js page depending on runtime data — otherwise `NEXT_PUBLIC_*` values can get baked into a static build in unexpected ways.
- **MetaMask may flag a fresh vercel.app deployment as a "malicious site."** This is a known false positive from Blockaid's heuristics on new/disposable domains, not a reflection of the code. Dispute at report.blockaid.io, but don't expect it to clear before a deadline — "Connect Anyway" is safe once you know it's your own project.
- **Never paste private keys or API keys into a chat, ever.** If it happens, treat the key as compromised and rotate it, regardless of how low-stakes the environment seems.

## Safety design, summarized

Parity's core claim isn't "it earns yield" — plenty of things do. It's how it decides: a hard-coded rule that no AI can override protecting against liquidation, two independent models that have to agree on every judgment call, and a full on-chain (plus off-chain discussion) trail of every decision — including the ones where it chose to do nothing.
