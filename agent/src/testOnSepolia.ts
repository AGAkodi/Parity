import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables from the root .env file BEFORE importing other modules
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import * as ethers from "ethers";
import * as groqModule from "@langchain/groq";

// Import compiled JSON ABIs from the Foundry build artifacts
import * as MockMTokenJson from "../../contracts/out/MockProtocol.sol/MockMToken.json";
import * as MockComptrollerJson from "../../contracts/out/MockProtocol.sol/MockComptroller.json";
import * as ParityVaultJson from "../../contracts/out/ParityVault.sol/ParityVault.json";
import * as ParityKeeperJson from "../../contracts/out/ParityKeeper.sol/ParityKeeper.json";

// 1. Setup Spied ChatGroq to robustly track if Groq consensus was invoked
const groqPath = require.resolve("@langchain/groq");
const originalExports = require(groqPath);
const OriginalChatGroq = originalExports.ChatGroq;
let groqCalled = false;

class SpiedChatGroq extends OriginalChatGroq {
    constructor(fields?: any) {
        groqCalled = true;
        super(fields);
    }
}

// Overwrite the exports object in Node's require cache to return our spied version
require.cache[groqPath] = {
    ...require.cache[groqPath],
    exports: {
        ...originalExports,
        ChatGroq: SpiedChatGroq
    }
} as any;

// 2. Dynamically require agent functions after patching the Groq module
const { runMonitoringCycle } = require("./agent");

const SECONDS_PER_YEAR = 31536000;

// Resolve environment variables
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL;
const KEEPER_PRIVATE_KEY = process.env.KEEPER_PRIVATE_KEY;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS;
const KEEPER_ADDRESS = process.env.KEEPER_ADDRESS;
const MOONWELL_MUSDC = process.env.MOONWELL_MUSDC;
const MOONWELL_COMPTROLLER = process.env.MOONWELL_COMPTROLLER;

// Validate environment configurations
if (!BASE_SEPOLIA_RPC_URL || !KEEPER_PRIVATE_KEY || !VAULT_ADDRESS || !KEEPER_ADDRESS || !MOONWELL_MUSDC || !MOONWELL_COMPTROLLER) {
    console.error("❌ ERROR: Missing required environment variables in .env.");
    console.error("Required variables: BASE_SEPOLIA_RPC_URL, KEEPER_PRIVATE_KEY, VAULT_ADDRESS, KEEPER_ADDRESS, MOONWELL_MUSDC, MOONWELL_COMPTROLLER");
    process.exit(1);
}

// Intercepting console.log / console.error for parsing TX hashes and checking logs
let capturedLogs: string[] = [];
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

function startCapturingLogs() {
    capturedLogs = [];
    const pushLog = (...args: any[]) => {
        const msg = args.map(arg => typeof arg === "object" ? JSON.stringify(arg) : arg).join(" ");
        capturedLogs.push(msg);
    };

    console.log = (...args: any[]) => {
        pushLog(...args);
        originalLog(...args);
    };
    console.warn = (...args: any[]) => {
        pushLog(...args);
        originalWarn(...args);
    };
    console.error = (...args: any[]) => {
        pushLog(...args);
        originalError(...args);
    };
}

function stopCapturingLogs(): string[] {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    return capturedLogs;
}

function getTransactionHashFromLogs(logs: string[]): string | null {
    for (const logLine of logs) {
        const match = logLine.match(/(?:transaction sent|Transaction sent): (0x[a-fA-F0-9]{64})/i);
        if (match) {
            return match[1];
        }
    }
    return null;
}

function clearGroqCall() {
    groqCalled = false;
}

// Convert APY to compound per-second rate
function apyToRatePerSecond(apy: number): bigint {
    return ethers.parseEther(apy.toFixed(18)) / BigInt(SECONDS_PER_YEAR);
}

// Print on-chain state of Parity Vault & Moonwell mock
async function printCurrentState(
    provider: ethers.JsonRpcProvider,
    vault: ethers.Contract,
    mUSDC: ethers.Contract,
    comptroller: ethers.Contract
) {
    // Wait 4 seconds for load-balanced RPC nodes to sync
    await new Promise(resolve => setTimeout(resolve, 4000));

    const activeVenue = await vault.activeVenue();
    const rawHF = await vault.getHealthFactor();
    const healthFactor = rawHF === ethers.MaxUint256 ? Infinity : Number(rawHF) / 1e18;

    const vaultAddr = await vault.getAddress();
    const mTokenBalance = await mUSDC.balanceOf(vaultAddr);
    const exchangeRate = await mUSDC.exchangeRateStored();
    const borrowed = await mUSDC.borrowBalanceStored(vaultAddr);
    const supplied = (BigInt(mTokenBalance) * BigInt(exchangeRate)) / 10n ** 18n;

    const currentLTV = supplied > 0n ? Number(borrowed) / Number(supplied) : 0;

    const supplyRate = await mUSDC.supplyRatePerTimestamp();
    const borrowRate = await mUSDC.borrowRatePerTimestamp();

    const supplyAPY = Math.pow(1 + Number(supplyRate) / 1e18, SECONDS_PER_YEAR) - 1;
    const borrowAPY = Math.pow(1 + Number(borrowRate) / 1e18, SECONDS_PER_YEAR) - 1;

    const denom = 1 - currentLTV;
    const leverageFactor = (borrowed > 0n && currentLTV > 0.001 && currentLTV < 0.95 && denom > 0.05)
        ? 1 / denom
        : 1;
    let netMoonwellAPY = (leverageFactor > 1)
        ? supplyAPY * leverageFactor - borrowAPY * (leverageFactor - 1)
        : supplyAPY;
    if (!isFinite(netMoonwellAPY) || isNaN(netMoonwellAPY) || netMoonwellAPY > 5.0 || netMoonwellAPY < -5.0) {
        netMoonwellAPY = supplyAPY;
    }

    const cfRaw = await comptroller.collateralFactors(MOONWELL_MUSDC);
    const collateralFactor = Number(cfRaw) / 1e18;

    const morphoAPY = Number(process.env.MORPHO_APY_MOCK || "0.047");

    console.log("\n=================== CURRENT ON-CHAIN STATE ===================");
    console.log(`Vault Address:       ${vaultAddr}`);
    console.log(`Active Venue:        ${activeVenue === MOONWELL_MUSDC ? "Moonwell (mUSDC)" : "Morpho (mwUSDC)"}`);
    console.log(`Health Factor:       ${healthFactor === Infinity ? "Infinity" : healthFactor.toFixed(4)}`);
    console.log(`Collateral Factor:   ${(collateralFactor * 100).toFixed(0)}%`);
    console.log(`Current LTV:         ${(currentLTV * 100).toFixed(2)}%`);
    console.log(`Moonwell Supply APY: ${(supplyAPY * 100).toFixed(2)}%`);
    console.log(`Moonwell Borrow APY: ${(borrowAPY * 100).toFixed(2)}%`);
    console.log(`Moonwell Net APY:    ${(netMoonwellAPY * 100).toFixed(2)}%`);
    console.log(`Morpho APY (Mocked): ${(morphoAPY * 100).toFixed(2)}%`);
    console.log("==============================================================");
}

// Print KeeperAction event from transaction receipt
async function printKeeperActionEvent(
    provider: ethers.JsonRpcProvider,
    keeperContract: ethers.Contract,
    txHash: string
) {
    console.log(`\nFetching transaction receipt for ${txHash}...`);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
        console.log("❌ Could not fetch transaction receipt.");
        return;
    }

    console.log(`Parsing logs in receipt...`);
    let found = false;
    for (const log of receipt.logs) {
        try {
            const parsed = keeperContract.interface.parseLog(log);
            if (parsed && parsed.name === "KeeperAction") {
                found = true;
                console.log("\n=================== KEEPER_ACTION EVENT ===================");
                console.log(`Action:       ${parsed.args.action}`);
                console.log(`Reason:       ${parsed.args.reason}`);
                console.log(`HF Before:    ${(Number(parsed.args.hfBefore) / 1e18).toFixed(4)}`);
                console.log(`HF After:     ${(Number(parsed.args.hfAfter) / 1e18).toFixed(4)}`);
                console.log(`APY Snapshot: ${(Number(parsed.args.apySnapshot) / 1e18 * 100).toFixed(2)}%`);
                console.log(`Timestamp:    ${new Date(Number(parsed.args.timestamp) * 1000).toISOString()}`);
                console.log("============================================================");
            }
        } catch (e) {
            // Ignore other events
        }
    }
    if (!found) {
        console.log("❌ No KeeperAction event found in the transaction receipt.");
    }
}

// Reset mock state to normal healthy leveraged position
async function resetToNormalState(
    provider: ethers.JsonRpcProvider,
    wallet: ethers.Wallet,
    vault: ethers.Contract,
    mUSDC: ethers.Contract,
    comptroller: ethers.Contract,
    keeperContract: ethers.Contract,
    targetLTV: number = 0.70
) {
    console.log(`\n=== RESETTING VAULT TO NORMAL BALANCED STATE (${(targetLTV * 100).toFixed(0)}% LTV) ===`);

    // 0. Seed vault with Mock USDC if total assets is less than 10 USDC (10 * 10^6)
    const totalAssets = await vault.totalAssets();
    if (totalAssets < ethers.parseUnits("10", 6)) {
        console.log(`\n⚠️ Vault total assets is low (${ethers.formatUnits(totalAssets, 6)} USDC). Seeding vault...`);
        const usdc = new ethers.Contract(
            process.env.USDC_ADDRESS!,
            [
                "function approve(address spender, uint256 amount) external returns (bool)",
                "function balanceOf(address account) external view returns (uint256)"
            ],
            wallet
        );

        const keeperUSDCBalance = await usdc.balanceOf(wallet.address);
        console.log(`Keeper USDC Balance: ${ethers.formatUnits(keeperUSDCBalance, 6)} USDC`);

        if (keeperUSDCBalance < ethers.parseUnits("10", 6)) {
            throw new Error(`Insufficient USDC in Keeper wallet to seed the vault. Needs at least 10 USDC, but only has ${ethers.formatUnits(keeperUSDCBalance, 6)} USDC. Please claim more USDC from the Circle Sandbox Faucet for address ${wallet.address}.`);
        }

        console.log("Approving vault to spend Mock USDC...");
        let txApp = await usdc.approve(await vault.getAddress(), ethers.MaxUint256);
        await txApp.wait();
        
        // Wait for RPC to sync
        await new Promise(resolve => setTimeout(resolve, 4000));

        const amountToDeposit = ethers.parseUnits("10", 6);
        console.log(`Depositing ${ethers.formatUnits(amountToDeposit, 6)} USDC into the vault...`);
        let txDep = await vault.deposit(amountToDeposit, wallet.address);
        await txDep.wait();
        
        // Wait for RPC to sync
        await new Promise(resolve => setTimeout(resolve, 4000));

        console.log(`✅ Vault seeded! New total assets: ${ethers.formatUnits(await vault.totalAssets(), 6)} USDC\n`);
    }

    // 1. Set collateral factor to 80%
    console.log("Setting Moonwell Collateral Factor to 80%...");
    let tx = await comptroller.setCollateralFactor(MOONWELL_MUSDC, ethers.parseEther("0.8"));
    await tx.wait();
    await new Promise(resolve => setTimeout(resolve, 4000));

    // 2. Set healthy supply and borrow rates (Supply 8%, Borrow 4% APY)
    console.log("Setting Moonwell APY rates (Supply = 8%, Borrow = 4%)...");
    tx = await mUSDC.setSupplyRate(apyToRatePerSecond(0.08));
    await tx.wait();
    tx = await mUSDC.setBorrowRate(apyToRatePerSecond(0.04));
    await tx.wait();
    await new Promise(resolve => setTimeout(resolve, 4000));

    process.env.MORPHO_APY_MOCK = "0.02";

    // 3. Migrate back to Moonwell if currently in Morpho
    const activeVenue = await vault.activeVenue();
    if (activeVenue !== MOONWELL_MUSDC) {
        console.log("Active Venue is currently Morpho. Migrating to Moonwell...");
        tx = await keeperContract.migrate(MOONWELL_MUSDC, "Resetting venue to Moonwell", 0);
        await tx.wait();
        await new Promise(resolve => setTimeout(resolve, 4000));
    }

    // 4. Rebalance to target LTV
    console.log(`Rebalancing vault to ${(targetLTV * 100).toFixed(0)}% LTV...`);
    tx = await keeperContract.rebalance(ethers.parseEther(targetLTV.toFixed(18)), 5, `Reset LTV to ${(targetLTV * 100).toFixed(0)}%`, 0);
    await tx.wait();
    await new Promise(resolve => setTimeout(resolve, 4000));

    console.log("✅ Reset completed successfully.");
    await printCurrentState(provider, vault, mUSDC, comptroller);
}

// Scenario 1: Healthy spread -> expect leverage-up or hold
async function runHealthySpread(
    provider: ethers.JsonRpcProvider,
    vault: ethers.Contract,
    mUSDC: ethers.Contract,
    comptroller: ethers.Contract,
    keeperContract: ethers.Contract
) {
    console.log("\n>>> RUNNING SCENARIO: Healthy Spread");
    
    // Set healthy spread: supply = 8%, borrow = 4% on Moonwell.
    console.log("Setting healthy spread rates on-chain (Supply APY = 8%, Borrow APY = 4%)...");
    let tx = await mUSDC.setSupplyRate(apyToRatePerSecond(0.08));
    await tx.wait();
    tx = await mUSDC.setBorrowRate(apyToRatePerSecond(0.04));
    await tx.wait();

    process.env.MORPHO_APY_MOCK = "0.02";

    console.log("\nBefore Scenario State:");
    await printCurrentState(provider, vault, mUSDC, comptroller);

    clearGroqCall();
    startCapturingLogs();

    try {
        await runMonitoringCycle(
            "Aggressive",
            BASE_SEPOLIA_RPC_URL,
            KEEPER_PRIVATE_KEY,
            VAULT_ADDRESS,
            KEEPER_ADDRESS,
            MOONWELL_MUSDC,
            0.70, // target LTV 70%
            1.10, // safety HF 1.10
            0.02 // Morpho APY
        );
    } finally {
        const logs = stopCapturingLogs();
        const txHash = getTransactionHashFromLogs(logs);
        if (txHash) {
            await printKeeperActionEvent(provider, keeperContract, txHash);
        } else {
            console.log("\n[RESULT] No transaction was sent (expected if LTV is already at target LTV 70% and action is HOLD).");
        }
        console.log(`[VERIFICATION] Groq Call Triggered: ${groqCalled}`);
    }
}

// Scenario 2: Spread inversion -> expect deleverage to 0% LTV
async function runSpreadInversion(
    provider: ethers.JsonRpcProvider,
    vault: ethers.Contract,
    mUSDC: ethers.Contract,
    comptroller: ethers.Contract,
    keeperContract: ethers.Contract
) {
    console.log("\n>>> RUNNING SCENARIO: Spread Inversion");

    // Invert spread: supply APY = 1%, borrow APY = 15%.
    console.log("Setting inverted spread rates on-chain (Supply APY = 1%, Borrow APY = 15%)...");
    let tx = await mUSDC.setSupplyRate(apyToRatePerSecond(0.01));
    await tx.wait();
    tx = await mUSDC.setBorrowRate(apyToRatePerSecond(0.15));
    await tx.wait();

    process.env.MORPHO_APY_MOCK = "0.02";

    console.log("\nBefore Scenario State:");
    await printCurrentState(provider, vault, mUSDC, comptroller);

    clearGroqCall();
    startCapturingLogs();

    try {
        await runMonitoringCycle(
            "Aggressive",
            BASE_SEPOLIA_RPC_URL,
            KEEPER_PRIVATE_KEY,
            VAULT_ADDRESS,
            KEEPER_ADDRESS,
            MOONWELL_MUSDC,
            0.70, // target LTV
            1.10, // safety HF
            0.02 // Morpho APY
        );
    } finally {
        const logs = stopCapturingLogs();
        const txHash = getTransactionHashFromLogs(logs);
        if (txHash) {
            await printKeeperActionEvent(provider, keeperContract, txHash);
        } else {
            console.log("\n[RESULT] No transaction was sent.");
        }
        console.log(`[VERIFICATION] Groq Call Triggered: ${groqCalled}`);
        if (!groqCalled && process.env.MOCK_LLM !== "true") {
            console.log("⚠️ WARNING: Groq was NOT called but should have been for the consensus path!");
        } else {
            console.log("✅ Groq/LLM was successfully consulted for the consensus decision.");
        }
    }
}

// Scenario 3: Health factor breach -> expect immediate emergency deleverage (bypasses LLM, 55% target LTV)
async function runHealthFactorBreach(
    provider: ethers.JsonRpcProvider,
    vault: ethers.Contract,
    mUSDC: ethers.Contract,
    comptroller: ethers.Contract,
    keeperContract: ethers.Contract
) {
    console.log("\n>>> RUNNING SCENARIO: Health Factor Breach");

    // Drop Collateral Factor to 72% (makes HF = 1.09, breaching 1.15 safety threshold but avoiding <1.0 shortfall)
    console.log("Dropping Moonwell Collateral Factor to 72% on-chain...");
    let tx = await comptroller.setCollateralFactor(MOONWELL_MUSDC, ethers.parseEther("0.72"));
    await tx.wait();

    console.log("\nBefore Scenario State:");
    await printCurrentState(provider, vault, mUSDC, comptroller);

    clearGroqCall();
    startCapturingLogs();

    try {
        await runMonitoringCycle(
            "Aggressive",
            BASE_SEPOLIA_RPC_URL,
            KEEPER_PRIVATE_KEY,
            VAULT_ADDRESS,
            KEEPER_ADDRESS,
            MOONWELL_MUSDC,
            0.70, // target LTV
            1.15, // safety HF (should breach and trigger early exit)
            0.02 // Morpho APY
        );
    } finally {
        const logs = stopCapturingLogs();
        const txHash = getTransactionHashFromLogs(logs);
        if (txHash) {
            await printKeeperActionEvent(provider, keeperContract, txHash);
        } else {
            console.log("\n[RESULT] No transaction was sent.");
        }
        
        console.log(`[VERIFICATION] Groq Call Triggered: ${groqCalled}`);
        const logStr = logs.join("\n");
        const containsConsensusText = logStr.includes("Consulting dual-model consensus layer") || 
                                     logStr.includes("Simulating proposal");
        
        if (!groqCalled && !containsConsensusText) {
            console.log("✅ SUCCESS: Groq calls and LLM consensus were entirely bypassed!");
        } else {
            console.log("❌ FAILURE: Groq calls or LLM consensus were invoked despite the emergency!");
        }
    }
}

// Scenario 4: Better rate on Morpho mock -> expect migrate()
async function runBetterMorphoRate(
    provider: ethers.JsonRpcProvider,
    vault: ethers.Contract,
    mUSDC: ethers.Contract,
    comptroller: ethers.Contract,
    keeperContract: ethers.Contract
) {
    console.log("\n>>> RUNNING SCENARIO: Better Rate on Morpho Mock");

    // Ensure active venue is Moonwell first
    const activeVenue = await vault.activeVenue();
    if (activeVenue !== MOONWELL_MUSDC) {
        console.log("Active Venue is Morpho. Migrating to Moonwell first...");
        let tx = await keeperContract.migrate(MOONWELL_MUSDC, "Setup for Morpho migration test", 0);
        await tx.wait();
    }

    // Set Moonwell rates low (Supply = 2%, Borrow = 2%)
    console.log("Setting Moonwell rates (Supply APY = 2%, Borrow APY = 2%)...");
    let tx = await mUSDC.setSupplyRate(apyToRatePerSecond(0.02));
    await tx.wait();
    tx = await mUSDC.setBorrowRate(apyToRatePerSecond(0.02));
    await tx.wait();

    // Set Morpho APY Mock to 6%
    process.env.MORPHO_APY_MOCK = "0.06";

    console.log("\nBefore Scenario State:");
    await printCurrentState(provider, vault, mUSDC, comptroller);

    clearGroqCall();
    startCapturingLogs();

    try {
        await runMonitoringCycle(
            "Aggressive",
            BASE_SEPOLIA_RPC_URL,
            KEEPER_PRIVATE_KEY,
            VAULT_ADDRESS,
            KEEPER_ADDRESS,
            MOONWELL_MUSDC,
            0.70, // target LTV
            1.10, // safety HF
            0.06 // Morpho APY override parameter
        );
    } finally {
        const logs = stopCapturingLogs();
        const txHash = getTransactionHashFromLogs(logs);
        if (txHash) {
            await printKeeperActionEvent(provider, keeperContract, txHash);
        } else {
            console.log("\n[RESULT] No transaction was sent.");
        }
        console.log(`[VERIFICATION] Groq Call Triggered: ${groqCalled}`);
    }
}

async function main() {
    const scenario = process.argv[2];
    if (!scenario) {
        console.log("Usage: npm run test:sepolia -- <scenario-name>");
        console.log("Available scenarios:");
        console.log("  healthy-spread");
        console.log("  spread-inversion");
        console.log("  health-factor-breach");
        console.log("  better-morpho-rate");
        console.log("  reset");
        process.exit(1);
    }

    console.log(`\n=============================================================`);
    console.log(`   PARITY BASE SEPOLIA TEST RUNNER - SCENARIO: ${scenario.toUpperCase()}`);
    console.log(`=============================================================`);

    const provider = new ethers.JsonRpcProvider(BASE_SEPOLIA_RPC_URL);
    const wallet = new ethers.Wallet(KEEPER_PRIVATE_KEY!, provider);

    console.log(`Connected Wallet: ${wallet.address}`);
    const balance = await provider.getBalance(wallet.address);
    console.log(`Wallet Balance:   ${ethers.formatEther(balance)} ETH`);

    // Instantiate contracts
    const vault = new ethers.Contract(VAULT_ADDRESS!, ParityVaultJson.abi, wallet);
    const mUSDC = new ethers.Contract(MOONWELL_MUSDC!, MockMTokenJson.abi, wallet);
    const comptroller = new ethers.Contract(MOONWELL_COMPTROLLER!, MockComptrollerJson.abi, wallet);
    const keeperContract = new ethers.Contract(KEEPER_ADDRESS!, ParityKeeperJson.abi, wallet);

    switch (scenario.toLowerCase()) {
        case "healthy-spread":
            await runHealthySpread(provider, vault, mUSDC, comptroller, keeperContract);
            await resetToNormalState(provider, wallet, vault, mUSDC, comptroller, keeperContract);
            break;
        case "spread-inversion":
            await runSpreadInversion(provider, vault, mUSDC, comptroller, keeperContract);
            await resetToNormalState(provider, wallet, vault, mUSDC, comptroller, keeperContract);
            break;
        case "health-factor-breach":
            await runHealthFactorBreach(provider, vault, mUSDC, comptroller, keeperContract);
            await resetToNormalState(provider, wallet, vault, mUSDC, comptroller, keeperContract);
            break;
        case "better-morpho-rate":
            await runBetterMorphoRate(provider, vault, mUSDC, comptroller, keeperContract);
            await resetToNormalState(provider, wallet, vault, mUSDC, comptroller, keeperContract);
            break;
        case "reset":
            console.log("\n=== RESETTING AGGRESSIVE VAULT ===");
            await resetToNormalState(provider, wallet, vault, mUSDC, comptroller, keeperContract, 0.70);

            const vaultConsAddress = process.env.VAULT_ADDRESS_CONSERVATIVE;
            const keeperConsAddress = process.env.KEEPER_ADDRESS_CONSERVATIVE;
            if (vaultConsAddress && keeperConsAddress) {
                console.log("\n=== RESETTING CONSERVATIVE VAULT ===");
                const vaultCons = new ethers.Contract(vaultConsAddress, ParityVaultJson.abi, wallet);
                const keeperCons = new ethers.Contract(keeperConsAddress, ParityKeeperJson.abi, wallet);
                await resetToNormalState(provider, wallet, vaultCons, mUSDC, comptroller, keeperCons, 0.50);
            }
            break;
        default:
            console.error(`❌ Unknown scenario: ${scenario}`);
            process.exit(1);
    }

    console.log("\n=============================================================");
    console.log("   SCENARIO COMPLETED");
    console.log("=============================================================");
}

main().catch((error) => {
    console.error("\n❌ Execution Error:", error);
    process.exit(1);
});
