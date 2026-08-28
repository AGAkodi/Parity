import * as ethers from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { ChatGroq } from "@langchain/groq";
import { z } from "zod";

const LOG_FILE = path.resolve(__dirname, "../agent.log");

export function log(message: string, type: "info" | "warn" | "error" = "info") {
    const timestamp = new Date().toISOString();
    const prefix = type === "error" ? "❌ [ERROR]" : type === "warn" ? "⚠️ [WARN]" : "ℹ️ [INFO]";
    const cleanMessage = message.replace(/^\n/, "");
    const fileFormatted = `[${timestamp}] ${prefix} ${cleanMessage}`;
    const consoleFormatted = message.startsWith("\n") ? `\n[${timestamp}] ${prefix} ${cleanMessage}` : `[${timestamp}] ${prefix} ${message}`;

    if (type === "error") {
        console.error(consoleFormatted);
    } else if (type === "warn") {
        console.warn(consoleFormatted);
    } else {
        console.log(consoleFormatted);
    }

    try {
        fs.appendFileSync(LOG_FILE, fileFormatted + "\n");
    } catch (e) {
        console.error(`Failed to write to log file: ${e}`);
    }
}

const agentLog = log;

// Load environment variables from the root .env file
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// Minimal ABIs for contract interactions
const VAULT_ABI = [
    "function asset() external view returns (address)",
    "function activeVenue() external view returns (address)",
    "function getHealthFactor() external view returns (uint256)",
    "function totalAssets() external view returns (uint256)",
    "function keeper() external view returns (address)"
];

const KEEPER_ABI = [
    "function keeper() external view returns (address)",
    "function paused() external view returns (bool)",
    "function rebalance(uint256 targetLTV, uint256 numLoops, string reason, uint256 apySnapshot) external",
    "function deleverage(uint256 targetLTV, uint256 numLoops, string reason, uint256 apySnapshot) external",
    "function migrate(address venue, string reason, uint256 apySnapshot) external"
];

const MTOKEN_ABI = [
    "function supplyRatePerTimestamp() external view returns (uint256)",
    "function borrowRatePerTimestamp() external view returns (uint256)",
    "function getCash() external view returns (uint256)",
    "function totalBorrows() external view returns (uint256)",
    "function totalReserves() external view returns (uint256)",
    "function balanceOf(address) external view returns (uint256)",
    "function borrowBalanceStored(address) external view returns (uint256)",
    "function exchangeRateStored() external view returns (uint256)"
];

const ERC20_ABI = [
    "function balanceOf(address) external view returns (uint256)",
    "function decimals() external view returns (uint8)"
];

const SECONDS_PER_YEAR = 31536000;

export interface LLMInput {
    activeVenue: string;
    mUSDCAddress: string;
    healthFactor: number;
    currentLTV: number;
    supplyAPY: number;
    borrowAPY: number;
    netMoonwellAPY: number;
    utilization: number;
    morphoAPY: number;
    gasCostEstimateETH: string;
    targetLTV: number;
    safetyHFThreshold: number;
}

export interface ActionProposal {
    action: "hold" | "rebalance" | "deleverage" | "migrate";
    reasoning: string;
    confidence: number;
    targetLTV?: number | null;
    venueAddress?: string | null;
}

export interface ActionReview {
    agree: boolean;
    action: "hold" | "rebalance" | "deleverage" | "migrate";
    reasoning: string;
    confidence: number;
    targetLTV?: number | null;
    venueAddress?: string | null;
}

export interface ReconciliationResult {
    agreeWithCounterProposal: boolean;
    action: "hold" | "rebalance" | "deleverage" | "migrate";
    reasoning: string;
    confidence: number;
    targetLTV?: number | null;
    venueAddress?: string | null;
}

const modelASystemPrompt = `You are Parity's primary yield optimizer agent (Model A).
Parity is an autonomous leveraged yield agent operating on Base Sepolia.
Your goal is to optimize yield for USDC vault depositors between Moonwell and Morpho while managing leverage risks.

Current Protocol Parameters and Safe State Guidelines:
1. Target LTV (Loan-To-Value) on Moonwell: {targetLTV}.
2. Active Yield Venue: Moonwell (leveraged USDC position) or Morpho (single-sided USDC yield vault).
3. If active venue is Moonwell, you maintain a leveraged position (borrowing USDC to supply more USDC).
   - Leverage Factor = 1 / (1 - LTV)
   - Net Moonwell APY = Supply APY * Leverage Factor - Borrow APY * (Leverage Factor - 1)
4. Key Risks on Moonwell:
   - High utilization (> 85%) leads to high borrow rates and interest rate spikes.
   - Inverted spread (Supply APY < Borrow APY) leads to negative yield on leverage. If this happens, you should deleverage to 0.
5. Migration logic:
   - Switch to the other venue if its yield is higher by at least 0.5% (0.005) after estimating gas costs.
6. Available Actions:
   - "hold": Maintain the current position.
   - "rebalance": Adjust LTV to target LTV ({targetLTV}) if current LTV deviates significantly (e.g. by > 2%).
   - "deleverage": Reduce leverage (target LTV = 0 or safety LTV = 0.55) to mitigate risk (e.g. spread inverted or high utilization).
   - "migrate": Switch the active venue to optimize yield.

Given the live inputs, propose the best action. You must return your proposal matching the structured output format requested.`;

const modelBSystemPrompt = `You are Parity's independent risk reviewer agent (Model B).
Parity is an autonomous leveraged yield agent operating on Base Sepolia.
Your job is to independently review Model A's proposed action and reasoning.
Ensure that Model A's proposal is safe, yield-accretive, and adheres to protocol constraints:
- Inverted spread (Supply APY < Borrow APY) or High Utilization (> 85%) on Moonwell should trigger deleveraging.
- Venue migration should only occur if the other venue yields at least 0.5% (0.005) more than the net yield of the current venue, accounting for gas costs.
- Rebalancing upward should only happen if health factor is safe, spread is healthy, and current LTV is below target.

Review Model A's proposal and the live inputs. Either agree or propose a counter-action with clear reasoning. You must return your proposal matching the structured output format requested.`;

const reconciliationSystemPrompt = `You are Model A in reconciliation phase. You must review Model B's feedback and decide whether to change your position to match Model B's counter-proposal or stick to your original action. You must return your decision matching the structured output format requested.`;

export function formatLiveInputs(inputs: LLMInput): string {
    return `Live Market and Position Inputs:
- Active Venue: ${inputs.activeVenue === inputs.mUSDCAddress ? "Moonwell" : "Morpho"}
- Current Health Factor: ${inputs.healthFactor === Infinity ? "Infinity" : inputs.healthFactor.toFixed(4)} (Safety Threshold: ${inputs.safetyHFThreshold})
- Current LTV: ${(inputs.currentLTV * 100).toFixed(2)}%
- Moonwell USDC Supply APY: ${(inputs.supplyAPY * 100).toFixed(2)}%
- Moonwell USDC Borrow APY: ${(inputs.borrowAPY * 100).toFixed(2)}%
- Moonwell USDC Net Leveraged APY: ${(inputs.netMoonwellAPY * 100).toFixed(2)}%
- Moonwell USDC Utilization: ${(inputs.utilization * 100).toFixed(2)}%
- Morpho Flagship USDC APY: ${(inputs.morphoAPY * 100).toFixed(2)}%
- Estimated Gas Cost: ${inputs.gasCostEstimateETH} ETH
- Target LTV: ${(inputs.targetLTV * 100).toFixed(2)}%`;
}

export async function getModelAProposal(
    inputs: LLMInput,
    modelName: string,
    apiKey?: string
): Promise<ActionProposal> {
    if (!apiKey || process.env.MOCK_LLM === "true") {
        log(`[MOCK MODEL A] Simulating proposal for ${modelName}...`);
        
        if (process.env.MOCK_LLM_A_ACTION) {
            return {
                action: process.env.MOCK_LLM_A_ACTION as any,
                reasoning: "Forced Mock Model A action",
                confidence: 0.99,
                targetLTV: process.env.MOCK_LLM_A_LTV ? Number(process.env.MOCK_LLM_A_LTV) : undefined,
                venueAddress: process.env.MOCK_LLM_A_VENUE
            };
        }
        
        if (inputs.activeVenue === inputs.mUSDCAddress) {
            const isSpreadInverted = inputs.supplyAPY < inputs.borrowAPY && inputs.currentLTV > 0.05;
            const isHighUtilization = inputs.utilization > 0.85;
            if (isSpreadInverted || isHighUtilization) {
                return {
                    action: "deleverage",
                    reasoning: `Mock Model A: Leverage safety concern. Spread inverted or high utilization on Moonwell. Current LTV is ${(inputs.currentLTV * 100).toFixed(2)}%.`,
                    confidence: 0.95,
                    targetLTV: 0.0
                };
            }
            
            const migrationThresholdOffset = 0.005;
            if (inputs.morphoAPY > inputs.netMoonwellAPY + migrationThresholdOffset) {
                return {
                    action: "migrate",
                    reasoning: `Mock Model A: Morpho APY (${(inputs.morphoAPY * 100).toFixed(2)}%) is higher than Moonwell net APY (${(inputs.netMoonwellAPY * 100).toFixed(2)}%) + offset. Suggesting migration to Morpho.`,
                    confidence: 0.90,
                    venueAddress: process.env.MORPHO_VAULT_ADDRESS || ""
                };
            }

            if (inputs.currentLTV < inputs.targetLTV - 0.02) {
                return {
                    action: "rebalance",
                    reasoning: `Mock Model A: Opportunity to leverage up. Current LTV ${(inputs.currentLTV * 100).toFixed(2)}% is below target LTV ${(inputs.targetLTV * 100).toFixed(2)}%.`,
                    confidence: 0.85,
                    targetLTV: inputs.targetLTV
                };
            }
        } else {
            const migrationThresholdOffset = 0.005;
            if (inputs.netMoonwellAPY > inputs.morphoAPY + migrationThresholdOffset) {
                return {
                    action: "migrate",
                    reasoning: `Mock Model A: Moonwell net APY (${(inputs.netMoonwellAPY * 100).toFixed(2)}%) is higher than Morpho APY (${(inputs.morphoAPY * 100).toFixed(2)}%) + offset. Suggesting migration back to Moonwell.`,
                    confidence: 0.92,
                    venueAddress: inputs.mUSDCAddress
                };
            }
        }
        return {
            action: "hold",
            reasoning: "Mock Model A: Market rates are stable and position is healthy. No action required.",
            confidence: 0.90
        };
    }

    const chat = new ChatGroq({
        apiKey,
        model: modelName,
        temperature: 0,
    });
    const schema = z.object({
        action: z.enum(["hold", "rebalance", "deleverage", "migrate"]).describe("Action to propose: 'hold', 'rebalance', 'deleverage', or 'migrate'"),
        reasoning: z.string().describe("Detailed reasoning for proposing this action given the market inputs"),
        confidence: z.number().min(0).max(1).describe("Confidence score in your recommendation"),
        targetLTV: z.number().nullable().optional().describe("If rebalancing/deleveraging, the target LTV (e.g. 0.70 or 0.0)"),
        venueAddress: z.string().nullable().optional().describe("If migrating, the target venue address")
    });
    const structuredChat = chat.withStructuredOutput(schema);
    const systemPrompt = modelASystemPrompt.replace(/{targetLTV}/g, inputs.targetLTV.toString());
    const formattedInputs = formatLiveInputs(inputs);
    
    return await structuredChat.invoke([
        { role: "system", content: systemPrompt },
        { role: "user", content: formattedInputs }
    ]);
}

export async function getModelBReview(
    inputs: LLMInput,
    modelName: string,
    modelAProposal: ActionProposal,
    apiKey?: string
): Promise<ActionReview> {
    if (!apiKey || process.env.MOCK_LLM === "true") {
        log(`[MOCK MODEL B] Simulating review of Model A's proposal for ${modelName}...`);
        
        if (process.env.MOCK_LLM_B_ACTION) {
            return {
                agree: process.env.MOCK_LLM_B_AGREE === "true",
                action: process.env.MOCK_LLM_B_ACTION as any,
                reasoning: "Forced Mock Model B review/counter-proposal",
                confidence: 0.99,
                targetLTV: process.env.MOCK_LLM_B_LTV ? Number(process.env.MOCK_LLM_B_LTV) : undefined,
                venueAddress: process.env.MOCK_LLM_B_VENUE
            };
        }
        
        if (process.env.TRIGGER_DISAGREEMENT === "true" && modelAProposal.action === "rebalance") {
            return {
                agree: false,
                action: "hold",
                reasoning: "Mock Model B: Disagree with rebalancing. I suggest holding first to observe gas and market volatility.",
                confidence: 0.80
            };
        }

        return {
            agree: true,
            action: modelAProposal.action,
            reasoning: `Mock Model B: Agree with Model A's proposal. The proposed action ${modelAProposal.action} is safe and optimal based on current inputs.`,
            confidence: 0.90,
            targetLTV: modelAProposal.targetLTV,
            venueAddress: modelAProposal.venueAddress
        };
    }

    const chat = new ChatGroq({
        apiKey,
        model: modelName,
        temperature: 0,
    });
    const schema = z.object({
        agree: z.boolean().describe("Whether you agree with Model A's proposed action"),
        action: z.enum(["hold", "rebalance", "deleverage", "migrate"]).describe("The proposed action. If agree is true, this must match Model A's action. If false, this is your counter-proposal."),
        reasoning: z.string().describe("Explanation of why you agree or why you are countering with a different action"),
        confidence: z.number().min(0).max(1).describe("Confidence score in your recommendation"),
        targetLTV: z.number().nullable().optional().describe("If rebalancing/deleveraging, the target LTV"),
        venueAddress: z.string().nullable().optional().describe("If migrating, the target venue address")
    });
    const structuredChat = chat.withStructuredOutput(schema);
    const systemPrompt = modelBSystemPrompt;
    const formattedInputs = formatLiveInputs(inputs) + `\n\nModel A Proposal:
- Action: ${modelAProposal.action}
- Reasoning: ${modelAProposal.reasoning}
- Confidence: ${modelAProposal.confidence}
- Target LTV: ${modelAProposal.targetLTV !== undefined ? modelAProposal.targetLTV : "N/A"}
- Venue Address: ${modelAProposal.venueAddress || "N/A"}`;

    return await structuredChat.invoke([
        { role: "system", content: systemPrompt },
        { role: "user", content: formattedInputs }
    ]);
}

export async function getReconciliation(
    inputs: LLMInput,
    modelName: string,
    modelAProposal: ActionProposal,
    modelBReview: ActionReview,
    apiKey?: string
): Promise<ReconciliationResult> {
    if (!apiKey || process.env.MOCK_LLM === "true") {
        log(`[MOCK RECONCILIATION] Simulating Model A reconciliation for ${modelName}...`);
        if (process.env.MOCK_LLM_RECONCILE_AGREE !== undefined) {
            return {
                agreeWithCounterProposal: process.env.MOCK_LLM_RECONCILE_AGREE === "true",
                action: (process.env.MOCK_LLM_RECONCILE_ACTION as any) || modelBReview.action,
                reasoning: "Forced Mock Reconciliation decision",
                confidence: 0.99,
                targetLTV: process.env.MOCK_LLM_RECONCILE_LTV ? Number(process.env.MOCK_LLM_RECONCILE_LTV) : undefined,
                venueAddress: process.env.MOCK_LLM_RECONCILE_VENUE
            };
        }
        if (process.env.RECONCILE_TO_B === "true") {
            return {
                agreeWithCounterProposal: true,
                action: modelBReview.action,
                reasoning: `Mock Model A (Reconciliation): After reviewing Model B's concern about volatility, I agree to change my action to ${modelBReview.action}.`,
                confidence: 0.85,
                targetLTV: modelBReview.targetLTV,
                venueAddress: modelBReview.venueAddress
            };
        } else {
            return {
                agreeWithCounterProposal: false,
                action: modelAProposal.action,
                reasoning: "Mock Model A (Reconciliation): I still believe my original proposal to rebalance is correct. Maintaining original position.",
                confidence: 0.90,
                targetLTV: modelAProposal.targetLTV,
                venueAddress: modelAProposal.venueAddress
            };
        }
    }

    const chat = new ChatGroq({
        apiKey,
        model: modelName,
        temperature: 0,
    });
    const schema = z.object({
        agreeWithCounterProposal: z.boolean().describe("Whether you change your mind and now agree with Model B's counter-proposal"),
        action: z.enum(["hold", "rebalance", "deleverage", "migrate"]).describe("Your final action. If agreeWithCounterProposal is true, this must match Model B's action. If false, this is your original or adjusted action."),
        reasoning: z.string().describe("Detailed reasoning for your final stance after reviewing Model B's counter-proposal"),
        confidence: z.number().min(0).max(1).describe("Confidence score in your final recommendation"),
        targetLTV: z.number().nullable().optional().describe("If rebalancing/deleveraging, the target LTV"),
        venueAddress: z.string().nullable().optional().describe("If migrating, the target venue address")
    });
    const structuredChat = chat.withStructuredOutput(schema);
    const systemPrompt = reconciliationSystemPrompt;
    const formattedPrompt = formatLiveInputs(inputs) + `\n\nYour Original Proposal:
- Action: ${modelAProposal.action}
- Reasoning: ${modelAProposal.reasoning}
- Target LTV: ${modelAProposal.targetLTV !== undefined ? modelAProposal.targetLTV : "N/A"}
- Venue Address: ${modelAProposal.venueAddress || "N/A"}

Model B Counter-Proposal:
- Action: ${modelBReview.action}
- Reasoning: ${modelBReview.reasoning}
- Target LTV: ${modelBReview.targetLTV !== undefined ? modelBReview.targetLTV : "N/A"}
- Venue Address: ${modelBReview.venueAddress || "N/A"}`;

    return await structuredChat.invoke([
        { role: "system", content: systemPrompt },
        { role: "user", content: formattedPrompt }
    ]);
}

export async function runMonitoringCycle(
    vaultName: string,
    providerUrl: string,
    keeperPrivateKey: string,
    vaultAddress: string,
    keeperAddress: string,
    mUSDCAddress: string,
    targetLTV: number,          // e.g. 0.70 (70% LTV)
    safetyHFThreshold: number,  // e.g. 1.10
    morphoAPYOverride?: number  // configured mock Morpho APY
) {
    const log = (msg: string, type: "info" | "warn" | "error" = "info") => {
        agentLog(`[${vaultName}] ${msg}`, type);
    };

    log(`\n--- Starting Monitoring Cycle ---`);

    // 1. Initialize Ethers connections
    const provider = new ethers.JsonRpcProvider(providerUrl);
    const wallet = new ethers.Wallet(keeperPrivateKey, provider);

    const vault = new ethers.Contract(vaultAddress, VAULT_ABI, provider);
    const keeperContract = new ethers.Contract(keeperAddress, KEEPER_ABI, wallet);
    const mUSDC = new ethers.Contract(mUSDCAddress, MTOKEN_ABI, provider);

    let isPaused = false;
    let activeVenue = "";
    let healthFactor = Infinity;
    let borrowed = 0n;
    let supplied = 0n;
    let currentLTV = 0;
    let supplyAPY = 0;
    let borrowAPY = 0;
    let utilization = 0;
    let morphoAPY = 0;
    let netMoonwellAPY = 0;
    let apySnapshot = 0n;

    // 2. Fetch live Vault and Moonwell parameters with robust try/catch
    try {
        // Verify Keeper Contract Paused State
        isPaused = await keeperContract.paused();
        if (isPaused) {
            log("Keeper contract is currently PAUSED. Skipping execution.", "warn");
            return;
        }

        activeVenue = await vault.activeVenue();
        const rawHF = await vault.getHealthFactor();
        healthFactor = rawHF === ethers.MaxUint256 ? Infinity : Number(rawHF) / 1e18;

        const mTokenBalance = await mUSDC.balanceOf(vaultAddress);
        const exchangeRate = await mUSDC.exchangeRateStored();
        borrowed = await mUSDC.borrowBalanceStored(vaultAddress);

        supplied = (BigInt(mTokenBalance) * BigInt(exchangeRate)) / (10n ** 18n);
        currentLTV = supplied > 0n ? Number(borrowed) / Number(supplied) : 0;

        const supplyRate = await mUSDC.supplyRatePerTimestamp();
        const borrowRate = await mUSDC.borrowRatePerTimestamp();

        const cash = await mUSDC.getCash();
        const totalBorrows = await mUSDC.totalBorrows();
        const reserves = await mUSDC.totalReserves();

        // Compounding APY Calculations
        supplyAPY = Math.pow(1 + Number(supplyRate) / 1e18, SECONDS_PER_YEAR) - 1;
        borrowAPY = Math.pow(1 + Number(borrowRate) / 1e18, SECONDS_PER_YEAR) - 1;

        // Net Leveraged APY on Moonwell
        const leverageFactor = 1 / (1 - currentLTV);
        netMoonwellAPY = supplyAPY * leverageFactor - borrowAPY * (leverageFactor - 1);

        // Utilization calculation
        const denom = Number(cash) + Number(totalBorrows) - Number(reserves);
        utilization = denom > 0 ? Number(totalBorrows) / denom : 0;

        // Fetch Morpho APY (Fallback to mock override or configured mock in .env)
        morphoAPY = morphoAPYOverride !== undefined ? morphoAPYOverride : Number(process.env.MORPHO_APY_MOCK || "0.047");

        log(`Vault Active Venue: ${activeVenue === mUSDCAddress ? "Moonwell" : "Morpho"}`);
        log(`Vault Health Factor: ${healthFactor === Infinity ? "Infinity" : healthFactor.toFixed(4)}`);
        log(`Vault Current LTV: ${(currentLTV * 100).toFixed(2)}%`);
        log(`Moonwell USDC Utilization: ${(utilization * 100).toFixed(2)}%`);
        log(`Moonwell USDC Supply APY: ${(supplyAPY * 100).toFixed(2)}%`);
        log(`Moonwell USDC Borrow APY: ${(borrowAPY * 100).toFixed(2)}%`);
        log(`Moonwell Net Leveraged APY: ${(netMoonwellAPY * 100).toFixed(2)}%`);
        log(`Morpho Flagship USDC APY: ${(morphoAPY * 100).toFixed(2)}%`);

        const rawApy = activeVenue === mUSDCAddress ? netMoonwellAPY : morphoAPY;
        apySnapshot = ethers.parseEther(Math.max(0, rawApy).toFixed(18));

    } catch (readError: any) {
        log(`RPC read error in monitoring cycle: ${readError.message || readError}`, "error");
        log("Treating health factor as unsafe due to read failure. Initiating fallback safety deleverage...", "warn");

        try {
            // Target LTV is 0.55 (safe zone), 5 loops.
            const safeTargetLTV = ethers.parseEther("0.55");
            const fallbackApySnapshot = ethers.parseEther("0.0");
            const nonce = await provider.getTransactionCount(wallet.address, "latest");
            log(`Sending fallback safety deleverage transaction (target LTV: 55%)...`);
            const tx = await keeperContract.deleverage(
                safeTargetLTV,
                5,
                `[${vaultName}] Fallback safety deleverage due to RPC read failure: ${readError.message || "Unknown error"}`,
                fallbackApySnapshot,
                { nonce }
            );
            log(`Fallback deleverage transaction sent: ${tx.hash}`);
            await tx.wait();
            log("Fallback deleverage transaction confirmed successfully.");
        } catch (txError: any) {
            log(`Fallback safety deleverage transaction failed to execute: ${txError.message || txError}`, "error");
        }
        return;
    }

    // 3. Evaluate Decision Tree
    log("Evaluating Decision Tree...");

    // Rule 1: Emergency Deleverage (Health Factor < Safety Threshold)
    if (activeVenue === mUSDCAddress && healthFactor < safetyHFThreshold && borrowed > 0n) {
        log(`🚨 EMERGENCY: Health Factor (${healthFactor.toFixed(4)}) is below safety threshold (${safetyHFThreshold})!`, "warn");
        
        try {
            // Target LTV is 0.55 (safe zone)
            const safeTargetLTV = ethers.parseEther("0.55");
            const nonce = await provider.getTransactionCount(wallet.address, "latest");
            const tx = await keeperContract.deleverage(
                safeTargetLTV,
                5,
                `[${vaultName}] Emergency deleverage: HF (${healthFactor.toFixed(3)}) < ${safetyHFThreshold}`,
                apySnapshot,
                { nonce }
            );
            log(`Transaction sent: ${tx.hash}`);
            await tx.wait();
            log("Emergency deleverage transaction confirmed.");
        } catch (e: any) {
            log(`Emergency deleverage transaction failed: ${e.message || e}`, "error");
        }
        return;
    }

    // Fetch fee data to dynamically estimate gas costs
    let gasCostEstimateETH = "0";
    try {
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || 0n;
        // Standard rebalance gas limit is ~500,000 gas
        const estimatedGasLimit = 500000n;
        const estimatedGasCostWei = gasPrice * estimatedGasLimit;
        gasCostEstimateETH = ethers.formatEther(estimatedGasCostWei);
    } catch (e: any) {
        log(`Failed to estimate gas cost dynamically: ${e.message || e}`, "warn");
    }

    // Prepare inputs to feed into the models
    const liveInputs: LLMInput = {
        activeVenue,
        mUSDCAddress,
        healthFactor,
        currentLTV,
        supplyAPY,
        borrowAPY,
        netMoonwellAPY,
        utilization,
        morphoAPY,
        gasCostEstimateETH,
        targetLTV,
        safetyHFThreshold
    };

    // Consult the dual-model consensus layer
    const groqApiKey = process.env.GROQ_API_KEY || "";
    const groqModelA = process.env.GROQ_MODEL_A || "openai/gpt-oss-20b";
    const groqModelB = process.env.GROQ_MODEL_B || "openai/gpt-oss-120b";

    log(`Consulting dual-model consensus layer (A: ${groqModelA}, B: ${groqModelB})...`);
    let modelAProposal: ActionProposal;
    let modelBReview: ActionReview;

    try {
        modelAProposal = await getModelAProposal(liveInputs, groqModelA, groqApiKey);
        log(`[Model A Proposal]: Action: "${modelAProposal.action}", Confidence: ${modelAProposal.confidence}`);
        log(`[Model A Reasoning]: ${modelAProposal.reasoning}`);

        modelBReview = await getModelBReview(liveInputs, groqModelB, modelAProposal, groqApiKey);
        log(`[Model B Review]: Agree: ${modelBReview.agree}, Action: "${modelBReview.action}", Confidence: ${modelBReview.confidence}`);
        log(`[Model B Reasoning]: ${modelBReview.reasoning}`);
    } catch (e: any) {
        log(`Groq consensus query failed or timed out: ${e.message || e}`, "error");
        log(`Defaulting to HOLD (no action taken) due to model query failure.`, "warn");
        return;
    }

    let finalAction = "hold";
    let finalReason = "";
    let finalTargetLTV = targetLTV;
    let finalVenueAddress = "";

    if (modelBReview.agree && modelAProposal.action === modelBReview.action) {
        log(`✅ Model A and Model B AGREE on action: "${modelAProposal.action}"`);
        finalAction = modelAProposal.action;
        finalReason = `Model A: ${modelAProposal.reasoning} | Model B: ${modelBReview.reasoning}`;
        finalTargetLTV = (modelAProposal.targetLTV !== undefined && modelAProposal.targetLTV !== null) ? modelAProposal.targetLTV : targetLTV;
        finalVenueAddress = modelAProposal.venueAddress || "";
    } else {
        log(`⚠️ Model A and Model B DISAGREE. Proposing reconciliation pass...`);
        try {
            const reconciliation = await getReconciliation(
                liveInputs,
                groqModelA,
                modelAProposal,
                modelBReview,
                groqApiKey
            );
            log(`[Reconciliation Result]: Agree with counter-proposal: ${reconciliation.agreeWithCounterProposal}, Action: "${reconciliation.action}"`);
            log(`[Reconciliation Reasoning]: ${reconciliation.reasoning}`);

            if (reconciliation.agreeWithCounterProposal && reconciliation.action === modelBReview.action) {
                log(`✅ Agreement reached after reconciliation pass! Action: "${reconciliation.action}"`);
                finalAction = reconciliation.action;
                finalReason = `Model A (Reconciled): ${reconciliation.reasoning} | Model B: ${modelBReview.reasoning}`;
                finalTargetLTV = (reconciliation.targetLTV !== undefined && reconciliation.targetLTV !== null) ? reconciliation.targetLTV : 
                                 ((modelBReview.targetLTV !== undefined && modelBReview.targetLTV !== null) ? modelBReview.targetLTV : targetLTV);
                finalVenueAddress = reconciliation.venueAddress || modelBReview.venueAddress || "";
            } else {
                log(`❌ Still no agreement after reconciliation pass. Defaulting to safer action.`);
                const doubtInvolvesLeverageSafety = modelAProposal.action === "deleverage" || modelBReview.action === "deleverage";
                
                if (doubtInvolvesLeverageSafety) {
                    log(`Leverage safety doubt detected. Defaulting to partial deleverage (target LTV: 55%).`);
                    finalAction = "deleverage";
                    finalTargetLTV = 0.55;
                    finalReason = `Disagreement Fallback (Deleverage): Model A proposed ${modelAProposal.action} (Reason: ${modelAProposal.reasoning}), Model B proposed ${modelBReview.action} (Reason: ${modelBReview.reasoning}).`;
                } else {
                    log(`No leverage safety doubt detected. Defaulting to HOLD (no action taken).`);
                    finalAction = "hold";
                    finalReason = `Disagreement Fallback (Hold): Model A proposed ${modelAProposal.action} (Reason: ${modelAProposal.reasoning}), Model B proposed ${modelBReview.action} (Reason: ${modelBReview.reasoning}).`;
                }
            }
        } catch (e: any) {
            log(`Error during reconciliation pass: ${e.message || e}`, "error");
            log(`Defaulting to HOLD (no action taken) due to reconciliation failure.`, "warn");
            return;
        }
    }

    // Step 5: Execute action
    if (finalAction === "hold") {
        log(`✅ Decision outcome: HOLD. No action executed. Reason: ${finalReason}`);
        return;
    }

    if (finalAction === "rebalance") {
        log(`📈 OPPORTUNITY: Executing Rebalance to target LTV: ${(finalTargetLTV * 100).toFixed(0)}%`);
        try {
            const targetLTVWei = ethers.parseEther(finalTargetLTV.toFixed(18));
            const nonce = await provider.getTransactionCount(wallet.address, "latest");
            const tx = await keeperContract.rebalance(
                targetLTVWei,
                5,
                `[${vaultName}] ${finalReason}`,
                apySnapshot,
                { nonce }
            );
            log(`Rebalance transaction sent: ${tx.hash}`);
            await tx.wait();
            log("Rebalance transaction confirmed.");
        } catch (e: any) {
            log(`Rebalance transaction failed: ${e.message || e}`, "error");
        }
    } else if (finalAction === "deleverage") {
        log(`🚨 PROTECTION: Executing Deleverage to LTV: ${(finalTargetLTV * 100).toFixed(0)}%`);
        try {
            const targetLTVWei = ethers.parseEther(finalTargetLTV.toFixed(18));
            const nonce = await provider.getTransactionCount(wallet.address, "latest");
            const tx = await keeperContract.deleverage(
                targetLTVWei,
                5,
                `[${vaultName}] ${finalReason}`,
                apySnapshot,
                { nonce }
            );
            log(`Deleverage transaction sent: ${tx.hash}`);
            await tx.wait();
            log("Deleverage transaction confirmed.");
        } catch (e: any) {
            log(`Deleverage transaction failed: ${e.message || e}`, "error");
        }
    } else if (finalAction === "migrate") {
        let targetVenue = finalVenueAddress;
        if (!targetVenue) {
            targetVenue = activeVenue === mUSDCAddress ? (process.env.MORPHO_VAULT_ADDRESS || "") : mUSDCAddress;
        }

        if (!targetVenue) {
            log("Migration failed: Target venue address is not set or resolved.", "error");
            return;
        }

        log(`🚀 MIGRATION: Executing Migration to venue: ${targetVenue === mUSDCAddress ? "Moonwell" : "Morpho"}`);
        try {
            const nonce = await provider.getTransactionCount(wallet.address, "latest");
            const tx = await keeperContract.migrate(
                targetVenue,
                `[${vaultName}] ${finalReason}`,
                apySnapshot,
                { nonce }
            );
            log(`Migration transaction sent: ${tx.hash}`);
            await tx.wait();
            log("Migration transaction confirmed.");
        } catch (e: any) {
            log(`Migration transaction failed: ${e.message || e}`, "error");
        }
    }
}

// Automatically start monitoring if file is run directly (not imported)
if (require.main === module) {
    const providerUrl = process.env.BASE_SEPOLIA_RPC_URL || "http://127.0.0.1:8545";
    const keeperPrivateKey = process.env.KEEPER_PRIVATE_KEY || "";
    const mUSDCAddress = process.env.MOONWELL_MUSDC || "";

    if (!keeperPrivateKey || !mUSDCAddress) {
        log("Missing configuration: Ensure KEEPER_PRIVATE_KEY and MOONWELL_MUSDC are configured.", "error");
        process.exit(1);
    }

    // Configure vaults to monitor
    const vaults = [
        {
            name: "Aggressive",
            vaultAddress: process.env.VAULT_ADDRESS_AGGRESSIVE || process.env.VAULT_ADDRESS || "",
            keeperAddress: process.env.KEEPER_ADDRESS_AGGRESSIVE || process.env.KEEPER_ADDRESS || "",
            targetLTV: Number(process.env.TARGET_LTV_AGGRESSIVE || "0.70"),
            safetyHFThreshold: Number(
                process.env.SAFETY_HF_THRESHOLD_AGGRESSIVE || 
                process.env.HEALTH_FACTOR_SAFETY_THRESHOLD || 
                "1.10"
            )
        },
        {
            name: "Conservative",
            vaultAddress: process.env.VAULT_ADDRESS_CONSERVATIVE || "",
            keeperAddress: process.env.KEEPER_ADDRESS_CONSERVATIVE || "",
            targetLTV: Number(process.env.TARGET_LTV_CONSERVATIVE || "0.50"),
            safetyHFThreshold: Number(
                process.env.SAFETY_HF_THRESHOLD_CONSERVATIVE || 
                process.env.HEALTH_FACTOR_SAFETY_THRESHOLD || 
                "1.10"
            )
        }
    ].filter(v => v.vaultAddress && v.keeperAddress);

    if (vaults.length === 0) {
        log("No vaults configured. Ensure VAULT_ADDRESS and KEEPER_ADDRESS are set.", "error");
        process.exit(1);
    }

    // Periodic polling setup
    const intervalSeconds = Number(process.env.POLLING_INTERVAL || "30");
    log(`Starting Parity Keeper Agent (Polling every ${intervalSeconds} seconds)...`);
    log(`Monitored Vaults: ${vaults.map(v => `${v.name} (${v.vaultAddress.slice(0, 6)}...)`).join(", ")}`);

    const run = async () => {
        for (const v of vaults) {
            try {
                await runMonitoringCycle(
                    v.name,
                    providerUrl,
                    keeperPrivateKey,
                    v.vaultAddress,
                    v.keeperAddress,
                    mUSDCAddress,
                    v.targetLTV,
                    v.safetyHFThreshold
                );
            } catch (e: any) {
                log(`[${v.name}] RPC or transaction failure in monitoring cycle: ${e.message || e}`, "error");
            }
            // Wait 2 seconds between vaults to prevent rate limits
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    };

    run();
    setInterval(run, intervalSeconds * 1000);
}
