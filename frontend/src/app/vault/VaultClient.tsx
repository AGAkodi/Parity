"use client";

import { 
  useReadContract, 
  useAccount, 
  useConnect, 
  useDisconnect, 
  useSwitchChain, 
  useWriteContract, 
  useWaitForTransactionReceipt,
  usePublicClient 
} from "wagmi";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Activity, Shield, ArrowUpRight, CheckCircle2, ChevronRight, History } from "lucide-react";

// Client-side environment variables configured on Base Sepolia
const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as `0x${string}`;
const MOONWELL_MUSDC = (process.env.NEXT_PUBLIC_MOONWELL_MUSDC || "0x7B35C6AddbB9bb30c640A5D8ae4ecD42BFcD2C19") as `0x${string}`;
const MOONWELL_COMPTROLLER = (process.env.NEXT_PUBLIC_MOONWELL_COMPTROLLER || "0xA92c06c03ab912788c71F74eB0C828E84A159C0a") as `0x${string}`;

const VAULTS = {
  aggressive: {
    name: "Aggressive Vault",
    vaultAddress: (process.env.NEXT_PUBLIC_VAULT_ADDRESS || "0xF35b785bb8344557Bc851AB82EBD8Ed0bE953Eb0") as `0x${string}`,
    keeperAddress: (process.env.NEXT_PUBLIC_KEEPER_ADDRESS || "0x587eadfb5da24050940841a512EaDe2386829C52") as `0x${string}`,
    deploymentBlock: 46305256n,
    targetLtv: "70.00%",
    safetyThreshold: 1.10,
  },
  conservative: {
    name: "Conservative Vault",
    vaultAddress: (process.env.NEXT_PUBLIC_VAULT_ADDRESS_CONSERVATIVE || "0x1E3604FCAC6A166780aEE4b05147E80956136744") as `0x${string}`,
    keeperAddress: (process.env.NEXT_PUBLIC_KEEPER_ADDRESS_CONSERVATIVE || "0xEc08a3BD0462a467C088d44528BED7Ec33bf8278") as `0x${string}`,
    deploymentBlock: 46305305n,
    targetLtv: "50.00%",
    safetyThreshold: 1.10,
  }
} as const;

// ABIs for contract interactions
const VAULT_ABI = [
  {
    name: "activeVenue",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    name: "getHealthFactor",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "totalAssets",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address", name: "owner" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "convertToAssets",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "shares" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { type: "uint256", name: "assets" },
      { type: "address", name: "receiver" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address", name: "owner" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { type: "address", name: "owner" },
      { type: "address", name: "spender" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "spender" },
      { type: "uint256", name: "value" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const MUSDC_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address", name: "owner" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "exchangeRateStored",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "borrowBalanceStored",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address", name: "account" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "supplyRatePerTimestamp",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

interface LogEvent {
  time: string;
  action: "HOLD" | "REBALANCE" | "DELEVERAGE" | "MIGRATE";
  status: "Consensus (Agreement)" | "Consensus (Reconciliation)" | "Fallback (Disagreement)" | "Bypass (Safety Check)";
  reason: string;
  hf: string;
  apy: string;
}

interface DepositFlowState {
  txHash: `0x${string}`;
  vaultType: "aggressive" | "conservative";
  keeperAddress: `0x${string}`;
  depositBlockNumber?: bigint;
  depositTimestamp: number;
  initialLtv?: number | null;
  stage1: "complete";
  stage2: "pending" | "complete" | "hold" | "timeout";
  stage2Ltv?: number | null;
}

export default function VaultPage() {
  const [activeVaultType, setActiveVaultType] = useState<"aggressive" | "conservative">("aggressive");
  const VAULT_ADDRESS = VAULTS[activeVaultType].vaultAddress;
  const KEEPER_ADDRESS = VAULTS[activeVaultType].keeperAddress;

  const [mounted, setMounted] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [activeTxType, setActiveTxType] = useState<"approve" | "deposit" | null>(null);
  const [lastTxType, setLastTxType] = useState<"approve" | "deposit" | null>(null);
  const [depositFlow, setDepositFlow] = useState<DepositFlowState | null>(null);

  // Agent Discussion Feed states
  const [discussions, setDiscussions] = useState<any[]>([]);
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null);
  const [selectedDiscussionTime, setSelectedDiscussionTime] = useState<string | null>(null);

  // Tab state for top navigation bar
  type VaultTab = "deposit" | "reasoning" | "decisions";
  const [activeTab, setActiveTab] = useState<VaultTab>("deposit");

  // When activeVaultType changes, reset the selected discussion to show the latest
  useEffect(() => {
    setSelectedDiscussionTime(null);
  }, [activeVaultType]);

  const router = useRouter();

  // Wagmi wallet and network hooks
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: isConnectPending, error: wagmiConnectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient();

  const [connectionError, setConnectionError] = useState<string | null>(null);

  const isWrongChain = isConnected && chainId !== 84532; // Base Sepolia Chain ID is 84532

  // Allow preview=true for automated visual verification
  const isPreview = typeof window !== "undefined" && window.location.search.includes("preview=true");
  const displayAddress = address || (isPreview ? "0x742d35Cc6634C0532925a3b844Bc454e4438f44e" : undefined);
  const displayIsConnected = isConnected || isPreview;

  // Redirect to landing page if wallet gets disconnected
  useEffect(() => {
    if (mounted && !isConnected && !isPreview) {
      router.push("/");
    }
  }, [isConnected, mounted, router, isPreview]);

  // Aggressive Reads
  const { data: rawActiveVenueAgg, isLoading: loadingVenueAgg, refetch: refetchVenueAgg } = useReadContract({
    address: VAULTS.aggressive.vaultAddress,
    abi: VAULT_ABI,
    functionName: "activeVenue",
  });
  const { data: rawHealthFactorAgg, isLoading: loadingHFAgg, refetch: refetchHFAgg } = useReadContract({
    address: VAULTS.aggressive.vaultAddress,
    abi: VAULT_ABI,
    functionName: "getHealthFactor",
  });
  const { data: rawTotalAssetsAgg, isLoading: loadingAssetsAgg, refetch: refetchAssetsAgg } = useReadContract({
    address: VAULTS.aggressive.vaultAddress,
    abi: VAULT_ABI,
    functionName: "totalAssets",
  });

  // Conservative Reads
  const { data: rawActiveVenueCons, isLoading: loadingVenueCons, refetch: refetchVenueCons } = useReadContract({
    address: VAULTS.conservative.vaultAddress,
    abi: VAULT_ABI,
    functionName: "activeVenue",
  });
  const { data: rawHealthFactorCons, isLoading: loadingHFCons, refetch: refetchHFCons } = useReadContract({
    address: VAULTS.conservative.vaultAddress,
    abi: VAULT_ABI,
    functionName: "getHealthFactor",
  });
  const { data: rawTotalAssetsCons, isLoading: loadingAssetsCons, refetch: refetchAssetsCons } = useReadContract({
    address: VAULTS.conservative.vaultAddress,
    abi: VAULT_ABI,
    functionName: "totalAssets",
  });

  // Map active vault reads dynamically
  const rawActiveVenue = activeVaultType === "aggressive" ? rawActiveVenueAgg : rawActiveVenueCons;
  const rawHealthFactor = activeVaultType === "aggressive" ? rawHealthFactorAgg : rawHealthFactorCons;
  const rawTotalAssets = activeVaultType === "aggressive" ? rawTotalAssetsAgg : rawTotalAssetsCons;

  const loadingVenue = activeVaultType === "aggressive" ? loadingVenueAgg : loadingVenueCons;
  const loadingHF = activeVaultType === "aggressive" ? loadingHFAgg : loadingHFCons;
  const loadingAssets = activeVaultType === "aggressive" ? loadingAssetsAgg : loadingAssetsCons;

  // Moonwell reads for current LTV computation
  const { data: rawMusdcBalance, isLoading: loadingMusdcBal, refetch: refetchMusdc } = useReadContract({
    address: MOONWELL_MUSDC,
    abi: MUSDC_ABI,
    functionName: "balanceOf",
    args: [VAULT_ADDRESS],
  });

  const { data: rawExchangeRate, isLoading: loadingRate, refetch: refetchRate } = useReadContract({
    address: MOONWELL_MUSDC,
    abi: MUSDC_ABI,
    functionName: "exchangeRateStored",
  });

  const { data: rawBorrowBalance, isLoading: loadingBorrow, refetch: refetchBorrow } = useReadContract({
    address: MOONWELL_MUSDC,
    abi: MUSDC_ABI,
    functionName: "borrowBalanceStored",
    args: [VAULT_ADDRESS],
  });

  const { data: rawSupplyRate, isLoading: loadingSupplyRate, refetch: refetchSupply } = useReadContract({
    address: MOONWELL_MUSDC,
    abi: MUSDC_ABI,
    functionName: "supplyRatePerTimestamp",
  });

  // Connected User position reads
  const { data: userUsdcBalance, isLoading: loadingUserUsdc, refetch: refetchUserUsdc } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: userAllowance, isLoading: loadingAllowance, refetch: refetchUserAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, VAULT_ADDRESS] : undefined,
    query: { enabled: !!address },
  });

  const { data: userVaultShares, isLoading: loadingUserShares, refetch: refetchUserShares } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: userVaultAssets, isLoading: loadingUserAssets, refetch: refetchUserAssets } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    query: { enabled: !!address && !!userVaultShares && userVaultShares > 0n },
    functionName: "convertToAssets",
    args: userVaultShares ? [userVaultShares] : undefined,
  });

  // Refetch all state
  const refetchAll = () => {
    refetchVenueAgg();
    refetchHFAgg();
    refetchAssetsAgg();
    refetchVenueCons();
    refetchHFCons();
    refetchAssetsCons();
    refetchMusdc();
    refetchRate();
    refetchBorrow();
    refetchSupply();
    if (address) {
      refetchUserUsdc();
      refetchUserAllowance();
      refetchUserShares();
      refetchUserAssets();
    }
  };

  // Vault-wide values formatting
  const activeVenue = rawActiveVenue 
    ? (rawActiveVenue.toLowerCase() === MOONWELL_MUSDC.toLowerCase() ? "Moonwell" : "Morpho") 
    : null;

  const healthFactor = rawHealthFactor 
    ? (Number(rawHealthFactor) > 1e20 ? Infinity : Number(rawHealthFactor) / 1e18) 
    : null;

  const totalAssets = rawTotalAssets 
    ? Number(rawTotalAssets) / 1e6 
    : null;

  const currentLTV = (rawMusdcBalance && rawExchangeRate && rawBorrowBalance)
    ? (() => {
        try {
          const supplied = (BigInt(rawMusdcBalance) * BigInt(rawExchangeRate)) / 10n ** 18n;
          const borrowed = BigInt(rawBorrowBalance);
          if (supplied <= 0n) return 0;
          const calculated = Number((borrowed * 10000n) / supplied) / 100;
          return isFinite(calculated) && !isNaN(calculated) ? calculated : 0;
        } catch {
          return 0;
        }
      })()
    : null;

  const secondsInYear = 31536000n;
  const supplyApy = (() => {
    if (rawSupplyRate === undefined || rawSupplyRate === null) return "8.33";
    try {
      const rateNum = Number(BigInt(rawSupplyRate) * secondsInYear) / 1e16;
      if (isNaN(rateNum) || !isFinite(rateNum) || rateNum < 0 || rateNum > 500) {
        return "8.33";
      }
      return rateNum.toFixed(2);
    } catch {
      return "8.33";
    }
  })();

  const formattedHF = (healthFactor === null || healthFactor === undefined || isNaN(healthFactor))
    ? "..." 
    : healthFactor === Infinity 
      ? "∞" 
      : healthFactor.toFixed(2);

  // Transaction Write Hooks
  const { writeContract, data: txHash, isPending: isTxPending, error: txError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed, data: txReceipt } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Clear active state and refetch when transaction confirms
  useEffect(() => {
    if (isConfirmed) {
      refetchAll();
      if (lastTxType === "deposit" && txHash) {
        setDepositFlow({
          txHash,
          vaultType: activeVaultType,
          keeperAddress: KEEPER_ADDRESS,
          depositBlockNumber: txReceipt?.blockNumber,
          depositTimestamp: Date.now(),
          initialLtv: currentLTV,
          stage1: "complete",
          stage2: "pending",
        });
      }
      setDepositAmount("");
      setActiveTxType(null);
    }
  }, [isConfirmed]);

  // Update block number if receipt arrives after confirmation state
  useEffect(() => {
    if (txReceipt?.blockNumber && depositFlow && !depositFlow.depositBlockNumber) {
      setDepositFlow((prev) => prev ? { ...prev, depositBlockNumber: txReceipt.blockNumber } : null);
    }
  }, [txReceipt, depositFlow]);

  // Reset active transaction state on error
  useEffect(() => {
    if (txError) {
      setActiveTxType(null);
    }
  }, [txError]);

  // Local state for keeper action logs fetched on-chain
  const [actionLogs, setActionLogs] = useState<LogEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [activeLog, setActiveLog] = useState<LogEvent | null>(null);

  // Poll for post-deposit position building / agent execution
  useEffect(() => {
    if (!depositFlow || depositFlow.stage2 !== "pending" || !publicClient) return;

    let isMounted = true;
    const startTime = depositFlow.depositTimestamp;
    const timeoutDuration = 120000; // 2 minutes timeout cap

    const checkAgentAction = async () => {
      try {
        refetchMusdc();
        refetchRate();
        refetchBorrow();

        const fallbackBlock = VAULTS[depositFlow.vaultType]?.deploymentBlock ?? 46305256n;
        const fromBlock = depositFlow.depositBlockNumber 
          ? (depositFlow.depositBlockNumber > 5n ? depositFlow.depositBlockNumber - 5n : fallbackBlock) 
          : fallbackBlock;

        const logs = await publicClient.getContractEvents({
          address: depositFlow.keeperAddress,
          abi: [
            {
              type: "event",
              name: "KeeperAction",
              inputs: [
                { type: "string", name: "action", indexed: false },
                { type: "string", name: "reason", indexed: false },
                { type: "uint256", name: "hfBefore", indexed: false },
                { type: "uint256", name: "hfAfter", indexed: false },
                { type: "uint256", name: "apySnapshot", indexed: false },
                { type: "uint256", name: "timestamp", indexed: false },
              ],
            }
          ],
          eventName: "KeeperAction",
          fromBlock,
        });

        const depositTimeSec = Math.floor(depositFlow.depositTimestamp / 1000) - 5;
        const recentAction = logs
          .map((log: any) => ({
            action: (log.args.action || "").toLowerCase(),
            reason: log.args.reason || "",
            timestamp: Number(log.args.timestamp || 0),
          }))
          .filter((e: any) => e.timestamp >= depositTimeSec)
          .reverse()[0];

        if (recentAction) {
          if (recentAction.action.includes("rebalance") || recentAction.action.includes("leverage")) {
            if (isMounted) {
              setDepositFlow((prev) => prev ? {
                ...prev,
                stage2: "complete",
                stage2Ltv: currentLTV,
              } : null);
            }
            return;
          } else if (recentAction.action.includes("hold")) {
            if (isMounted) {
              setDepositFlow((prev) => prev ? {
                ...prev,
                stage2: "hold",
                stage2Ltv: currentLTV,
              } : null);
            }
            return;
          }
        }

        // LTV target heuristic check
        const targetNum = depositFlow.vaultType === "aggressive" ? 70 : 50;
        if (currentLTV !== null && currentLTV >= targetNum * 0.8) {
          if (depositFlow.initialLtv !== undefined && depositFlow.initialLtv !== null && currentLTV > depositFlow.initialLtv + 3) {
            if (isMounted) {
              setDepositFlow((prev) => prev ? {
                ...prev,
                stage2: "complete",
                stage2Ltv: currentLTV,
              } : null);
            }
            return;
          }
        }

        if (Date.now() - startTime >= timeoutDuration) {
          if (isMounted) {
            setDepositFlow((prev) => prev ? {
              ...prev,
              stage2: "timeout",
            } : null);
          }
        }
      } catch (err) {
        console.error("Error monitoring agent deposit position:", err);
      }
    };

    const intervalId = setInterval(checkAgentAction, 5000);
    checkAgentAction();

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [
    depositFlow?.stage2, 
    depositFlow?.depositTimestamp, 
    depositFlow?.depositBlockNumber, 
    depositFlow?.keeperAddress, 
    depositFlow?.initialLtv,
    depositFlow?.vaultType,
    publicClient, 
    currentLTV
  ]);

  // Fetch keeper logs on-chain
  useEffect(() => {
    if (!publicClient) return;

    const fetchEvents = async () => {
      setLoadingEvents(true);
      try {
        const deploymentBlock = VAULTS[activeVaultType].deploymentBlock;
        const currentBlock = await publicClient.getBlockNumber();
        const startBlock = deploymentBlock > currentBlock ? currentBlock : deploymentBlock;
        const CHUNK_SIZE = 9000n;

        let logs: any[] = [];
        for (let chunkStart = startBlock; chunkStart <= currentBlock; chunkStart += CHUNK_SIZE) {
          const chunkEnd = chunkStart + CHUNK_SIZE - 1n > currentBlock 
            ? currentBlock 
            : chunkStart + CHUNK_SIZE - 1n;

          const chunkLogs = await publicClient.getContractEvents({
            address: KEEPER_ADDRESS,
            abi: [
              {
                type: "event",
                name: "KeeperAction",
                inputs: [
                  { type: "string", name: "action", indexed: false },
                  { type: "string", name: "reason", indexed: false },
                  { type: "uint256", name: "hfBefore", indexed: false },
                  { type: "uint256", name: "hfAfter", indexed: false },
                  { type: "uint256", name: "apySnapshot", indexed: false },
                  { type: "uint256", name: "timestamp", indexed: false },
                ],
              }
            ],
            eventName: "KeeperAction",
            fromBlock: chunkStart,
            toBlock: chunkEnd,
          });

          logs = logs.concat(chunkLogs);
        }

        const formattedLogs = logs.map((log: any) => {
          const { action, reason, hfBefore, hfAfter, apySnapshot, timestamp } = log?.args || {};
          const timeVal = Number(timestamp || 0);
          const date = new Date(timeVal * 1000);
          const diffSeconds = Math.floor(Date.now() / 1000 - timeVal);
          
          let timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          if (diffSeconds < 60) {
            timeStr = "Just now";
          } else if (diffSeconds < 3600) {
            timeStr = `${Math.floor(diffSeconds / 60)} mins ago`;
          } else if (diffSeconds < 86400) {
            timeStr = `${Math.floor(diffSeconds / 3600)} hours ago`;
          } else {
            timeStr = `${Math.floor(diffSeconds / 86400)} days ago`;
          }

          const hfBeforeNum = hfBefore !== undefined && hfBefore !== null ? Number(hfBefore) : null;
          const hfBeforeStr = hfBeforeNum === null || isNaN(hfBeforeNum) 
            ? "—" 
            : hfBeforeNum > 1e20 
              ? "∞" 
              : (hfBeforeNum / 1e18).toFixed(2);

          const hfAfterNum = hfAfter !== undefined && hfAfter !== null ? Number(hfAfter) : null;
          const hfAfterStr = hfAfterNum === null || isNaN(hfAfterNum) 
            ? "—" 
            : hfAfterNum > 1e20 
              ? "∞" 
              : (hfAfterNum / 1e18).toFixed(2);

          const safeReason = typeof reason === "string" ? reason : "";
          let status: LogEvent["status"] = "Consensus (Agreement)";
          if (safeReason.toLowerCase().includes("fallback") || safeReason.toLowerCase().includes("disagreement")) {
            status = "Fallback (Disagreement)";
          } else if (safeReason.toLowerCase().includes("reconciliation") || safeReason.toLowerCase().includes("reconciled")) {
            status = "Consensus (Reconciliation)";
          } else if (safeReason.toLowerCase().includes("bypass") || safeReason.toLowerCase().includes("safety")) {
            status = "Bypass (Safety Check)";
          }

          // Parse and format APY snapshot safely:
          // KeeperAction emits uint256 apySnapshot scaled to 18 decimals (1e18 = 100% or 1.0 = 100%).
          // E.g., for 5.13% APY, apySnapshot is 51271093624587263 (5.13e16).
          // Dividing by 100 caused the displayed Net APY to blow up to 512710936245872.63%.
          let apyFormatted = "—";
          if (apySnapshot !== undefined && apySnapshot !== null) {
            try {
              const apyBig = BigInt(apySnapshot);
              if (apyBig === 0n) {
                apyFormatted = "0.00%";
              } else {
                const apyVal = Number(apyBig);
                if (isFinite(apyVal) && !isNaN(apyVal)) {
                  let pct = 0;
                  // If scaled by 1e18 (>= 1e12), convert to percentage by dividing by 1e16
                  if (Math.abs(apyVal) >= 1e12) {
                    pct = apyVal / 1e16;
                  } else if (Math.abs(apyVal) >= 1) {
                    // Basis points scale
                    pct = apyVal / 100;
                  } else {
                    // Decimal fraction scale
                    pct = apyVal * 100;
                  }

                  // Sanity-check: APY should be finite and within realistic bounds (-100% to 500%)
                  if (isFinite(pct) && !isNaN(pct) && pct >= -100 && pct <= 500) {
                    apyFormatted = `${pct.toFixed(2)}%`;
                  } else {
                    apyFormatted = "N/A";
                  }
                } else {
                  apyFormatted = "N/A";
                }
              }
            } catch {
              apyFormatted = "—";
            }
          }

          return {
            time: timeStr,
            action: (typeof action === "string" ? action.toUpperCase() : "HOLD") as LogEvent["action"],
            status,
            reason: safeReason,
            hf: `${hfBeforeStr} ➔ ${hfAfterStr}`,
            apy: apyFormatted,
          };
        }).reverse();

        setActionLogs(formattedLogs);
        if (formattedLogs.length > 0) {
          setActiveLog(formattedLogs[0]);
        }
      } catch (err) {
        console.error("Error fetching logs:", err);
      } finally {
        setLoadingEvents(false);
      }
    };

    fetchEvents();
  }, [publicClient, activeVaultType, KEEPER_ADDRESS]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Poll agent for discussions
  useEffect(() => {
    const agentUrl = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:3001";
    let active = true;

    const fetchDiscussions = async () => {
      try {
        const res = await fetch(`${agentUrl}/api/discussions`);
        if (!res.ok) throw new Error("Server returned non-ok status");
        const data = await res.json();
        if (active) {
          setDiscussions(data);
          setAgentOnline(true);
        }
      } catch (err) {
        console.error("Error fetching agent discussions:", err);
        if (active) {
          setAgentOnline(false);
        }
      }
    };

    fetchDiscussions();
    const interval = setInterval(fetchDiscussions, 12000); // 12 seconds polling

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // Prevent flash of content if not mounted or not connected
  if (!mounted || (!isConnected && !isPreview)) {
    return (
      <div className="min-h-screen bg-sage-green flex flex-col items-center justify-center m-0 p-0">
        <div className="w-10 h-10 rounded-full border-4 border-cream-light/20 border-t-cream-light animate-spin mb-4" />
        <p className="text-cream-light font-serif font-bold text-xs tracking-widest uppercase">Redirecting...</p>
      </div>
    );
  }

  // Form logic variables
  const amountInWei = depositAmount && !isNaN(Number(depositAmount)) 
    ? BigInt(Math.floor(Number(depositAmount) * 1e6)) 
    : 0n;

  const hasAllowance = userAllowance !== undefined && userAllowance >= amountInWei;
  const hasUsdcBalance = userUsdcBalance !== undefined && userUsdcBalance >= amountInWei;

  const handleConnect = () => {
    if (isConnectPending) return;
    setConnectionError(null);
    if (isConnected) {
      disconnect();
    } else {
      const connector = connectors.find((c: any) => c.id === "injected") || connectors[0];
      if (connector) {
        connect(
          { connector },
          {
            onError: (err: any) => {
              console.error("Wallet connect error:", err);
              const isAlreadyPending =
                err?.code === -32002 ||
                err?.cause?.code === -32002 ||
                err?.message?.includes("-32002") ||
                err?.message?.toLowerCase().includes("already pending");

              if (isAlreadyPending) {
                setConnectionError("A connection request is already open — please check your wallet extension.");
              } else if (err?.code === 4001 || err?.cause?.code === 4001) {
                setConnectionError("Connection request was cancelled in your wallet.");
              } else {
                setConnectionError(err?.shortMessage || err?.message || "Failed to connect wallet.");
              }
            },
          }
        );
      } else {
        alert("No injected browser wallet found (MetaMask, Coinbase Wallet etc.).");
      }
    }
  };

  const handleApprove = () => {
    setActiveTxType("approve");
    setLastTxType("approve");
    writeContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [VAULT_ADDRESS, amountInWei],
    });
  };

  const handleDeposit = () => {
    if (!address) return;
    setActiveTxType("deposit");
    setLastTxType("deposit");
    setDepositFlow(null);
    writeContract({
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: "deposit",
      args: [amountInWei, address],
    });
  };

  // UI Render variables
  const hfDisplay = loadingHF ? "..." : formattedHF;
  const ltvDisplay = (loadingMusdcBal || loadingRate || loadingBorrow)
    ? "..."
    : (currentLTV !== null && currentLTV !== undefined && !isNaN(currentLTV))
      ? `${currentLTV.toFixed(2)}%`
      : "Error";
  const venueDisplay = loadingVenue ? "Loading..." : (activeVenue || "Error");
  const assetsDisplay = loadingAssets 
    ? "Loading..." 
    : (totalAssets !== null && totalAssets !== undefined && !isNaN(totalAssets))
      ? `${totalAssets.toFixed(2)} USDC` 
      : "Error";

  const activeDiscussions = discussions.filter(
    (d: any) => d.vaultName.toLowerCase() === activeVaultType.toLowerCase()
  );
  
  const currentDiscussion = selectedDiscussionTime 
    ? activeDiscussions.find((d: any) => d.timestamp === selectedDiscussionTime) || activeDiscussions[0]
    : activeDiscussions[0];

  // Shared sub-components
  const renderVaultSwitcher = () => (
    <div className="grid grid-cols-2 gap-4 w-full max-w-lg">
      {/* Aggressive Card */}
      <div 
        onClick={() => setActiveVaultType("aggressive")}
        className={`p-5 rounded-3xl border transition-all cursor-pointer flex flex-col justify-between gap-4 ${
          activeVaultType === "aggressive" 
            ? "bg-cream-card border-forest-dark shadow-sm ring-1 ring-forest-dark/10" 
            : "bg-cream-card/50 border-forest-dark/10 opacity-70 hover:opacity-100 hover:bg-cream-card/75"
        }`}
      >
        <div className="flex justify-between items-center">
          <span className="text-[10px] uppercase font-bold tracking-wider text-forest-muted">Aggressive</span>
          <span className={`w-2 h-2 rounded-full ${rawHealthFactorAgg && Number(rawHealthFactorAgg) < 1100000000000000000n ? "bg-red-500 animate-pulse" : "bg-emerald-600"}`} />
        </div>
        <div>
          <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted">Health Factor</p>
          <span className="text-3xl font-serif font-black text-forest-dark mt-1 block">
            {rawHealthFactorAgg !== undefined && rawHealthFactorAgg !== null && !isNaN(Number(rawHealthFactorAgg))
              ? (Number(rawHealthFactorAgg) > 1e20 ? "∞" : (Number(rawHealthFactorAgg)/1e18).toFixed(2)) 
              : "..."}
          </span>
        </div>
        <div className="text-[10px] text-forest-muted border-t border-forest-dark/10 pt-2 flex justify-between font-sans">
          <span>{rawActiveVenueAgg ? (rawActiveVenueAgg.toLowerCase() === MOONWELL_MUSDC.toLowerCase() ? "Moonwell" : "Morpho") : "..."}</span>
          <span className="font-bold">70% Target</span>
        </div>
      </div>

      {/* Conservative Card */}
      <div 
        onClick={() => setActiveVaultType("conservative")}
        className={`p-5 rounded-3xl border transition-all cursor-pointer flex flex-col justify-between gap-4 ${
          activeVaultType === "conservative" 
            ? "bg-cream-card border-forest-dark shadow-sm ring-1 ring-forest-dark/10" 
            : "bg-cream-card/50 border-forest-dark/10 opacity-70 hover:opacity-100 hover:bg-cream-card/75"
        }`}
      >
        <div className="flex justify-between items-center">
          <span className="text-[10px] uppercase font-bold tracking-wider text-forest-muted">Conservative</span>
          <span className={`w-2 h-2 rounded-full ${rawHealthFactorCons && Number(rawHealthFactorCons) < 1100000000000000000n ? "bg-red-500 animate-pulse" : "bg-emerald-600"}`} />
        </div>
        <div>
          <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted">Health Factor</p>
          <span className="text-3xl font-serif font-black text-forest-dark mt-1 block">
            {rawHealthFactorCons !== undefined && rawHealthFactorCons !== null && !isNaN(Number(rawHealthFactorCons))
              ? (Number(rawHealthFactorCons) > 1e20 ? "∞" : (Number(rawHealthFactorCons)/1e18).toFixed(2)) 
              : "..."}
          </span>
        </div>
        <div className="text-[10px] text-forest-muted border-t border-forest-dark/10 pt-2 flex justify-between font-sans">
          <span>{rawActiveVenueCons ? (rawActiveVenueCons.toLowerCase() === MOONWELL_MUSDC.toLowerCase() ? "Moonwell" : "Morpho") : "..."}</span>
          <span className="font-bold">50% Target</span>
        </div>
      </div>
    </div>
  );

  const renderAddressFooter = (isMobile = false) => (
    <div className={`text-[10px] text-forest-muted/60 uppercase tracking-widest ${isMobile ? "flex lg:hidden mt-6" : "hidden lg:flex mt-12"} flex-col gap-1 w-full max-w-lg border-t border-forest-dark/10 pt-6`}>
      <div className="flex justify-between items-center w-full gap-2 min-w-0">
        <span className="shrink-0">Base Sepolia Address</span>
        <span className="font-mono font-bold text-forest-dark truncate text-right">{VAULT_ADDRESS.slice(0, 6)}...{VAULT_ADDRESS.slice(-4)}</span>
      </div>
      <div className="flex justify-between items-center w-full gap-2 min-w-0">
        <span className="shrink-0">Autonomous Keeper</span>
        <span className="font-mono font-bold text-forest-dark truncate text-right">{KEEPER_ADDRESS.slice(0, 6)}...{KEEPER_ADDRESS.slice(-4)}</span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen w-full flex flex-col m-0 p-0 overflow-x-hidden min-w-0 max-w-full bg-cream-light font-sans text-forest-dark">
      
      {/* Network mismatch warning banner */}
      {isWrongChain && (
        <div className="w-full bg-amber-50 border-b border-amber-200 text-amber-800 text-xs px-4 py-2.5 text-center flex justify-center items-center gap-2 z-50">
          <span>Connected to the wrong chain. Please switch to Base Sepolia.</span>
          <button
            onClick={() => switchChain({ chainId: 84532 })}
            className="bg-amber-800 text-white font-bold px-3 py-1 rounded hover:bg-amber-900 transition-colors cursor-pointer text-[10px]"
          >
            Switch Network
          </button>
        </div>
      )}

      {/* STICKY TOP NAV BAR */}
      <header className="sticky top-0 z-40 w-full bg-cream-light/95 backdrop-blur-md border-b border-forest-dark/10 shadow-xs">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-8 py-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 sm:gap-4">
          
          {/* Left: Brand Logo + Wordmark */}
          <div 
            className="flex items-center gap-3 cursor-pointer shrink-0 group" 
            onClick={() => router.push("/")}
          >
            <div className="w-10 h-10 rounded-xl bg-forest-dark border border-forest-dark/20 p-1.5 flex items-center justify-center shadow-xs shrink-0 group-hover:scale-105 transition-transform">
              <img src="/logo.png" alt="Parity Logo" className="w-full h-full object-contain" />
            </div>
            <span className="font-serif font-black tracking-widest text-xl sm:text-2xl text-forest-dark uppercase">
              Parity
            </span>
          </div>

          {/* Center: Navigation Tabs */}
          <nav className="order-3 sm:order-2 w-full sm:w-auto flex justify-center">
            <div className="flex items-center p-1 rounded-full bg-forest-dark/5 border border-forest-dark/10">
              <button
                type="button"
                onClick={() => setActiveTab("deposit")}
                className={`px-3.5 sm:px-5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                  activeTab === "deposit"
                    ? "bg-forest-dark text-cream-light shadow-xs"
                    : "text-forest-muted hover:text-forest-dark hover:bg-forest-dark/5"
                }`}
              >
                Deposit
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("reasoning")}
                className={`px-3.5 sm:px-5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeTab === "reasoning"
                    ? "bg-forest-dark text-cream-light shadow-xs"
                    : "text-forest-muted hover:text-forest-dark hover:bg-forest-dark/5"
                }`}
              >
                <span>Agent Reasoning</span>
                {activeDiscussions.length > 0 && (
                  <span className={`w-1.5 h-1.5 rounded-full ${activeTab === "reasoning" ? "bg-emerald-400" : "bg-emerald-600 animate-pulse"}`} />
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("decisions")}
                className={`px-3.5 sm:px-5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeTab === "decisions"
                    ? "bg-forest-dark text-cream-light shadow-xs"
                    : "text-forest-muted hover:text-forest-dark hover:bg-forest-dark/5"
                }`}
              >
                <span>Agent Decisions</span>
                {actionLogs.length > 0 && (
                  <span className={`w-1.5 h-1.5 rounded-full ${activeTab === "decisions" ? "bg-emerald-400" : "bg-emerald-600"}`} />
                )}
              </button>
            </div>
          </nav>

          {/* Right: Connected Wallet Button */}
          <div className="order-2 sm:order-3 flex flex-col items-end gap-1 shrink-0">
            <button
              onClick={handleConnect}
              disabled={isConnectPending}
              className={`text-[10px] tracking-wider uppercase font-bold px-3.5 py-1.5 border border-forest-dark/20 rounded-full transition-all shrink-0 ${
                isConnectPending
                  ? "opacity-60 cursor-not-allowed"
                  : "hover:bg-forest-dark hover:text-cream-light cursor-pointer"
              }`}
            >
              {isConnectPending
                ? "Connecting..."
                : displayIsConnected && displayAddress
                ? `${displayAddress.slice(0, 6)}...${displayAddress.slice(-4)} (Connected)`
                : "Connect Wallet"}
            </button>
            {connectionError && (
              <span className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 break-words [overflow-wrap:anywhere] max-w-xs text-right">
                {connectionError}
              </span>
            )}
          </div>

        </div>
      </header>

      {/* TABBED CONTENT AREA */}
      <main className="flex-1 w-full flex flex-col lg:flex-row m-0 p-0 overflow-x-hidden min-w-0 max-w-full">
        
        {/* ============================================================ */}
        {/* TAB 1: DEPOSIT ("Do Something" Section)                      */}
        {/* ============================================================ */}
        {activeTab === "deposit" && (
          <>
            {/* LEFT COLUMN: HERO INTRO (Cream Background) */}
            <section className="w-full lg:w-[48%] xl:w-[45%] bg-cream-light p-6 sm:p-8 md:p-12 lg:p-16 flex flex-col justify-between items-start shrink-0 min-w-0 relative">
              <div className="my-8 lg:my-0 max-w-lg w-full min-w-0">
                <p className="text-[10px] font-bold tracking-[0.2em] text-forest-muted uppercase mb-4">
                  One Engine. Constant Vigilance.
                </p>
                <h1 className="text-3xl sm:text-4xl md:text-4xl lg:text-[3rem] xl:text-[3.5rem] font-serif font-black text-forest-dark tracking-tight leading-[0.95] uppercase mb-8 break-normal [word-break:normal] [overflow-wrap:normal]">
                  The Agent<br />
                  That Watches<br />
                  Your Yield,<br />
                  So You Don't<br />
                  Have To.
                </h1>
                <p className="text-sm md:text-base text-forest-muted font-normal leading-relaxed mb-6 break-words">
                  Parity is an autonomous leveraged USDC yield agent operating on Base Sepolia. 
                  By continuously reading live market metrics, it leverages deposits up to a target LTV, protects against high utilization, and migrates venues to capture optimal yields.
                </p>
                <p className="text-xs text-forest-muted/75 font-normal leading-relaxed border-l-2 border-forest-dark/20 pl-4 py-1 italic break-words">
                  Discretionary actions require strict, dual-model consensus between two diverse LLMs (gpt-oss-20b and gpt-oss-120b) via Groq, preserving deterministic rules for emergency health factor protection.
                </p>
              </div>

              {renderAddressFooter(false)}
            </section>

            {/* RIGHT COLUMN: DASHBOARD & DEPOSIT CARDS (Sage Background) */}
            <section className="w-full lg:w-[52%] xl:w-[55%] bg-sage-green p-6 sm:p-8 md:p-12 lg:p-16 flex flex-col justify-start items-center gap-8 shrink-0 min-w-0 max-w-full overflow-x-hidden">
              
              {/* Switcher: Aggressive / Conservative */}
              {renderVaultSwitcher()}

              {/* Card 1: Vault Status */}
              <div className="bg-cream-card border border-forest-dark/15 rounded-3xl p-6 md:p-10 w-full max-w-lg shadow-sm flex flex-col gap-8 shrink-0">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted">Vault Status / Live</p>
                    <h2 className="text-3xl font-serif font-black text-forest-dark mt-1 leading-tight">{VAULTS[activeVaultType].name}</h2>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted">Health Factor</p>
                    <span className="text-5xl md:text-6xl font-serif font-black text-forest-dark block mt-1 tracking-tighter">
                      {hfDisplay}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col">
                  {/* Status 1: Health Factor */}
                  <div className="border-t border-forest-dark/10 py-5 flex gap-4">
                    <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${healthFactor !== null && healthFactor < VAULTS[activeVaultType].safetyThreshold ? "bg-red-500 animate-pulse" : "bg-emerald-600"}`} />
                    <div>
                      <h4 className="text-sm font-bold text-forest-dark leading-none break-words">
                        {healthFactor !== null && healthFactor < (VAULTS[activeVaultType]?.safetyThreshold ?? 1.1) ? "Emergency Deleverage Flagged" : "Leverage Safety Bounded"}
                      </h4>
                      <p className="text-xs text-forest-muted/90 mt-1.5 leading-normal break-words">
                        Current Health Factor is <strong className="text-forest-dark">{hfDisplay}</strong>. Safety-critical bypass threshold set to <strong className="text-forest-dark">{VAULTS[activeVaultType]?.safetyThreshold ? VAULTS[activeVaultType].safetyThreshold.toFixed(2) : "1.10"}</strong>.
                      </p>
                    </div>
                  </div>

                  {/* Status 2: LTV */}
                  <div className="border-t border-forest-dark/10 py-5 flex gap-4 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-forest-dark leading-none break-words">Leveraged Position Active</h4>
                      <p className="text-xs text-forest-muted/90 mt-1.5 leading-normal break-words">
                        Current Loan-to-Value: <strong className="text-forest-dark">{ltvDisplay}</strong>. Optimization engine targets <strong className="text-forest-dark">{VAULTS[activeVaultType].targetLtv} Target LTV</strong>.
                      </p>
                    </div>
                  </div>

                  {/* Status 3: Active Venue & APY */}
                  <div className="border-t border-forest-dark/10 py-5 flex gap-4 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 mt-1.5 shrink-0" />
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-forest-dark leading-none break-words">Active Venue: {venueDisplay}</h4>
                      <p className="text-xs text-forest-muted/90 mt-1.5 leading-normal break-words">
                        Supplying assets to Moonwell mUSDC at <strong className="text-forest-dark">{supplyApy}%</strong> supply APY. Total vault assets managed: <strong className="text-forest-dark">{assetsDisplay}</strong>.
                      </p>
                    </div>
                  </div>

                  {/* User Position status */}
                  <div className="border-t border-forest-dark/10 pt-5">
                    <div className="flex flex-col gap-2 bg-forest-dark/5 p-3 rounded-xl">
                      <div className="flex justify-between items-center text-xs gap-2 min-w-0">
                        <span className="text-[10px] font-bold text-forest-muted uppercase shrink-0">Your Shares</span>
                        <span className="font-mono font-bold text-forest-dark truncate text-right">
                          {loadingUserShares ? "Loading..." : `${userVaultShares && !isNaN(Number(userVaultShares)) ? (Number(userVaultShares) / 1e18).toFixed(4) : "0.0000"} prtUSDC`}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs gap-2 min-w-0">
                        <span className="text-[10px] font-bold text-forest-muted uppercase shrink-0">USDC Equivalent</span>
                        <span className="font-mono font-bold text-forest-dark truncate text-right">
                          {loadingUserAssets ? "Loading..." : `${userVaultAssets && !isNaN(Number(userVaultAssets)) ? (Number(userVaultAssets) / 1e6).toFixed(2) : "0.00"} USDC`}
                        </span>
                      </div>
                    </div>
                  </div>

                </div>
              </div>

              {/* Card 1.5: Deposit USDC Form */}
              <div className="bg-cream-card border border-forest-dark/15 rounded-3xl p-6 md:p-10 w-full max-w-lg shadow-sm flex flex-col gap-6 shrink-0">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted">Deposit Asset</p>
                    <h3 className="text-2xl font-serif font-black text-forest-dark mt-0.5">Supply USDC</h3>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-forest-muted uppercase font-bold block">Wallet Balance</span>
                    <span className="font-mono font-bold text-forest-dark text-xs">
                      {loadingUserUsdc ? "..." : `${userUsdcBalance ? (Number(userUsdcBalance) / 1e6).toFixed(2) : "0.00"} USDC`}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="relative">
                    <input
                      type="number"
                      placeholder="0.00"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      disabled={false}
                      className="w-full bg-forest-dark/5 border border-forest-dark/20 rounded-2xl px-4 py-3 text-lg font-mono font-bold text-forest-dark placeholder-forest-muted/50 focus:outline-none focus:border-forest-dark transition-colors disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (userUsdcBalance) {
                          setDepositAmount((Number(userUsdcBalance) / 1e6).toString());
                        }
                      }}
                      disabled={false || !userUsdcBalance || Number(userUsdcBalance) === 0}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-wider bg-forest-dark text-cream-light px-2.5 py-1 rounded-lg hover:bg-forest-muted transition-colors disabled:opacity-40 cursor-pointer"
                    >
                      MAX
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={!hasAllowance ? handleApprove : handleDeposit}
                    disabled={amountInWei === 0n || !hasUsdcBalance || activeTxType !== null || isConfirming}
                    className="w-full bg-forest-dark text-cream-light font-bold py-3.5 rounded-2xl text-xs uppercase tracking-wider hover:bg-forest-muted transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-sm"
                  >
                    {activeTxType === "approve" && (isConfirming ? "Confirming Approval..." : "Approving USDC...")}
                    {activeTxType === "deposit" && (isConfirming ? "Confirming Deposit..." : "Depositing USDC...")}
                    {activeTxType === null && (amountInWei === 0n ? "Enter amount" : !hasUsdcBalance ? "Insufficient USDC Balance" : !hasAllowance ? "Approve USDC" : "Deposit USDC")}
                  </button>
                </div>

                {/* Transaction Feedback */}
                {txHash && (
                  <div className="text-[10px] text-forest-muted leading-relaxed font-sans border-t border-forest-dark/10 pt-3 min-w-0">
                    <span>Tx Hash: </span>
                    <a
                      href={`https://sepolia.basescan.org/tx/${txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline font-mono text-forest-dark hover:opacity-80 break-all"
                    >
                      {txHash.slice(0, 10)}...{txHash.slice(-8)}
                    </a>
                    {isConfirming && <span className="block text-amber-600 mt-1 animate-pulse font-bold break-words">Waiting for network confirmation...</span>}
                    {isConfirmed && <span className="block text-emerald-600 mt-1 font-bold break-words">Transaction confirmed successfully!</span>}

                    {depositFlow && isConfirmed && (
                      <div className="mt-4 pt-4 border-t border-forest-dark/10 flex flex-col gap-3 min-w-0">
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted shrink-0">
                            Position Pipeline
                          </p>
                          <span className="text-[9px] font-mono text-forest-muted/70 truncate text-right">
                            {depositFlow.stage2 === "complete" ? "Leverage Applied" : depositFlow.stage2 === "pending" ? "Awaiting Agent Cycle" : "Agent Monitored"}
                          </span>
                        </div>

                        {/* Stage 1 */}
                        <div className="flex items-start gap-3 bg-forest-dark/5 p-3 rounded-xl min-w-0">
                          <span className="w-2 h-2 rounded-full bg-emerald-600 mt-1 shrink-0" />
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-bold text-forest-dark leading-tight">
                              Stage 1: Collateral Supplied
                            </span>
                            <span className="text-[11px] text-forest-muted mt-0.5 leading-normal break-words">
                              Your USDC is now supplying collateral on Moonwell.
                            </span>
                          </div>
                        </div>

                        {/* Stage 2 */}
                        <div className="flex items-start gap-3 bg-forest-dark/5 p-3 rounded-xl min-w-0">
                          <span 
                            className={`w-2 h-2 rounded-full mt-1 shrink-0 ${
                              depositFlow.stage2 === "complete" 
                                ? "bg-emerald-600" 
                                : depositFlow.stage2 === "pending" 
                                  ? "bg-amber-500 animate-pulse" 
                                  : "bg-forest-muted/60"
                            }`} 
                          />
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-bold text-forest-dark leading-tight">
                              Stage 2: Leverage Position Building
                            </span>
                            <span className="text-[11px] text-forest-muted mt-0.5 leading-normal break-words">
                              {depositFlow.stage2 === "complete" && (
                                <>Position leveraged to <strong className="text-forest-dark font-mono font-bold">{depositFlow.stage2Ltv !== null && depositFlow.stage2Ltv !== undefined && !isNaN(depositFlow.stage2Ltv) ? `${depositFlow.stage2Ltv.toFixed(2)}%` : ltvDisplay} LTV</strong>.</>
                              )}
                              {depositFlow.stage2 === "pending" && (
                                <>The agent will build your leveraged position on its next monitoring cycle (~30s).</>
                              )}
                              {depositFlow.stage2 === "hold" && (
                                <>Agent evaluated market and held position (safe target maintained). Check the Decisions Feed for details.</>
                              )}
                              {depositFlow.stage2 === "timeout" && (
                                <>Waiting for agent — check the Decisions Feed for the latest action.</>
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

              </div>

              {renderAddressFooter(true)}
            </section>
          </>
        )}

        {/* ============================================================ */}
        {/* TAB 2: AGENT REASONING ("Watch It Think" Section)             */}
        {/* ============================================================ */}
        {activeTab === "reasoning" && (
          <>
            {/* LEFT COLUMN: CONSENSUS OVERVIEW (Cream Background) */}
            <section className="w-full lg:w-[48%] xl:w-[45%] bg-cream-light p-6 sm:p-8 md:p-12 lg:p-16 flex flex-col justify-between items-start shrink-0 min-w-0 relative">
              <div className="my-8 lg:my-0 max-w-lg w-full min-w-0">
                <p className="text-[10px] font-bold tracking-[0.2em] text-forest-muted uppercase mb-4">
                  Autonomous Consensus
                </p>
                <h1 className="text-3xl sm:text-4xl md:text-4xl lg:text-[2.75rem] xl:text-[3.25rem] font-serif font-black text-forest-dark tracking-tight leading-[0.95] uppercase mb-8 break-normal [word-break:normal] [overflow-wrap:normal]">
                  Watch<br />
                  The Engine<br />
                  Deliberate.
                </h1>
                <p className="text-sm md:text-base text-forest-muted font-normal leading-relaxed mb-6 break-words">
                  Discretionary actions require strict, dual-model consensus between two diverse LLMs (gpt-oss-20b and gpt-oss-120b) via Groq. Every cycle, Model A proposes rebalancing actions, and Model B critiques or counters.
                </p>
                <p className="text-xs text-forest-muted/75 font-normal leading-relaxed border-l-2 border-forest-dark/20 pl-4 py-1 italic break-words mb-8">
                  If the models disagree, a reconciliation pass is invoked. If consensus cannot be reached, the engine holds steady, preserving capital while deterministic rules guard collateral.
                </p>

                <div className="w-full pt-4 border-t border-forest-dark/10">
                  <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted mb-3">Select Active Vault</p>
                  {renderVaultSwitcher()}
                </div>
              </div>

              {renderAddressFooter(false)}
            </section>

            {/* RIGHT COLUMN: AGENT DISCUSSION FEED (Sage Background) */}
            <section className="w-full lg:w-[52%] xl:w-[55%] bg-sage-green p-6 sm:p-8 md:p-12 lg:p-16 flex flex-col justify-start items-center gap-8 shrink-0 min-w-0 max-w-full overflow-x-hidden">
              
              {/* Card 1.8: Agent Discussion Feed */}
              <div className="w-full max-w-lg flex flex-col gap-4">
                {discussions.length === 0 ? (
                  <div className="bg-cream-card border border-forest-dark/15 rounded-3xl p-8 text-center shadow-sm w-full">
                    <p className="text-xs text-forest-muted italic animate-pulse">Connecting to Parity Agent Discussion Feed...</p>
                  </div>
                ) : currentDiscussion ? (
                  <div className="bg-cream-card border border-forest-dark/15 rounded-3xl p-6 md:p-8 w-full max-w-lg shadow-sm flex flex-col gap-6 shrink-0 min-w-0">
                    
                    {/* Header */}
                    <div className="flex justify-between items-center border-b border-forest-dark/10 pb-4">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${agentOnline ? "bg-emerald-600 animate-pulse" : "bg-emerald-600"}`} />
                        <span className="text-[10px] uppercase font-bold tracking-wider text-forest-muted">
                          AI Consensus Engine ({activeVaultType})
                        </span>
                      </div>
                      <span className="text-[9px] font-mono font-bold text-forest-muted">
                        Cycle: {new Date(currentDiscussion.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>

                    {/* Cycle Snapshot */}
                    <div className="bg-forest-dark/5 p-3.5 rounded-2xl flex justify-between items-center text-xs">
                      <div>
                        <span className="text-[9px] font-bold text-forest-muted uppercase tracking-wider block">Cycle Snapshot</span>
                        <span className="text-forest-dark font-sans text-xs">
                          {currentDiscussion.currentHF !== undefined && currentDiscussion.currentHF !== null
                            ? (Number(currentDiscussion.currentHF) > 1e20 ? "HF: ∞" : `HF: ${(Number(currentDiscussion.currentHF)).toFixed(2)}`)
                            : "HF: —"}
                        </span>
                      </div>
                      <div className="text-right flex items-center gap-2">
                        <span className="text-[9px] font-mono text-forest-muted/65 bg-forest-dark/5 px-2 py-0.5 rounded">
                          {currentDiscussion.venueApy !== undefined && currentDiscussion.venueApy !== null ? `${currentDiscussion.venueApy.toFixed(2)}% APY` : "—"}
                        </span>
                        <span className="text-[9px] font-mono text-forest-muted/65 bg-forest-dark/5 px-2 py-0.5 rounded">
                          LTV: {typeof currentDiscussion.currentLTV === "number" && !isNaN(currentDiscussion.currentLTV) && isFinite(currentDiscussion.currentLTV) && currentDiscussion.currentLTV >= 0 && currentDiscussion.currentLTV <= 2
                                ? `${(currentDiscussion.currentLTV * 100).toFixed(1)}%`
                                : "—"}
                        </span>
                      </div>
                    </div>

                    {/* Conversation-style Exchange */}
                    <div className="flex flex-col gap-3.5 w-full min-w-0">
                      {/* Model A Stack */}
                      {currentDiscussion.modelAProposal ? (
                        <div className="bg-forest-dark/5 p-3.5 rounded-2xl flex flex-col gap-1 border border-forest-dark/5 min-w-0">
                          <div className="flex justify-between items-center gap-2">
                            <span className="text-[10px] font-black text-forest-dark flex items-center gap-1 shrink-0">
                              <span>🤖</span> Model A (Proposer)
                            </span>
                            <span className="text-[9px] font-mono font-bold bg-forest-dark/10 text-forest-dark px-2 py-0.5 rounded uppercase shrink-0">
                              {currentDiscussion.modelAProposal.action}
                            </span>
                          </div>
                          <p className="text-xs text-forest-muted mt-1 leading-relaxed font-sans break-words [overflow-wrap:anywhere] max-h-48 overflow-y-auto pr-1">
                            {currentDiscussion.modelAProposal.reasoning}
                          </p>
                        </div>
                      ) : (
                        <div className="bg-amber-50/70 border border-amber-200/50 p-3.5 rounded-2xl flex flex-col gap-1 min-w-0">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-900">
                            <span>🛡️</span> On-Chain Safety Bypass
                          </div>
                          <p className="text-xs text-amber-800 mt-1 leading-relaxed font-sans break-words [overflow-wrap:anywhere] max-h-48 overflow-y-auto pr-1">
                            {currentDiscussion.finalReason}
                          </p>
                        </div>
                      )}

                      {/* Model B Stack */}
                      {currentDiscussion.modelBReview && (
                        <div className="bg-forest-dark/5 p-3.5 rounded-2xl flex flex-col gap-1 border border-forest-dark/5 min-w-0">
                          <div className="flex justify-between items-center gap-2">
                            <span className="text-[10px] font-black text-forest-dark flex items-center gap-1 shrink-0">
                              <span>⚖️</span> Model B (Reviewer)
                            </span>
                            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase shrink-0 ${
                              currentDiscussion.modelBReview.agree 
                                ? "bg-emerald-100 text-emerald-800" 
                                : "bg-rose-100 text-rose-800"
                            }`}>
                              {currentDiscussion.modelBReview.agree ? "Agree" : `Counter: ${currentDiscussion.modelBReview.action}`}
                            </span>
                          </div>
                          <p className="text-xs text-forest-muted mt-1 leading-relaxed font-sans break-words [overflow-wrap:anywhere] max-h-48 overflow-y-auto pr-1">
                            {currentDiscussion.modelBReview.reasoning}
                          </p>
                        </div>
                      )}

                      {/* Reconciliation Pass Stack */}
                      {currentDiscussion.reconciliation && (
                        <div className="bg-amber-50/50 border border-amber-200/30 p-3.5 rounded-2xl flex flex-col gap-1 min-w-0">
                          <div className="flex justify-between items-center gap-2">
                            <span className="text-[10px] font-black text-amber-900 flex items-center gap-1 shrink-0">
                              <span>🔄</span> Reconciliation Attempt
                            </span>
                            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase shrink-0 ${
                              currentDiscussion.reconciliation.agreeWithCounterProposal 
                                ? "bg-emerald-100 text-emerald-800" 
                                : "bg-amber-100 text-amber-800"
                            }`}>
                              {currentDiscussion.reconciliation.agreeWithCounterProposal 
                                ? `Agreed: ${currentDiscussion.reconciliation.action}` 
                                : `Declined: ${currentDiscussion.reconciliation.action}`}
                            </span>
                          </div>
                          <p className="text-xs text-forest-muted mt-1 leading-relaxed font-sans break-words [overflow-wrap:anywhere] max-h-48 overflow-y-auto pr-1">
                            {currentDiscussion.reconciliation.reasoning}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Final Decision Box */}
                    <div className="mt-2 border-t border-forest-dark/10 pt-3.5 flex flex-col gap-1 min-w-0">
                      <p className="text-[9px] uppercase font-bold text-forest-muted tracking-wider">Final Decision Reached</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`w-2 h-2 rounded-full ${
                          currentDiscussion.finalAction === "hold" 
                            ? "bg-forest-muted/50" 
                            : "bg-emerald-600 animate-pulse"
                        }`} />
                        <span className={`text-base font-serif font-black uppercase tracking-tight ${
                          currentDiscussion.finalAction === "hold" ? "text-forest-muted" : "text-emerald-800"
                        }`}>
                          {currentDiscussion.finalAction === "hold" ? "Hold (No Action)" : `${currentDiscussion.finalAction} (Executing Tx)`}
                        </span>
                      </div>
                      <p className="text-[11px] text-forest-muted mt-1 leading-relaxed font-sans break-words [overflow-wrap:anywhere] max-h-36 overflow-y-auto pr-1">
                        {currentDiscussion.finalReason}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-forest-dark/5 border border-forest-dark/10 rounded-2xl p-6 text-center">
                    <p className="text-xs text-forest-muted italic">No discussion data found for {activeVaultType} vault.</p>
                  </div>
                )}

                {/* History Badges List */}
                {activeDiscussions.length > 1 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted">Reasoning History</p>
                    <div className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-none">
                      {activeDiscussions.slice(0, 6).map((item: any, index: number) => {
                        const itemTime = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        const isSelected = selectedDiscussionTime 
                          ? selectedDiscussionTime === item.timestamp 
                          : index === 0;

                        return (
                          <button
                            key={item.timestamp}
                            type="button"
                            onClick={() => setSelectedDiscussionTime(item.timestamp)}
                            className={`px-3 py-1.5 rounded-xl border text-[10px] font-mono flex items-center gap-1.5 shrink-0 transition-all cursor-pointer ${
                              isSelected 
                                ? "bg-forest-dark text-cream-light border-forest-dark font-bold shadow-xs" 
                                : "bg-cream-card/75 text-forest-dark border-forest-dark/10 hover:bg-cream-card"
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              item.finalAction === "hold" ? "bg-forest-muted/40" : "bg-emerald-600"
                            }`} />
                            <span>{itemTime} ({item.finalAction.toUpperCase()})</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {renderAddressFooter(true)}
            </section>
          </>
        )}

        {/* ============================================================ */}
        {/* TAB 3: AGENT DECISIONS ("See What Happened" Section)          */}
        {/* ============================================================ */}
        {activeTab === "decisions" && (
          <>
            {/* LEFT COLUMN: EXECUTION OVERVIEW (Cream Background) */}
            <section className="w-full lg:w-[48%] xl:w-[45%] bg-cream-light p-6 sm:p-8 md:p-12 lg:p-16 flex flex-col justify-between items-start shrink-0 min-w-0 relative">
              <div className="my-8 lg:my-0 max-w-lg w-full min-w-0">
                <p className="text-[10px] font-bold tracking-[0.2em] text-forest-muted uppercase mb-4">
                  On-Chain Execution
                </p>
                <h1 className="text-3xl sm:text-4xl md:text-4xl lg:text-[2.75rem] xl:text-[3.25rem] font-serif font-black text-forest-dark tracking-tight leading-[0.95] uppercase mb-8 break-normal [word-break:normal] [overflow-wrap:normal]">
                  Confirmed<br />
                  Autonomous<br />
                  Actions.
                </h1>
                <p className="text-sm md:text-base text-forest-muted font-normal leading-relaxed mb-6 break-words">
                  Actions executed on Base Sepolia by the Parity Keeper upon dual-model consensus or automated safety triggers. Every rebalance, deleverage, and migration is confirmed on-chain and recorded immutably.
                </p>
                <p className="text-xs text-forest-muted/75 font-normal leading-relaxed border-l-2 border-forest-dark/20 pl-4 py-1 italic break-words mb-8">
                  Only executed transactions emit on-chain KeeperAction events. Inspect each confirmed transaction, verified APY snapshot, and model justification below.
                </p>

                <div className="w-full pt-4 border-t border-forest-dark/10">
                  <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted mb-3">Select Active Vault</p>
                  {renderVaultSwitcher()}
                </div>
              </div>

              {renderAddressFooter(false)}
            </section>

            {/* RIGHT COLUMN: ACTION LOGS & DECISIONS FEED (Sage Background) */}
            <section className="w-full lg:w-[52%] xl:w-[55%] bg-sage-green p-6 sm:p-8 md:p-12 lg:p-16 flex flex-col justify-start items-center gap-8 shrink-0 min-w-0 max-w-full overflow-x-hidden">
              
              <div className="w-full max-w-lg flex flex-col sm:flex-row gap-5 items-start my-4 lg:my-6">
                
                {/* Main action display card */}
                <div className="flex flex-col gap-3 w-full sm:flex-1 min-w-0">
                  <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted">Latest Agent Action</p>
                  {loadingEvents ? (
                    <div className="bg-cream-card border border-forest-dark/15 rounded-2xl p-6 shadow-sm flex items-center justify-center min-h-[18rem] w-full">
                      <p className="text-xs text-forest-muted italic animate-pulse">Loading on-chain events...</p>
                    </div>
                  ) : actionLogs.length === 0 ? (
                    <div className="bg-cream-card border border-forest-dark/15 rounded-2xl p-6 shadow-sm flex items-center justify-center min-h-[18rem] w-full">
                      <p className="text-xs text-forest-muted italic">No recent agent actions detected on-chain.</p>
                    </div>
                  ) : activeLog ? (
                    <div className="bg-cream-card border border-forest-dark/15 rounded-2xl p-5 md:p-6 shadow-sm flex flex-col justify-between gap-6 min-h-[18rem] h-auto w-full min-w-0">
                      <div className="min-w-0">
                        <span className={`text-[8px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full inline-block max-w-full truncate ${
                          activeLog.status.includes("Fallback") ? "bg-red-100 text-red-800" :
                          activeLog.status.includes("Reconciliation") ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                        }`}>
                          {activeLog.status}
                        </span>
                        
                        <h3 className="text-2xl sm:text-3xl font-serif italic text-forest-dark font-black mt-3 leading-tight break-normal [word-break:normal] [overflow-wrap:normal]">
                          {activeLog.action === "HOLD" && "Decision on Hold."}
                          {activeLog.action === "REBALANCE" && "Rebalance to Target."}
                          {activeLog.action === "DELEVERAGE" && "Deleverage Safety."}
                          {activeLog.action === "MIGRATE" && "Migrate Venues."}
                        </h3>
                        
                        <p className="text-xs text-forest-muted/95 mt-3 leading-relaxed font-sans break-words [overflow-wrap:anywhere] max-h-32 overflow-y-auto pr-1">
                          {activeLog.reason}
                        </p>
                      </div>

                      <div className="border-t border-forest-dark/10 pt-4 flex justify-between items-center text-[10px] text-forest-muted gap-2 min-w-0">
                        <span className="truncate">Net APY: <strong className="text-forest-dark">{activeLog.apy}</strong></span>
                        <span className="font-bold text-forest-dark font-mono uppercase shrink-0">{activeLog.time}</span>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Selector / Event History sidebar */}
                <div className="flex flex-col gap-3 w-full sm:w-40 md:w-44 shrink-0 min-w-0">
                  <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted">Decisions Feed</p>
                  {loadingEvents ? (
                    <p className="text-[10px] text-forest-muted italic animate-pulse">Loading...</p>
                  ) : actionLogs.length === 0 ? (
                    <p className="text-[10px] text-forest-muted italic">Empty.</p>
                  ) : (
                    <div className="flex flex-col gap-2 w-full max-h-72 overflow-y-auto pr-1">
                      {actionLogs.map((logItem, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setActiveLog(logItem)}
                          className={`text-left p-3 rounded-xl border transition-all cursor-pointer w-full min-w-0 ${
                            activeLog && activeLog.time === logItem.time 
                              ? "bg-forest-dark text-cream-light border-forest-dark" 
                              : "bg-cream-card/85 text-forest-dark border-forest-dark/10 hover:bg-cream-card"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 min-w-0">
                            <span className="text-[9px] font-bold uppercase tracking-wider font-mono shrink-0">{logItem.action}</span>
                            <span className="text-[8px] opacity-75 shrink-0">{logItem.time}</span>
                          </div>
                          <p className="text-[10px] font-sans truncate mt-1.5 opacity-90 leading-tight w-full">
                            {logItem.status}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

              </div>

              {renderAddressFooter(true)}
            </section>
          </>
        )}

      </main>

    </div>
  );
}
