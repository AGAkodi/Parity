import * as ethers from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const VAULT_ABI = [
    "event MigrationExecuted(address indexed oldVenue, address indexed newVenue, uint256 amountMigrated)",
    "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
    "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)"
];

const KEEPER_ABI = [
    "event KeeperAction(string action, string reason, uint256 hfBefore, uint256 hfAfter, uint256 apySnapshot, uint256 timestamp)"
];

interface FormattedEvent {
    eventName: string;
    description: string;
    txHash: string;
    blockNumber: number;
    timestamp: number;
}

export async function indexPastEvents(
    providerUrl: string,
    vaultAddress: string,
    keeperAddress: string,
    outputFilePath?: string
): Promise<FormattedEvent[]> {
    const provider = new ethers.JsonRpcProvider(providerUrl);
    const vault = new ethers.Contract(vaultAddress, VAULT_ABI, provider);
    const keeper = new ethers.Contract(keeperAddress, KEEPER_ABI, provider);

    const latestBlock = await provider.getBlockNumber();
    const fromBlock = process.env.DEPLOYMENT_BLOCK 
        ? Number(process.env.DEPLOYMENT_BLOCK) 
        : Math.max(0, latestBlock - 5000);

    const vaultEvents = await vault.queryFilter("*", fromBlock, "latest");
    const keeperEvents = await keeper.queryFilter("*", fromBlock, "latest");

    const allEvents = [...vaultEvents, ...keeperEvents];
    // Sort events by block number and transaction index
    allEvents.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
        return a.transactionIndex - b.transactionIndex;
    });

    const formattedEvents: FormattedEvent[] = [];
    const blockCache: Record<number, number> = {};

    for (const evt of allEvents) {
        const decodedEvt = evt as ethers.EventLog;
        if (!decodedEvt.fragment) continue;

        const eventName = decodedEvt.fragment.name;
        const args = decodedEvt.args;
        const txHash = decodedEvt.transactionHash;
        const blockNumber = decodedEvt.blockNumber;

        // Fetch block timestamp with caching to avoid redundant calls
        if (!blockCache[blockNumber]) {
            const block = await provider.getBlock(blockNumber);
            blockCache[blockNumber] = block ? Number(block.timestamp) : Math.floor(Date.now() / 1000);
        }
        const timestamp = blockCache[blockNumber];

        let description = "";

        if (eventName === "Deposit") {
            const assets = Number(args.assets) / 1e6;
            description = `📥 User Deposit: ${args.owner} deposited ${assets.toFixed(2)} USDC`;
        } else if (eventName === "Withdraw") {
            const assets = Number(args.assets) / 1e6;
            description = `📤 User Withdrawal: ${args.owner} withdrew ${assets.toFixed(2)} USDC`;
        } else if (eventName === "MigrationExecuted") {
            const amount = Number(args.amountMigrated) / 1e6;
            description = `🔄 Venue Migration: Moved ${amount.toFixed(2)} USDC from ${args.oldVenue} to ${args.newVenue}`;
        } else if (eventName === "KeeperAction") {
            const action = args.action;
            const reason = args.reason;
            const hfBefore = args.hfBefore === ethers.MaxUint256 ? "Infinity" : (Number(args.hfBefore) / 1e18).toFixed(4);
            const hfAfter = args.hfAfter === ethers.MaxUint256 ? "Infinity" : (Number(args.hfAfter) / 1e18).toFixed(4);
            const apy = (Number(args.apySnapshot) / 1e18 * 100).toFixed(2);

            description = `🤖 Keeper Action [${action.toUpperCase()}]: ${reason} | HF: ${hfBefore} ➔ ${hfAfter} | Net APY: ${apy}%`;
        }

        if (description) {
            formattedEvents.push({
                eventName,
                description,
                txHash,
                blockNumber,
                timestamp
            });
        }
    }

    if (outputFilePath) {
        fs.writeFileSync(outputFilePath, JSON.stringify(formattedEvents, null, 2));
        console.log(`💾 Saved ${formattedEvents.length} indexed events to ${outputFilePath}`);
    }

    return formattedEvents;
}

// Support running directly
if (require.main === module) {
    const providerUrl = process.env.BASE_SEPOLIA_RPC_URL || "http://127.0.0.1:8545";
    const vaultAddress = process.env.VAULT_ADDRESS || "";
    const keeperAddress = process.env.KEEPER_ADDRESS || "";
    const outputFilePath = path.resolve(__dirname, "../events.json");

    if (!vaultAddress || !keeperAddress) {
        console.error("Error: VAULT_ADDRESS and KEEPER_ADDRESS must be configured in environment.");
        process.exit(1);
    }

    console.log("Starting event indexer...");
    indexPastEvents(providerUrl, vaultAddress, keeperAddress, outputFilePath)
        .then(events => {
            console.log("\nIndexed Events History:");
            events.forEach(evt => {
                const dateStr = new Date(evt.timestamp * 1000).toLocaleString();
                console.log(`[${dateStr}] ${evt.description} (Tx: ${evt.txHash.slice(0, 10)}...)`);
            });
        })
        .catch(console.error);
}
