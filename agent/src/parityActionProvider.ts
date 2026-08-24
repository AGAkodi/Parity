import { customActionProvider, EvmWalletProvider } from "@coinbase/agentkit";
import { z } from "zod";
import { encodeFunctionData, parseAbi } from "viem";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const KEEPER_ADDRESS = process.env.KEEPER_ADDRESS;

if (!KEEPER_ADDRESS) {
    throw new Error("KEEPER_ADDRESS is not set in the environment variables");
}

const KEEPER_ABI = parseAbi([
    "function rebalance(uint256 targetLTV, uint256 numLoops, string reason, uint256 apySnapshot) external",
    "function deleverage(uint256 targetLTV, uint256 numLoops, string reason, uint256 apySnapshot) external",
    "function migrate(address venue, string reason, uint256 apySnapshot) external"
]);

export const parityActionProvider = customActionProvider<EvmWalletProvider>([
    {
        name: "rebalance",
        description: "Rebalances the Parity Vault position to a target LTV on Moonwell. Call this to loop assets and leverage up.",
        schema: z.object({
            targetLTV: z.string().describe("Target LTV scaled to 18 decimals (e.g. '700000000000000000' for 70% LTV)"),
            numLoops: z.string().describe("Number of looping iterations to perform (e.g. '5')"),
            reason: z.string().describe("Reason for executing the rebalance"),
            apySnapshot: z.string().describe("Current yield rate APY snapshot scaled to 18 decimals"),
        }),
        invoke: async (walletProvider, args) => {
            console.log(`[parityActionProvider] Invoking rebalance to targetLTV: ${args.targetLTV}, loops: ${args.numLoops}`);
            const data = encodeFunctionData({
                abi: KEEPER_ABI,
                functionName: "rebalance",
                args: [BigInt(args.targetLTV), BigInt(args.numLoops), args.reason, BigInt(args.apySnapshot)],
            });
            const txHash = await walletProvider.sendTransaction({
                to: KEEPER_ADDRESS as `0x${string}`,
                data: data,
            });
            const receipt = await walletProvider.waitForTransactionReceipt(txHash);
            return `Rebalance transaction confirmed. Hash: ${txHash}, Block: ${receipt.blockNumber}`;
        },
    },
    {
        name: "deleverage",
        description: "Deleverages the Parity Vault position on Moonwell to a target LTV (or 0 for full exit). Call this for protection or emergency deleveraging.",
        schema: z.object({
            targetLTV: z.string().describe("Target LTV scaled to 18 decimals (e.g. '0' to fully deleverage)"),
            numLoops: z.string().describe("Number of looping iterations to perform to unwind (e.g. '5')"),
            reason: z.string().describe("Reason for executing the deleverage"),
            apySnapshot: z.string().describe("Current yield rate APY snapshot scaled to 18 decimals"),
        }),
        invoke: async (walletProvider, args) => {
            console.log(`[parityActionProvider] Invoking deleverage to targetLTV: ${args.targetLTV}, loops: ${args.numLoops}`);
            const data = encodeFunctionData({
                abi: KEEPER_ABI,
                functionName: "deleverage",
                args: [BigInt(args.targetLTV), BigInt(args.numLoops), args.reason, BigInt(args.apySnapshot)],
            });
            const txHash = await walletProvider.sendTransaction({
                to: KEEPER_ADDRESS as `0x${string}`,
                data: data,
            });
            const receipt = await walletProvider.waitForTransactionReceipt(txHash);
            return `Deleverage transaction confirmed. Hash: ${txHash}, Block: ${receipt.blockNumber}`;
        },
    },
    {
        name: "migrate",
        description: "Migrates all vault USDC assets to a different yield venue (e.g. Moonwell mUSDC or Morpho USDC vault).",
        schema: z.object({
            venue: z.string().describe("Target yield venue address (e.g. Morpho vault address or Moonwell mUSDC address)"),
            reason: z.string().describe("Reason for executing the migration"),
            apySnapshot: z.string().describe("Current yield rate APY snapshot scaled to 18 decimals"),
        }),
        invoke: async (walletProvider, args) => {
            console.log(`[parityActionProvider] Invoking migrate to venue: ${args.venue}`);
            const data = encodeFunctionData({
                abi: KEEPER_ABI,
                functionName: "migrate",
                args: [args.venue as `0x${string}`, args.reason, BigInt(args.apySnapshot)],
            });
            const txHash = await walletProvider.sendTransaction({
                to: KEEPER_ADDRESS as `0x${string}`,
                data: data,
            });
            const receipt = await walletProvider.waitForTransactionReceipt(txHash);
            return `Migration transaction confirmed. Hash: ${txHash}, Block: ${receipt.blockNumber}`;
        },
    },
]);
