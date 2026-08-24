import { ViemWalletProvider } from "@coinbase/agentkit";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { parityActionProvider } from "./parityActionProvider";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function main() {
    console.log("=========================================");
    console.log("    AGENTKIT CUSTOM PROVIDER TEST        ");
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

    const privateKey = process.env.KEEPER_PRIVATE_KEY || "";
    const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "http://127.0.0.1:8545";

    if (!privateKey) {
        console.error("Missing KEEPER_PRIVATE_KEY in .env");
        return;
    }

    console.log(`Connecting to RPC: ${rpcUrl}`);
    console.log("Using keeper private key:", privateKey.substring(0, 10) + "...");

    const account = privateKeyToAccount(privateKey as `0x${string}`);
    // Workaround for Coinbase AgentKit ViemWalletProvider constructor bug
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
    console.log(`Wallet initialized: ${address}`);

    // Retrieve actions from our provider
    console.log("\nRegistering parityActionProvider and fetching actions...");
    const actions = parityActionProvider.getActions(walletProvider);

    console.log(`Found ${actions.length} custom actions:`);
    for (const action of actions) {
        console.log(` - ${action.name}: ${action.description}`);
    }

    // Find the rebalance action
    const rebalanceAction = actions.find(a => a.name.endsWith("rebalance"));
    if (!rebalanceAction) {
        console.error("❌ Rebalance action not found in provider!");
        return;
    }

    // Invoke the rebalance action
    console.log("\nInvoking rebalance action manually...");
    try {
        const result = await rebalanceAction.invoke({
            targetLTV: "700000000000000000", // 70% LTV
            numLoops: "5",
            reason: "Testing manual rebalance from AgentKit provider",
            apySnapshot: "50000000000000000" // 5% APY
        });
        console.log(`✅ Success: ${result}`);
    } catch (e: any) {
        console.error("❌ Failed to invoke rebalance:", e.message || e);
    }
}

main().catch(console.error);
