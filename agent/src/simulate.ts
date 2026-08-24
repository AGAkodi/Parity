import * as ethers from "ethers";
import { runMonitoringCycle } from "./agent";

// We import compiled ABIs from the Foundry project outputs!
import * as MockUSDCJson from "../../contracts/out/MockProtocol.sol/MockUSDC.json";
import * as MockMTokenJson from "../../contracts/out/MockProtocol.sol/MockMToken.json";
import * as MockComptrollerJson from "../../contracts/out/MockProtocol.sol/MockComptroller.json";
import * as MockOracleJson from "../../contracts/out/MockProtocol.sol/MockOracle.json";
import * as MockMorphoVaultJson from "../../contracts/out/MockProtocol.sol/MockMorphoVault.json";
import * as ParityVaultJson from "../../contracts/out/ParityVault.sol/ParityVault.json";
import * as ParityKeeperJson from "../../contracts/out/ParityKeeper.sol/ParityKeeper.json";

const ANVIL_RPC = "http://127.0.0.1:8545";

const ERC20_ABI = [
    "function approve(address,uint256) external returns(bool)",
    "function balanceOf(address) external view returns(uint256)"
];

// Anvil standard private keys
const DEPLOYER_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Account #0
const KEEPER_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";   // Account #1
const ALICE_PRIVATE_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";    // Account #2

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function getNonce(provider: ethers.JsonRpcProvider, address: string): Promise<number> {
    const rawNonce = await provider.send("eth_getTransactionCount", [address, "latest"]);
    return Number(rawNonce);
}

async function main() {
    console.log("=========================================");
    console.log("   PARITY AGENT DECISION TREE SIMULATOR  ");
    console.log("=========================================");

    // Default to MOCK_LLM to run simulation fast, unless USE_REAL_LLM is explicitly true
    if (process.env.USE_REAL_LLM !== "true") {
        process.env.MOCK_LLM = "true";
        console.log("ℹ️ Running consensus layer in MOCK mode for stable local simulation. Set USE_REAL_LLM=true to run real LLMs.");
    } else {
        console.log("ℹ️ Running consensus layer with real LLM calls (via Groq API).");
    }

    const provider = new ethers.JsonRpcProvider(ANVIL_RPC);
    
    // Check if Anvil is running and reset it to genesis state
    try {
        await provider.getNetwork();
        await provider.send("anvil_reset", []);
        console.log("🔄 Reset Anvil local blockchain to genesis state.");
    } catch (e) {
        console.error("❌ Error: Anvil node is not running at http://127.0.0.1:8545");
        console.error("Please run 'anvil' in another terminal first before running the simulator!");
        process.exit(1);
    }

    const deployer = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);
    const keeperWallet = new ethers.Wallet(KEEPER_PRIVATE_KEY, provider);
    const alice = new ethers.Wallet(ALICE_PRIVATE_KEY, provider);

    console.log("Deployer Address:", deployer.address);
    console.log("Keeper Wallet Address:", keeperWallet.address);
    console.log("Alice Wallet Address:", alice.address);

    // 1. Deploy Mock Protocols (using manual nonces to bypass provider cache)
    console.log("\n1. Deploying Mock Protocol Contracts...");
    
    const MockUSDCDep = new ethers.ContractFactory(MockUSDCJson.abi, MockUSDCJson.bytecode, deployer);
    const usdc = (await MockUSDCDep.deploy({ nonce: await getNonce(provider, deployer.address) })) as any;
    await usdc.waitForDeployment();
    const usdcAddress = await usdc.getAddress();
    console.log("Mock USDC deployed at:", usdcAddress);

    const MockMTokenDep = new ethers.ContractFactory(MockMTokenJson.abi, MockMTokenJson.bytecode, deployer);
    const mUSDC = (await MockMTokenDep.deploy(usdcAddress, { nonce: await getNonce(provider, deployer.address) })) as any;
    await mUSDC.waitForDeployment();
    const mUSDCAddress = await mUSDC.getAddress();
    console.log("Mock mUSDC deployed at:", mUSDCAddress);

    const MockComptrollerDep = new ethers.ContractFactory(MockComptrollerJson.abi, MockComptrollerJson.bytecode, deployer);
    const comptroller = (await MockComptrollerDep.deploy({ nonce: await getNonce(provider, deployer.address) })) as any;
    await comptroller.waitForDeployment();
    const comptrollerAddress = await comptroller.getAddress();
    console.log("Mock Comptroller deployed at:", comptrollerAddress);

    const MockOracleDep = new ethers.ContractFactory(MockOracleJson.abi, MockOracleJson.bytecode, deployer);
    const oracle = (await MockOracleDep.deploy({ nonce: await getNonce(provider, deployer.address) })) as any;
    await oracle.waitForDeployment();
    const oracleAddress = await oracle.getAddress();
    console.log("Mock Oracle deployed at:", oracleAddress);

    const MockMorphoVaultDep = new ethers.ContractFactory(MockMorphoVaultJson.abi, MockMorphoVaultJson.bytecode, deployer);
    const morpho = (await MockMorphoVaultDep.deploy(usdcAddress, { nonce: await getNonce(provider, deployer.address) })) as any;
    await morpho.waitForDeployment();
    const morphoAddress = await morpho.getAddress();
    console.log("Mock Morpho Vault deployed at:", morphoAddress);

    // Configure Mocks
    console.log("\nConfiguring Mock Comptroller and Oracle...");
    const txO = await comptroller.setOracle(oracleAddress, { nonce: await getNonce(provider, deployer.address) });
    await txO.wait();
    const txM = await comptroller.setMToken(mUSDCAddress, { nonce: await getNonce(provider, deployer.address) });
    await txM.wait();
    const txCF = await comptroller.setCollateralFactor(mUSDCAddress, ethers.parseEther("0.8"), { nonce: await getNonce(provider, deployer.address) });
    await txCF.wait();

    // 2. Deploy Parity contracts
    console.log("\n2. Deploying Parity Vault and Keeper...");
    const ParityVaultDep = new ethers.ContractFactory(ParityVaultJson.abi, ParityVaultJson.bytecode, deployer);
    const vault = (await ParityVaultDep.deploy(
        usdcAddress,
        mUSDCAddress,
        comptrollerAddress,
        "Parity Vault",
        "prtUSDC",
        { nonce: await getNonce(provider, deployer.address) }
    )) as any;
    await vault.waitForDeployment();
    const vaultAddress = await vault.getAddress();
    console.log("ParityVault deployed at:", vaultAddress);

    const ParityKeeperDep = new ethers.ContractFactory(ParityKeeperJson.abi, ParityKeeperJson.bytecode, deployer);
    const keeper = (await ParityKeeperDep.deploy(vaultAddress, keeperWallet.address, { nonce: await getNonce(provider, deployer.address) })) as any;
    await keeper.waitForDeployment();
    const keeperAddress = await keeper.getAddress();
    console.log("ParityKeeper deployed at:", keeperAddress);

    // Link keeper to vault
    const txK = await vault.setKeeper(keeperAddress, { nonce: await getNonce(provider, deployer.address) });
    await txK.wait();
    console.log("Keeper contract authorized on ParityVault.");

    // 3. Alice deposits 100 USDC
    console.log("\n3. Simulating Alice depositing 100 USDC...");
    // First, mint USDC to Alice
    const txMint = await usdc.mint(alice.address, 1000 * 1e6, { nonce: await getNonce(provider, deployer.address) });
    await txMint.wait();
    console.log("Alice USDC balance:", Number(await usdc.balanceOf(alice.address)) / 1e6, "USDC");
    
    // Alice approves vault
    const txApp = await (usdc.connect(alice) as any).approve(vaultAddress, ethers.MaxUint256, { nonce: await getNonce(provider, alice.address) });
    await txApp.wait();
    
    // Alice deposits 100 USDC
    const aliceVault = new ethers.Contract(vaultAddress, ParityVaultJson.abi, alice) as any;
    const txDep = await aliceVault.deposit(100 * 1e6, alice.address, { nonce: await getNonce(provider, alice.address) });
    await txDep.wait();
    console.log("Alice deposited 100 USDC. Vault total assets:", Number(await vault.totalAssets()) / 1e6, "USDC");

    // Helper to run agent cycle
    const runAgent = async (morphoApy: number) => {
        process.env.MORPHO_VAULT_ADDRESS = morphoAddress;
        await runMonitoringCycle(
            ANVIL_RPC,
            KEEPER_PRIVATE_KEY,
            vaultAddress,
            keeperAddress,
            mUSDCAddress,
            0.70, // target LTV 70%
            1.10, // safety HF 1.10
            morphoApy
        );
    };

    // ========================================================
    // SCENARIO 1: Optimistic Leverage (Standard state)
    // ========================================================
    console.log("\n=== SCENARIO 1: Optimistic Leverage (Standard State) ===");
    // Morpho yield is low (3% APY). Moonwell is high. Agent should leverage up to 70%.
    await runAgent(0.03);
    
    console.log("\nVerification:");
    console.log("Vault active venue:", await vault.activeVenue() === mUSDCAddress ? "Moonwell" : "Morpho");
    console.log("Vault total assets:", Number(await vault.totalAssets()) / 1e6, "USDC");
    console.log("Vault borrowed debt:", Number(await mUSDC.borrowBalanceStored(vaultAddress)) / 1e6, "USDC");

    await delay(1500); // Allow blocks to settle on local RPC

    // ========================================================
    // SCENARIO 2: Spread Inversion (Protection)
    // ========================================================
    console.log("\n=== SCENARIO 2: Inverted Spread Protection ===");
    // Set Moonwell borrow rate extremely high (15% APY representation) and supply rate low (1% APY representation)
    // This will invert the spread. Agent should deleverage to 0 LTV.
    const txSR = await mUSDC.setSupplyRate(ethers.parseEther("0.01") / 31536000n, { nonce: await getNonce(provider, deployer.address) });
    await txSR.wait();
    const txBR = await mUSDC.setBorrowRate(ethers.parseEther("0.15") / 31536000n, { nonce: await getNonce(provider, deployer.address) });
    await txBR.wait();
    
    await runAgent(0.03);

    console.log("\nVerification:");
    console.log("Vault active venue:", await vault.activeVenue() === mUSDCAddress ? "Moonwell" : "Morpho");
    console.log("Vault total assets:", Number(await vault.totalAssets()) / 1e6, "USDC");
    console.log("Vault borrowed debt:", Number(await mUSDC.borrowBalanceStored(vaultAddress)) / 1e6, "USDC");

    await delay(1500);

    // ========================================================
    // SCENARIO 3: Yield Migration to Morpho
    // ========================================================
    console.log("\n=== SCENARIO 3: Migration to Morpho (Yield Optimization) ===");
    // Reset Moonwell spread to healthy (Supply 5%, Borrow 6% APY)
    const txSR2 = await mUSDC.setSupplyRate(ethers.parseEther("0.05") / 31536000n, { nonce: await getNonce(provider, deployer.address) });
    await txSR2.wait();
    const txBR2 = await mUSDC.setBorrowRate(ethers.parseEther("0.06") / 31536000n, { nonce: await getNonce(provider, deployer.address) });
    await txBR2.wait();
    
    // Leverage up first
    console.log("\nLeveraging up first before migration test...");
    await runAgent(0.03);

    await delay(1500);

    // Set Morpho APY extremely high (10% APY). This exceeds Moonwell's leveraged yield.
    // Agent should migrate to Morpho.
    console.log("\nRunning monitoring cycle with high Morpho APY...");
    await runAgent(0.10);

    console.log("\nVerification:");
    console.log("Vault active venue:", await vault.activeVenue() === morphoAddress ? "Morpho" : "Moonwell");
    console.log("Vault Morpho shares:", Number(await morpho.balanceOf(vaultAddress)) / 1e6);
    console.log("Vault total assets:", Number(await vault.totalAssets()) / 1e6, "USDC");
    console.log("Vault Moonwell debt:", Number(await mUSDC.borrowBalanceStored(vaultAddress)) / 1e6, "USDC");

    await delay(1500);

    // ========================================================
    // SCENARIO 4: Yield Migration back to Moonwell
    // ========================================================
    console.log("\n=== SCENARIO 4: Migration back to Moonwell ===");
    // Reduce Morpho APY to 2%. Moonwell net leveraged APY is higher (~4.8% base + leverage).
    // Agent should migrate back to Moonwell.
    await runAgent(0.02);

    console.log("\nVerification:");
    console.log("Vault active venue:", await vault.activeVenue() === mUSDCAddress ? "Moonwell" : "Morpho");
    console.log("Vault total assets:", Number(await vault.totalAssets()) / 1e6, "USDC");
    console.log("Vault Moonwell debt:", Number(await mUSDC.borrowBalanceStored(vaultAddress)) / 1e6, "USDC");

    await delay(1500);

    // ========================================================
    // SCENARIO 5: RPC Read Failure / Fallback safety deleverage
    // ========================================================
    console.log("\n=== SCENARIO 5: RPC Read Failure / Fallback safety deleverage ===");
    // Set a healthy spread first and leverage up slightly so there's debt to deleverage
    console.log("Leveraging up before triggering read failure...");
    const txSR3 = await mUSDC.setSupplyRate(ethers.parseEther("0.08") / 31536000n, { nonce: await getNonce(provider, deployer.address) });
    await txSR3.wait();
    const txBR3 = await mUSDC.setBorrowRate(ethers.parseEther("0.04") / 31536000n, { nonce: await getNonce(provider, deployer.address) });
    await txBR3.wait();
    
    // Leverage up to 70% LTV
    await runAgent(0.02);

    console.log("Vault debt before read failure:", Number(await mUSDC.borrowBalanceStored(vaultAddress)) / 1e6, "USDC");

    console.log("\nSimulating read failure by running cycle with an invalid vault address...");
    try {
        await runMonitoringCycle(
            ANVIL_RPC,
            KEEPER_PRIVATE_KEY,
            ethers.ZeroAddress, // Invalid vault address to cause read failure
            keeperAddress,
            mUSDCAddress,
            0.70, // target LTV 70%
            1.10, // safety HF 1.10
            0.02
        );
    } catch (e) {
        console.error("Scenario 5 outer catch (should not be reached):", e);
    }

    console.log("\nVerification:");
    console.log("Vault active venue:", await vault.activeVenue() === mUSDCAddress ? "Moonwell" : "Morpho");
    console.log("Vault total assets:", Number(await vault.totalAssets()) / 1e6, "USDC");
    console.log("Vault Moonwell debt after fallback safety deleverage:", Number(await mUSDC.borrowBalanceStored(vaultAddress)) / 1e6, "USDC");

    await delay(1500);

    // ========================================================
    // SCENARIO 6: Disagreement and Reconciliation
    // ========================================================
    console.log("\n=== SCENARIO 6: Model Disagreement and Reconciliation ===");

    // 6a. Disagreement followed by successful reconciliation (Model A changes to agree with B)
    console.log("\n--- Scenario 6a: Disagreement resolved via successful reconciliation (Reconcile to Hold) ---");
    process.env.TRIGGER_DISAGREEMENT = "true";
    process.env.RECONCILE_TO_B = "true";

    // Set a healthy spread and leverage down first so LTV is low and Model A wants to rebalance
    const txSR4 = await mUSDC.setSupplyRate(ethers.parseEther("0.08") / 31536000n, { nonce: await getNonce(provider, deployer.address) });
    await txSR4.wait();
    const txBR4 = await mUSDC.setBorrowRate(ethers.parseEther("0.04") / 31536000n, { nonce: await getNonce(provider, deployer.address) });
    await txBR4.wait();

    // Run cycle: Model A wants to "rebalance" (leverage up), Model B says "hold". Model A reconciles to "hold".
    await runAgent(0.02);

    await delay(1500);

    // 6b. Disagreement followed by reconciliation failure (safer default fallback to HOLD)
    console.log("\n--- Scenario 6b: Disagreement not resolved, fallback to safer option (HOLD) ---");
    process.env.TRIGGER_DISAGREEMENT = "true";
    process.env.RECONCILE_TO_B = "false";

    // Run cycle: Model A wants to "rebalance", Model B says "hold". Model A doesn't reconcile. Safer default is HOLD (since neither proposed deleverage).
    await runAgent(0.02);

    await delay(1500);

    // 6c. Disagreement followed by reconciliation failure (safer default fallback with leverage safety doubt -> DELEVERAGE)
    console.log("\n--- Scenario 6c: Disagreement not resolved, fallback to safer option (DELEVERAGE for safety doubt) ---");
    process.env.MOCK_LLM_A_ACTION = "deleverage";
    process.env.MOCK_LLM_A_LTV = "0.0";
    process.env.MOCK_LLM_B_AGREE = "false";
    process.env.MOCK_LLM_B_ACTION = "hold";
    process.env.MOCK_LLM_RECONCILE_AGREE = "false";
    process.env.MOCK_LLM_RECONCILE_ACTION = "deleverage";
    process.env.MOCK_LLM_RECONCILE_LTV = "0.0";

    // Run cycle: Model A wants to deleverage, Model B wants to hold. They disagree, do not reconcile, and fallback defaults to partial deleverage (target LTV: 55%) due to leverage safety doubt.
    await runAgent(0.02);

    // Clean up env vars
    delete process.env.TRIGGER_DISAGREEMENT;
    delete process.env.RECONCILE_TO_B;
    delete process.env.MOCK_LLM_A_ACTION;
    delete process.env.MOCK_LLM_A_LTV;
    delete process.env.MOCK_LLM_B_AGREE;
    delete process.env.MOCK_LLM_B_ACTION;
    delete process.env.MOCK_LLM_RECONCILE_AGREE;
    delete process.env.MOCK_LLM_RECONCILE_ACTION;
    delete process.env.MOCK_LLM_RECONCILE_LTV;

    console.log("\n=========================================");
    console.log("   SIMULATION COMPLETED SUCCESSFULLY!    ");
    console.log("=========================================");
}

main().catch(console.error);
