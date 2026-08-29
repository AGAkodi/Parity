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
    vaultAddress: (process.env.NEXT_PUBLIC_VAULT_ADDRESS || "0x72B04f9A0281F9BF84c164C3A27a8Ec70863Fa90") as `0x${string}`,
    keeperAddress: (process.env.NEXT_PUBLIC_KEEPER_ADDRESS || "0x64f5Ff15b5e7458BB10E064F4728281f14EFDb4e") as `0x${string}`,
    targetLtv: "70.00%",
    safetyThreshold: 1.10,
  },
  conservative: {
    name: "Conservative Vault",
    vaultAddress: (process.env.NEXT_PUBLIC_VAULT_ADDRESS_CONSERVATIVE || "0x4CefA66aF34174eC9aDDD6496D34C893De17952D") as `0x${string}`,
    keeperAddress: (process.env.NEXT_PUBLIC_KEEPER_ADDRESS_CONSERVATIVE || "0xF6846A9B498e56Aa814a0529Bbc3A123d694018a") as `0x${string}`,
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

  // When activeVaultType changes, reset the selected discussion to show the latest
  useEffect(() => {
    setSelectedDiscussionTime(null);
  }, [activeVaultType]);

  const router = useRouter();

  // Wagmi wallet and network hooks
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient();

  const isWrongChain = isConnected && chainId !== 84532; // Base Sepolia Chain ID is 84532

  // Redirect to landing page if wallet gets disconnected
  useEffect(() => {
    if (mounted && !isConnected) {
      router.push("/");
    }
  }, [isConnected, mounted, router]);

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

  const currentLTV = (rawMusdcBalance !== undefined && rawExchangeRate !== undefined && rawBorrowBalance !== undefined)
    ? (() => {
        const supplied = (BigInt(rawMusdcBalance) * BigInt(rawExchangeRate)) / 10n ** 18n;
        const borrowed = BigInt(rawBorrowBalance);
        return supplied > 0n ? Number((borrowed * 10000n) / supplied) / 100 : 0;
      })()
    : null;

  const secondsInYear = 31536000n;
  const supplyApy = rawSupplyRate
    ? (Number(BigInt(rawSupplyRate) * secondsInYear) / 1e16).toFixed(2)
    : "8.33";

  const formattedHF = healthFactor === null 
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

        const fromBlock = depositFlow.depositBlockNumber 
          ? (depositFlow.depositBlockNumber > 5n ? depositFlow.depositBlockNumber - 5n : 0n) 
          : 0n;

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
        const logs = await publicClient.getContractEvents({
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
          fromBlock: 0n,
        });

        const formattedLogs = logs.map((log: any) => {
          const { action, reason, hfBefore, hfAfter, apySnapshot, timestamp } = log.args;
          const timeVal = Number(timestamp);
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

          const hfBeforeStr = Number(hfBefore) > 1e20 ? "∞" : (Number(hfBefore) / 1e18).toFixed(2);
          const hfAfterStr = Number(hfAfter) > 1e20 ? "∞" : (Number(hfAfter) / 1e18).toFixed(2);

          let status: LogEvent["status"] = "Consensus (Agreement)";
          if (reason.toLowerCase().includes("fallback") || reason.toLowerCase().includes("disagreement")) {
            status = "Fallback (Disagreement)";
          } else if (reason.toLowerCase().includes("reconciliation") || reason.toLowerCase().includes("reconciled")) {
            status = "Consensus (Reconciliation)";
          } else if (reason.toLowerCase().includes("bypass") || reason.toLowerCase().includes("safety")) {
            status = "Bypass (Safety Check)";
          }

          return {
            time: timeStr,
            action: action.toUpperCase() as LogEvent["action"],
            status,
            reason,
            hf: `${hfBeforeStr} ➔ ${hfAfterStr}`,
            apy: `${(Number(apySnapshot) / 100).toFixed(2)}%`,
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
  }, [publicClient, activeVaultType]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Poll agent for discussions
  useEffect(() => {
    const agentUrl = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:3000";
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
  if (!mounted || !isConnected) {
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
    if (isConnected) {
      disconnect();
    } else {
      const connector = connectors.find((c: any) => c.id === "injected") || connectors[0];
      if (connector) {
        connect({ connector });
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
    : currentLTV !== null
      ? `${currentLTV.toFixed(2)}%`
      : "Error";
  const venueDisplay = loadingVenue ? "Loading..." : (activeVenue || "Error");
  const assetsDisplay = loadingAssets ? "Loading..." : (totalAssets !== null ? `${totalAssets.toFixed(2)} USDC` : "Error");

  const activeDiscussions = discussions.filter(
    (d: any) => d.vaultName.toLowerCase() === activeVaultType.toLowerCase()
  );
  
  const currentDiscussion = selectedDiscussionTime 
    ? activeDiscussions.find((d: any) => d.timestamp === selectedDiscussionTime) || activeDiscussions[0]
    : activeDiscussions[0];

  return (
    <main className="min-h-screen w-full flex flex-col lg:flex-row m-0 p-0">
      
      {/* Network mismatch warning banner */}
      {isWrongChain && (
        <div className="absolute top-0 left-0 w-full bg-amber-50 border-b border-amber-200 text-amber-800 text-xs px-4 py-2.5 text-center flex justify-center items-center gap-2 z-50">
          <span>Connected to the wrong chain. Please switch to Base Sepolia.</span>
          <button
            onClick={() => switchChain({ chainId: 84532 })}
            className="bg-amber-800 text-white font-bold px-3 py-1 rounded hover:bg-amber-900 transition-colors cursor-pointer text-[10px]"
          >
            Switch Network
          </button>
        </div>
      )}

      {/* LEFT COLUMN: HERO (Cream Background) */}
      <section className="w-full lg:w-[45%] bg-cream-light p-8 md:p-16 lg:p-24 flex flex-col justify-between items-start shrink-0 relative">
        
        {/* Navigation / Header with Connect Wallet button */}
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-forest-dark flex items-center justify-center">
              <span className="text-cream-light font-serif font-bold text-xs">P</span>
            </div>
            <span className="font-serif font-black tracking-widest text-lg text-forest-dark uppercase">Parity</span>
          </div>

          <button
            onClick={handleConnect}
            className="text-[10px] tracking-wider uppercase font-bold px-4 py-2 border border-forest-dark/20 rounded-full hover:bg-forest-dark hover:text-cream-light transition-all cursor-pointer"
          >
            {isConnected && address
              ? `${address.slice(0, 6)}...${address.slice(-4)} (Connected)`
              : "Connect Wallet"}
          </button>
        </div>

        {/* Hero Headline & Intro */}
        <div className="my-16 lg:my-0 max-w-lg">
          <p className="text-[10px] font-bold tracking-[0.2em] text-forest-muted uppercase mb-4">
            One Engine. Constant Vigilance.
          </p>
          <h1 className="text-5xl md:text-[5.5rem] font-serif font-black text-forest-dark tracking-tight leading-[0.85] uppercase mb-8">
            The Agent<br />
            That Watches<br />
            Your Yield,<br />
            So You Don't<br />
            Have To.
          </h1>
          <p className="text-sm md:text-base text-forest-muted font-normal leading-relaxed mb-6">
            Parity is an autonomous leveraged USDC yield agent operating on Base Sepolia. 
            By continuously reading live market metrics, it leverages deposits up to a target LTV, protects against high utilization, and migrates venues to capture optimal yields.
          </p>
          <p className="text-xs text-forest-muted/75 font-normal leading-relaxed border-l-2 border-forest-dark/20 pl-4 py-1 italic">
            Discretionary actions require strict, dual-model consensus between two diverse LLMs (gpt-oss-20b and gpt-oss-120b) via Groq, preserving deterministic rules for emergency health factor protection.
          </p>
        </div>

        {/* Footer info / Meta */}
        <div className="text-[10px] text-forest-muted/60 uppercase tracking-widest flex flex-col gap-1 w-full border-t border-forest-dark/10 pt-6">
          <div className="flex justify-between w-full">
            <span>Base Sepolia Address</span>
            <span className="font-mono font-bold text-forest-dark">{VAULT_ADDRESS.slice(0, 6)}...{VAULT_ADDRESS.slice(-4)}</span>
          </div>
          <div className="flex justify-between w-full">
            <span>Autonomous Keeper</span>
            <span className="font-mono font-bold text-forest-dark">{KEEPER_ADDRESS.slice(0, 6)}...{KEEPER_ADDRESS.slice(-4)}</span>
          </div>
        </div>
      </section>

      {/* RIGHT COLUMN: DASHBOARD & CARDS (Sage Background) */}
      <section className="w-full lg:w-[55%] bg-sage-green p-8 md:p-16 lg:p-24 flex flex-col justify-center items-center gap-8 shrink-0">
        
        {/* Side-by-Side Quick Stats Cards (Switcher) */}
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
                {rawHealthFactorAgg 
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
                {rawHealthFactorCons 
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

        {/* Card 1: Vault Status */}
        <div className="bg-cream-card border border-forest-dark/15 rounded-3xl p-6 md:p-10 w-full max-w-lg shadow-sm flex flex-col gap-8 shrink-0">
          
          {/* Status Header */}
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

          {/* Status Indicators List */}
          <div className="flex flex-col">
            
            {/* Status 1: Health Factor */}
            <div className="border-t border-forest-dark/10 py-5 flex gap-4">
              <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${healthFactor !== null && healthFactor < VAULTS[activeVaultType].safetyThreshold ? "bg-red-500 animate-pulse" : "bg-emerald-600"}`} />
              <div>
                <h4 className="text-sm font-bold text-forest-dark leading-none">
                  {healthFactor !== null && healthFactor < VAULTS[activeVaultType].safetyThreshold ? "Emergency Deleverage Flagged" : "Leverage Safety Bounded"}
                </h4>
                <p className="text-xs text-forest-muted/90 mt-1.5 leading-normal">
                  Current Health Factor is <strong className="text-forest-dark">{hfDisplay}</strong>. Safety-critical bypass threshold set to <strong className="text-forest-dark">{VAULTS[activeVaultType].safetyThreshold.toFixed(2)}</strong>.
                </p>
              </div>
            </div>

            {/* Status 2: LTV */}
            <div className="border-t border-forest-dark/10 py-5 flex gap-4">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
              <div>
                <h4 className="text-sm font-bold text-forest-dark leading-none">Leveraged Position Active</h4>
                <p className="text-xs text-forest-muted/90 mt-1.5 leading-normal">
                  Current Loan-to-Value: <strong className="text-forest-dark">{ltvDisplay}</strong>. Optimization engine targets <strong className="text-forest-dark">{VAULTS[activeVaultType].targetLtv} Target LTV</strong>.
                </p>
              </div>
            </div>

            {/* Status 3: Active Venue & APY */}
            <div className="border-t border-forest-dark/10 py-5 flex gap-4">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 mt-1.5 shrink-0" />
              <div>
                <h4 className="text-sm font-bold text-forest-dark leading-none">Active Venue: {venueDisplay}</h4>
                <p className="text-xs text-forest-muted/90 mt-1.5 leading-normal">
                  Supplying assets to Moonwell mUSDC at <strong className="text-forest-dark">{supplyApy}%</strong> supply APY. Total vault assets managed: <strong className="text-forest-dark">{assetsDisplay}</strong>.
                </p>
              </div>
            </div>

            {/* User Position status */}
            <div className="border-t border-forest-dark/10 pt-5">
              <div className="flex flex-col gap-2 bg-forest-dark/5 p-3 rounded-xl">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[10px] font-bold text-forest-muted uppercase">Your Shares</span>
                  <span className="font-mono font-bold text-forest-dark">
                    {loadingUserShares ? "Loading..." : `${userVaultShares ? (Number(userVaultShares) / 1e18).toFixed(4) : "0.0000"} prtUSDC`}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[10px] font-bold text-forest-muted uppercase">USDC Equivalent</span>
                  <span className="font-mono font-bold text-forest-dark">
                    {loadingUserAssets ? "Loading..." : `${userVaultAssets ? (Number(userVaultAssets) / 1e6).toFixed(2) : "0.00"} USDC`}
                  </span>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Card 1.5: Deposit USDC */}
        <div className="bg-cream-card border border-forest-dark/15 rounded-3xl p-6 md:p-10 w-full max-w-lg shadow-sm flex flex-col gap-6 shrink-0">
          <div>
            <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted">Transact / Deposit</p>
            <h2 className="text-3xl font-serif font-black text-forest-dark mt-1 leading-tight">Deposit USDC</h2>
            <p className="text-xs text-forest-muted mt-2 leading-relaxed">
              Supply USDC to the Parity Vault. The automated agent will automatically manage and optimize leverage loops.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            
            {/* User Balances Info */}
            <div className="grid grid-cols-2 gap-4 border-b border-forest-dark/10 pb-4 text-xs">
              <div>
                <p className="text-[9px] uppercase font-bold text-forest-muted">USDC Wallet Balance</p>
                <p className="font-mono font-bold text-forest-dark mt-1">
                  {loadingUserUsdc ? "Loading..." : `${userUsdcBalance ? (Number(userUsdcBalance) / 1e6).toFixed(2) : "0.00"} USDC`}
                </p>
              </div>
              <div>
                <p className="text-[9px] uppercase font-bold text-forest-muted">Your Vault Balance</p>
                <p className="font-mono font-bold text-forest-dark mt-1">
                  {loadingUserAssets ? "Loading..." : `${userVaultAssets ? (Number(userVaultAssets) / 1e6).toFixed(2) : "0.00"} USDC`}
                </p>
              </div>
            </div>

            {/* Input Form */}
            <div className="flex flex-col gap-2">
              <label className="text-[9px] uppercase font-bold tracking-widest text-forest-muted">Amount to Deposit</label>
              <div className="relative flex items-center">
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="0.00"
                  disabled={activeTxType !== null}
                  className="w-full bg-forest-dark/5 border border-forest-dark/15 rounded-xl px-4 py-3 text-sm font-mono font-bold text-forest-dark placeholder-forest-muted/50 focus:outline-none focus:border-forest-dark/35 transition-all"
                />
                <button
                  onClick={() => {
                    if (userUsdcBalance) {
                      setDepositAmount((Number(userUsdcBalance) / 1e6).toString());
                    }
                  }}
                  disabled={activeTxType !== null}
                  className="absolute right-3 bg-forest-dark/10 hover:bg-forest-dark/15 text-forest-dark text-[10px] font-bold px-2 py-1 rounded transition-all cursor-pointer"
                >
                  MAX
                </button>
              </div>
            </div>

            {/* Submit Buttons */}
            {isWrongChain ? (
              <button
                onClick={() => switchChain({ chainId: 84532 })}
                className="w-full bg-amber-800 text-white text-xs font-bold uppercase tracking-wider py-3.5 rounded-xl hover:bg-amber-900 transition-all cursor-pointer"
              >
                Switch to Base Sepolia
              </button>
            ) : (
              <button
                onClick={!hasAllowance ? handleApprove : handleDeposit}
                disabled={amountInWei === 0n || !hasUsdcBalance || activeTxType !== null || isConfirming}
                className="w-full bg-forest-dark text-cream-light text-xs font-bold uppercase tracking-wider py-3.5 rounded-xl hover:bg-forest-dark/95 disabled:bg-forest-dark/15 disabled:text-forest-muted transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {activeTxType === "approve" && (isConfirming ? "Confirming Approval..." : "Approving USDC...")}
                {activeTxType === "deposit" && (isConfirming ? "Confirming Deposit..." : "Depositing USDC...")}
                {activeTxType === null && (amountInWei === 0n ? "Enter amount" : !hasUsdcBalance ? "Insufficient USDC Balance" : !hasAllowance ? "Approve USDC" : "Deposit USDC")}
              </button>
            )}

            {/* Transaction Hash / Loading Message */}
            {txHash && (
              <div className="text-[10px] text-forest-muted leading-relaxed font-sans border-t border-forest-dark/10 pt-3">
                <span>Tx Hash: </span>
                <a
                  href={`https://sepolia.basescan.org/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline font-mono text-forest-dark hover:opacity-80"
                >
                  {txHash.slice(0, 10)}...{txHash.slice(-8)}
                </a>
                {isConfirming && <span className="block text-amber-600 mt-1 animate-pulse font-bold">Waiting for network confirmation...</span>}
                {isConfirmed && <span className="block text-emerald-600 mt-1 font-bold">Transaction confirmed successfully!</span>}

                {/* Post-Deposit Status Sequence */}
                {depositFlow && isConfirmed && (
                  <div className="mt-4 pt-4 border-t border-forest-dark/10 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted">
                        Position Pipeline
                      </p>
                      <span className="text-[9px] font-mono text-forest-muted/70">
                        {depositFlow.stage2 === "complete" ? "Leverage Applied" : depositFlow.stage2 === "pending" ? "Awaiting Agent Cycle" : "Agent Monitored"}
                      </span>
                    </div>

                    {/* Stage 1: Collateral Supplied */}
                    <div className="flex items-start gap-3 bg-forest-dark/5 p-3 rounded-xl">
                      <span className="w-2 h-2 rounded-full bg-emerald-600 mt-1 shrink-0" />
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-forest-dark leading-tight">
                          Stage 1: Collateral Supplied
                        </span>
                        <span className="text-[11px] text-forest-muted mt-0.5 leading-normal">
                          Your USDC is now supplying collateral on Moonwell.
                        </span>
                      </div>
                    </div>

                    {/* Stage 2: Leverage Position Building */}
                    <div className="flex items-start gap-3 bg-forest-dark/5 p-3 rounded-xl">
                      <span 
                        className={`w-2 h-2 rounded-full mt-1 shrink-0 ${
                          depositFlow.stage2 === "complete" 
                            ? "bg-emerald-600" 
                            : depositFlow.stage2 === "pending" 
                              ? "bg-amber-500 animate-pulse" 
                              : "bg-forest-muted/60"
                        }`} 
                      />
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-forest-dark leading-tight">
                          Stage 2: Leverage Position Building
                        </span>
                        <span className="text-[11px] text-forest-muted mt-0.5 leading-normal">
                          {depositFlow.stage2 === "complete" && (
                            <>Position leveraged to <strong className="text-forest-dark font-mono font-bold">{depositFlow.stage2Ltv !== null && depositFlow.stage2Ltv !== undefined ? `${depositFlow.stage2Ltv.toFixed(2)}%` : ltvDisplay} LTV</strong>.</>
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
        </div>

        {/* Card 1.8: Agent Discussion Feed */}
        <div className="bg-cream-card border border-forest-dark/15 rounded-3xl p-6 md:p-8 w-full max-w-lg shadow-sm flex flex-col gap-6 shrink-0">
          <div>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted">AI Consensus / Reasoning</p>
                <h2 className="text-3xl font-serif font-black text-forest-dark mt-1 leading-tight">Agent Discussion</h2>
              </div>
              <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                agentOnline === true 
                  ? "bg-emerald-100 text-emerald-800" 
                  : agentOnline === false 
                    ? "bg-rose-100 text-rose-800" 
                    : "bg-forest-dark/10 text-forest-muted animate-pulse"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  agentOnline === true 
                    ? "bg-emerald-600 animate-pulse" 
                    : agentOnline === false 
                      ? "bg-rose-600" 
                      : "bg-forest-muted/50"
                }`} />
                {agentOnline === true ? "Agent Online" : agentOnline === false ? "Agent Offline" : "Connecting..."}
              </span>
            </div>
            <p className="text-xs text-forest-muted mt-2 leading-relaxed">
              Real-time feed of the dual-model LLM reasoning process. Every 30 seconds, Model A (Proposer) and Model B (Reviewer) negotiate to reach a consensus decision.
            </p>
          </div>

          {agentOnline === false ? (
            <div className="bg-rose-50/50 border border-rose-100 rounded-2xl p-6 text-center">
              <p className="text-xs text-rose-800/80 font-medium italic">
                Agent discussion feed temporarily unavailable.
              </p>
              <p className="text-[10px] text-rose-800/60 mt-1 leading-normal font-sans">
                The off-chain monitoring server may be offline or restarting. On-chain safety rules remain active.
              </p>
            </div>
          ) : discussions.length === 0 ? (
            <div className="bg-forest-dark/5 border border-forest-dark/10 rounded-2xl p-6 text-center flex flex-col items-center justify-center gap-2">
              <div className="w-5 h-5 rounded-full border-2 border-forest-dark/10 border-t-forest-dark animate-spin" />
              <p className="text-xs text-forest-muted italic">Awaiting first agent reasoning cycle...</p>
            </div>
          ) : currentDiscussion ? (
            <div className="flex flex-col gap-5">
              
              {/* Detailed View of Selected/Latest Discussion */}
              <div className={`border rounded-2xl p-4 md:p-5 flex flex-col gap-4 transition-all ${
                currentDiscussion.finalAction === "hold" 
                  ? "bg-cream-card/40 border-forest-dark/10" 
                  : "bg-cream-card border-forest-dark/25 shadow-xs"
              }`}>
                {/* Discussion Header */}
                <div className="flex justify-between items-center border-b border-forest-dark/10 pb-3">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-forest-dark font-mono uppercase">
                      Cycle Snapshot
                    </span>
                    <span className="text-[9px] text-forest-muted/75 font-mono">
                      {new Date(currentDiscussion.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-forest-muted/65 bg-forest-dark/5 px-2 py-0.5 rounded">
                      HF: {currentDiscussion.healthFactor === Infinity ? "∞" : currentDiscussion.healthFactor.toFixed(2)}
                    </span>
                    <span className="text-[9px] font-mono text-forest-muted/65 bg-forest-dark/5 px-2 py-0.5 rounded">
                      LTV: {(currentDiscussion.currentLTV * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* conversation-style exchange */}
                <div className="flex flex-col gap-3.5">
                  {/* Model A Stack */}
                  {currentDiscussion.modelAProposal ? (
                    <div className="bg-forest-dark/5 p-3.5 rounded-2xl flex flex-col gap-1 border border-forest-dark/5">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-forest-dark flex items-center gap-1">
                          <span>🤖</span> Model A (Proposer)
                        </span>
                        <span className="text-[9px] font-mono font-bold bg-forest-dark/10 text-forest-dark px-2 py-0.5 rounded uppercase">
                          {currentDiscussion.modelAProposal.action}
                        </span>
                      </div>
                      <p className="text-xs text-forest-muted mt-1 leading-relaxed font-sans">
                        {currentDiscussion.modelAProposal.reasoning}
                      </p>
                    </div>
                  ) : (
                    <div className="bg-amber-50/70 border border-amber-200/50 p-3.5 rounded-2xl flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-900">
                        <span>🛡️</span> On-Chain Safety Bypass
                      </div>
                      <p className="text-xs text-amber-800 mt-1 leading-relaxed font-sans">
                        {currentDiscussion.finalReason}
                      </p>
                    </div>
                  )}

                  {/* Model B Stack */}
                  {currentDiscussion.modelBReview && (
                    <div className="bg-forest-dark/5 p-3.5 rounded-2xl flex flex-col gap-1 border border-forest-dark/5">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-forest-dark flex items-center gap-1">
                          <span>⚖️</span> Model B (Reviewer)
                        </span>
                        <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase ${
                          currentDiscussion.modelBReview.agree 
                            ? "bg-emerald-100 text-emerald-800" 
                            : "bg-rose-100 text-rose-800"
                        }`}>
                          {currentDiscussion.modelBReview.agree ? "Agree" : `Counter: ${currentDiscussion.modelBReview.action}`}
                        </span>
                      </div>
                      <p className="text-xs text-forest-muted mt-1 leading-relaxed font-sans">
                        {currentDiscussion.modelBReview.reasoning}
                      </p>
                    </div>
                  )}

                  {/* Reconciliation Pass Stack */}
                  {currentDiscussion.reconciliation && (
                    <div className="bg-amber-50/50 border border-amber-200/30 p-3.5 rounded-2xl flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 text-[10px] font-black text-amber-900">
                        <span>🔄</span> Reconciliation Outcome
                      </div>
                      <p className="text-xs text-forest-muted mt-1 leading-relaxed font-sans">
                        {currentDiscussion.reconciliation.reasoning}
                      </p>
                    </div>
                  )}
                </div>

                {/* Final Decision Box */}
                <div className={`mt-2 border-t border-forest-dark/10 pt-3.5 flex flex-col gap-1`}>
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
                  <p className="text-[11px] text-forest-muted mt-1 leading-relaxed font-sans">
                    {currentDiscussion.finalAction === "hold" 
                      ? "The consensus layer decided to hold the current allocation. Yield spread is optimal, and safety metrics are within boundaries."
                      : `The consensus layer resolved to take action: "${currentDiscussion.finalReason.split('|')[0].trim()}"`}
                  </p>
                </div>
              </div>

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
          ) : (
            <div className="bg-forest-dark/5 border border-forest-dark/10 rounded-2xl p-6 text-center">
              <p className="text-xs text-forest-muted italic">No discussion data found for {activeVaultType} vault.</p>
            </div>
          )}
        </div>

        {/* Card 2 & Preview Area: Action Logs */}
        <div className="w-full max-w-lg flex flex-col md:flex-row gap-8 items-start">
          
          {/* Main action display card */}
          <div className="flex flex-col gap-3 w-full md:w-[65%] shrink-0">
            <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted">Latest Agent Action</p>
            {loadingEvents ? (
              <div className="bg-cream-card border border-forest-dark/15 rounded-2xl p-6 shadow-sm flex items-center justify-center h-72">
                <p className="text-xs text-forest-muted italic animate-pulse">Loading on-chain events...</p>
              </div>
            ) : actionLogs.length === 0 ? (
              <div className="bg-cream-card border border-forest-dark/15 rounded-2xl p-6 shadow-sm flex items-center justify-center h-72">
                <p className="text-xs text-forest-muted italic">No recent agent actions detected on-chain.</p>
              </div>
            ) : activeLog ? (
              <div className="bg-cream-card border border-forest-dark/15 rounded-2xl p-6 shadow-sm flex flex-col justify-between gap-8 h-72">
                <div>
                  <span className={`text-[8px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full inline-block ${
                    activeLog.status.includes("Fallback") ? "bg-red-100 text-red-800" :
                    activeLog.status.includes("Reconciliation") ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                  }`}>
                    {activeLog.status}
                  </span>
                  
                  <h3 className="text-3xl font-serif italic text-forest-dark font-black mt-4 leading-tight">
                    {activeLog.action === "HOLD" && "Decision on Hold."}
                    {activeLog.action === "REBALANCE" && "Rebalance to Target."}
                    {activeLog.action === "DELEVERAGE" && "Deleverage Safety."}
                    {activeLog.action === "MIGRATE" && "Migrate Venues."}
                  </h3>
                  
                  <p className="text-xs text-forest-muted/95 mt-3 leading-relaxed font-sans line-clamp-4">
                    {activeLog.reason}
                  </p>
                </div>

                <div className="border-t border-forest-dark/10 pt-4 flex justify-between items-center text-[10px] text-forest-muted">
                  <span>Net APY: <strong className="text-forest-dark">{activeLog.apy}</strong></span>
                  <span className="font-bold text-forest-dark font-mono uppercase">{activeLog.time}</span>
                </div>
              </div>
            ) : null}
          </div>

          {/* Selector / Event History sidebar */}
          <div className="flex flex-col gap-3 w-full md:w-[35%]">
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
                    onClick={() => setActiveLog(logItem)}
                    className={`text-left p-3 rounded-xl border transition-all cursor-pointer ${
                      activeLog && activeLog.time === logItem.time 
                        ? "bg-forest-dark text-cream-light border-forest-dark" 
                        : "bg-cream-card/85 text-forest-dark border-forest-dark/10 hover:bg-cream-card"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold uppercase tracking-wider font-mono">{logItem.action}</span>
                      <span className="text-[8px] opacity-75">{logItem.time}</span>
                    </div>
                    <p className="text-[10px] font-sans truncate mt-1.5 opacity-90 leading-tight">
                      {logItem.status}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

        </div>

      </section>

    </main>
  );
}
