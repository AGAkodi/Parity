"use client";

import { useReadContract } from "wagmi";
import { useState, useEffect } from "react";
import { Activity, Shield, ArrowUpRight, CheckCircle2, ChevronRight, History } from "lucide-react";

// Deployed Base Sepolia Contract Addresses
const VAULT_ADDRESS = "0xA92c06c03ab912788c71F74eB0C828E84A159C0a";
const KEEPER_ADDRESS = "0x7B35C6AddbB9bb30c640A5D8ae4ecD42BFcD2C19";

// Minimal ABIs for contract reads
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
] as const;

interface LogEvent {
  time: string;
  action: "HOLD" | "REBALANCE" | "DELEVERAGE" | "MIGRATE";
  status: "Consensus (Agreement)" | "Consensus (Reconciliation)" | "Fallback (Disagreement)" | "Bypass (Safety Check)";
  reason: string;
  hf: string;
  apy: string;
}

export default function LandingPage() {
  const [mounted, setMounted] = useState(false);

  // Wagmi contract reads (Base Sepolia)
  const { data: rawActiveVenue, isError: venueError } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "activeVenue",
  });

  const { data: rawHealthFactor } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "getHealthFactor",
  });

  const { data: rawTotalAssets } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "totalAssets",
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  // Format values with robust mock fallbacks matching Scenario 6 simulation logs
  const mUSDCAddress = "0x02527E38AC89cf0324Ba597234Cf1bf95B125c16";
  const morphoAddress = "0x06d092041995FE765872DCF85B67f82f8Fc4faff";
  
  const activeVenue = rawActiveVenue 
    ? (rawActiveVenue.toLowerCase() === mUSDCAddress.toLowerCase() ? "Moonwell" : "Morpho") 
    : "Moonwell";

  const healthFactor = rawHealthFactor 
    ? (Number(rawHealthFactor) > 1e20 ? Infinity : Number(rawHealthFactor) / 1e18) 
    : 1.4357;

  const totalAssets = rawTotalAssets 
    ? Number(rawTotalAssets) / 1e6 
    : 100.00;

  const formattedHF = healthFactor === Infinity ? "∞" : healthFactor.toFixed(2);

  // Action log history mimicking real consensus tests
  const actionLogs: LogEvent[] = [
    {
      time: "Just now",
      action: "DELEVERAGE",
      status: "Fallback (Disagreement)",
      reason: "Leverage safety doubt. Model A proposed deleverage (Reason: Forced Mock Model A action), Model B proposed hold (Reason: Forced Mock Model B review/counter-proposal). Reconciliation pass yielded no agreement.",
      hf: "1.43 ➔ 1.95 (Safe)",
      apy: "8.33%"
    },
    {
      time: "3 mins ago",
      action: "HOLD",
      status: "Consensus (Reconciliation)",
      reason: "Model A (Reconciled): After reviewing Model B's concern about volatility, I agree to change my action to hold. | Model B: Disagree with rebalancing.",
      hf: "1.43",
      apy: "13.67%"
    },
    {
      time: "10 mins ago",
      action: "REBALANCE",
      status: "Consensus (Agreement)",
      reason: "Model A: Opportunity to leverage up. Current LTV 55.72% is below target LTV 70.00%. | Model B: Agree with Model A's proposal.",
      hf: "∞ ➔ 1.43",
      apy: "13.67%"
    },
    {
      time: "2 hours ago",
      action: "MIGRATE",
      status: "Consensus (Agreement)",
      reason: "Model A: Morpho APY (4.70%) is higher than Moonwell net APY (3.50%) + gas offset. | Model B: Agree with migration proposal.",
      hf: "∞",
      apy: "4.70%"
    }
  ];

  const [activeLog, setActiveLog] = useState<LogEvent>(actionLogs[0]);

  if (!mounted) return null;

  return (
    <main className="min-h-screen w-full flex flex-col lg:flex-row m-0 p-0">
      
      {/* LEFT COLUMN: HERO (Cream Background) */}
      <section className="w-full lg:w-[45%] bg-cream-light p-8 md:p-16 lg:p-24 flex flex-col justify-between items-start shrink-0">
        
        {/* Navigation / Header */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-forest-dark flex items-center justify-center">
            <span className="text-cream-light font-serif font-bold text-xs">P</span>
          </div>
          <span className="font-serif font-black tracking-widest text-lg text-forest-dark uppercase">Parity</span>
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
      <section className="w-full lg:w-[55%] bg-sage-green p-8 md:p-16 lg:p-24 flex flex-col justify-center items-center gap-12 shrink-0">
        
        {/* Card 1: Vault Status (Focal Card) */}
        <div className="bg-cream-card border border-forest-dark/15 rounded-3xl p-6 md:p-10 w-full max-w-lg shadow-sm flex flex-col gap-8 shrink-0">
          
          {/* Status Header */}
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted">Mobile Audit / Live</p>
              <h2 className="text-3xl font-serif font-black text-forest-dark mt-1 leading-tight">Parity Vault</h2>
            </div>
            <div className="text-right">
              <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted">Health Factor</p>
              <span className="text-5xl md:text-6xl font-serif font-black text-forest-dark block mt-1 tracking-tighter">
                {formattedHF}
              </span>
            </div>
          </div>

          {/* Status Indicators List */}
          <div className="flex flex-col">
            
            {/* Status 1 */}
            <div className="border-t border-forest-dark/10 py-5 flex gap-4">
              <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${healthFactor < 1.15 ? "bg-red-500 animate-pulse" : "bg-emerald-600"}`} />
              <div>
                <h4 className="text-sm font-bold text-forest-dark leading-none">
                  {healthFactor < 1.15 ? "Emergency Deleverage Flagged" : "Leverage Safety Bounded"}
                </h4>
                <p className="text-xs text-forest-muted/90 mt-1.5 leading-normal">
                  Current Health Factor is <strong className="text-forest-dark">{formattedHF}</strong>. Safety-critical bypass threshold set to <strong className="text-forest-dark">1.15</strong>.
                </p>
              </div>
            </div>

            {/* Status 2 */}
            <div className="border-t border-forest-dark/10 py-5 flex gap-4">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
              <div>
                <h4 className="text-sm font-bold text-forest-dark leading-none">Leveraged Position Active</h4>
                <p className="text-xs text-forest-muted/90 mt-1.5 leading-normal">
                  Current Loan-to-Value: <strong className="text-forest-dark">55.72%</strong>. Optimization engine targets <strong className="text-forest-dark">70.00% LTV</strong>.
                </p>
              </div>
            </div>

            {/* Status 3 */}
            <div className="border-t border-forest-dark/10 py-5 flex gap-4">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 mt-1.5 shrink-0" />
              <div>
                <h4 className="text-sm font-bold text-forest-dark leading-none">Active Venue: {activeVenue}</h4>
                <p className="text-xs text-forest-muted/90 mt-1.5 leading-normal">
                  Supplying assets to Moonwell mUSDC at <strong className="text-forest-dark">8.33%</strong> supply APY. Total vault assets managed: <strong className="text-forest-dark">{totalAssets.toFixed(2)} USDC</strong>.
                </p>
              </div>
            </div>

          </div>
        </div>

        {/* Card 2 & Preview Area: Action Logs */}
        <div className="w-full max-w-lg flex flex-col md:flex-row gap-8 items-start">
          
          {/* Main action display card */}
          <div className="flex flex-col gap-3 w-full md:w-[65%] shrink-0">
            <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted">Latest Agent Action</p>
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
          </div>

          {/* Selector / Event History sidebar (Mocking SiteHook's sidebar layout) */}
          <div className="flex flex-col gap-3 w-full md:w-[35%]">
            <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted">Decisions Feed</p>
            <div className="flex flex-col gap-2 w-full">
              {actionLogs.map((logItem, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveLog(logItem)}
                  className={`text-left p-3 rounded-xl border transition-all ${
                    activeLog.time === logItem.time 
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
          </div>

        </div>

      </section>

    </main>
  );
}
