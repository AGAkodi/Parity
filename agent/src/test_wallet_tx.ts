import { ViemWalletProvider } from "@coinbase/agentkit";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function main() {
    console.log("=========================================");
    console.log("    WALLET TRANSACTION VERIFICATION      ");
    console.log("=========================================");

    // Intercept telemetry requests to prevent outbound timeouts
    const originalFetch = global.fetch;
    global.fetch = function(input: RequestInfo | URL, init?: RequestInit) {
        const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
        if (url.includes("cca-lite.coinbase.com")) {
            return Promise.resolve(new Response(JSON.stringify({ status: "success" }), {
                status: 200,
                statusText: "OK",
                headers: new Headers({ "Content-Type": "application/json" }),
            }));
        }
        return originalFetch(input, init);
    };

    const privateKey = process.env.KEEPER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000002";
    const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

    console.log(`Connecting to Base Sepolia RPC: ${rpcUrl}`);
    console.log("Using keeper private key:", privateKey.substring(0, 10) + "...");

    const account = privateKeyToAccount(privateKey as `0x${string}`);
    // Workaround for Coinbase AgentKit ViemWalletProvider constructor bug
    // where it instantiates createPublicClient using http() with no arguments,
    // which defaults to chain.rpcUrls.default.http[0] instead of the custom transport.
    const customChain = {
        ...baseSepolia,
        rpcUrls: {
            ...baseSepolia.rpcUrls,
            default: {
                http: [rpcUrl],
            },
        },
    };
    const walletClient = createWalletClient({
        account,
        chain: customChain,
        transport: http(rpcUrl),
    });

    const walletProvider = new ViemWalletProvider(walletClient);
    const address = walletProvider.getAddress();
    console.log(`\nWallet initialized: ${address}`);
    console.log("Network:", walletProvider.getNetwork());

    // 1. Read Balance
    console.log("\nReading balance...");
    try {
        const balance = await walletProvider.getBalance();
        console.log(`✅ Native Balance: ${balance.toString()} Wei (${(Number(balance) / 1e18).toFixed(6)} ETH)`);

        if (balance === 0n) {
            console.warn("⚠️ Balance is 0. Native transfer transaction will fail due to lack of gas/funds.");
            console.warn("Please fund the keeper address or run this test against local anvil node instead.");
            return;
        }
    } catch (e: any) {
        console.error("❌ Failed to query wallet balance:", e.message || e);
        return;
    }

    // 2. Submit Test Transaction
    console.log(`\nSending self-transfer transaction of 0.0001 ETH...`);
    try {
        const txHash = await walletProvider.nativeTransfer(address as `0x${string}`, "0.0001");
        console.log(`✅ Transaction sent successfully! Hash: ${txHash}`);
        
        console.log("Waiting for block confirmation...");
        const receipt = await walletProvider.waitForTransactionReceipt(txHash);
        console.log(`✅ Transaction mined in block: ${receipt.blockNumber}`);
    } catch (e: any) {
        console.error("❌ Failed to send or confirm transaction:", e.message || e);
    }
}

main().catch(console.error);
