"use client";

import { 
  useAccount, 
  useConnect, 
  useDisconnect 
} from "wagmi";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Activity, Shield, ArrowUpRight, CheckCircle2, HelpCircle } from "lucide-react";

export default function LandingPage() {
  const [mounted, setMounted] = useState(false);

  const router = useRouter();

  // Wagmi wallet hooks
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  // Redirect to vault dashboard if wallet is already connected
  useEffect(() => {
    if (mounted && isConnected) {
      router.push("/vault");
    }
  }, [isConnected, mounted, router]);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const handleConnect = () => {
    const connector = connectors.find((c) => c.id === "injected") || connectors[0];
    if (connector) {
      connect({ connector });
    } else {
      alert("No Web3 wallet found. Please install MetaMask or Coinbase Wallet extension.");
    }
  };

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
            Autonomous Leverage Optimization
          </p>
          <h1 className="text-5xl md:text-[5.5rem] font-serif font-black text-forest-dark tracking-tight leading-[0.85] uppercase mb-8">
            The Agent<br />
            That Watches<br />
            Your Yield,<br />
            So You Don't<br />
            Have To.
          </h1>
          <p className="text-sm md:text-base text-forest-muted font-normal leading-relaxed mb-8">
            Parity is an autonomous leveraged yield agent that manages USDC supply and borrowing strategies. 
            By continuously reading live market metrics on-chain, it deploys assets, optimizes debt loops, and manages safety boundaries dynamically.
          </p>

          {/* Primary Connect Wallet Call to Action */}
          <button
            onClick={handleConnect}
            className="bg-forest-dark text-cream-light text-xs font-bold uppercase tracking-wider px-8 py-4 rounded-xl hover:bg-forest-dark/90 transition-all flex items-center gap-2 cursor-pointer shadow-sm"
          >
            Connect Wallet to Enter Vault
            <ArrowUpRight className="w-4 h-4" />
          </button>
        </div>

        {/* Footer info / Meta */}
        <div className="text-[10px] text-forest-muted/60 uppercase tracking-widest flex flex-col gap-1 w-full border-t border-forest-dark/10 pt-6">
          <div className="flex justify-between w-full">
            <span>Powered by Base Sepolia</span>
            <span className="font-mono font-bold text-forest-dark">Live Testnet Demo</span>
          </div>
        </div>
      </section>

      {/* RIGHT COLUMN: DETAIL CARDS (Sage Background) */}
      <section className="w-full lg:w-[55%] bg-sage-green p-8 md:p-16 lg:p-24 flex flex-col justify-center items-center gap-6 shrink-0">
        
        {/* Card 1: How it Works */}
        <div className="bg-cream-card border border-forest-dark/15 rounded-3xl p-6 md:p-8 w-full max-w-lg shadow-sm flex gap-5">
          <div className="w-8 h-8 rounded-full bg-forest-dark/5 flex items-center justify-center shrink-0 text-forest-dark mt-1">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted">System Overview</p>
            <h3 className="text-lg font-serif font-bold text-forest-dark mt-1 leading-tight">Autonomous Execution</h3>
            <p className="text-xs text-forest-muted mt-2 leading-relaxed">
              Parity monitors lending market health factors, utilization rates, and rate spreads. When rebalancing parameters are met, the agent automatically loops leverage on-chain or migrates venues to maximize yield, executing decisions independently.
            </p>
          </div>
        </div>

        {/* Card 2: Consensus Mechanism */}
        <div className="bg-cream-card border border-forest-dark/15 rounded-3xl p-6 md:p-8 w-full max-w-lg shadow-sm flex gap-5">
          <div className="w-8 h-8 rounded-full bg-forest-dark/5 flex items-center justify-center shrink-0 text-forest-dark mt-1">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted">Safety Controls</p>
            <h3 className="text-lg font-serif font-bold text-forest-dark mt-1 leading-tight">Dual-Model AI Consensus</h3>
            <p className="text-xs text-forest-muted mt-2 leading-relaxed">
              Discretionary adjustments are proposed and cross-reviewed by two separate LLMs. If models disagree, the agent defaults to a safe hold state. Crucially, critical safety actions (emergency deleverage) are hardcoded in Solidity rules, bypassing AI consensus entirely for liquidation safety.
            </p>
          </div>
        </div>

        {/* Card 3: Dashboard & Participation */}
        <div className="bg-cream-card border border-forest-dark/15 rounded-3xl p-6 md:p-8 w-full max-w-lg shadow-sm flex gap-5">
          <div className="w-8 h-8 rounded-full bg-forest-dark/5 flex items-center justify-center shrink-0 text-forest-dark mt-1">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[9px] uppercase font-bold tracking-widest text-forest-muted">Dashboard Gating</p>
            <h3 className="text-lg font-serif font-bold text-forest-dark mt-1 leading-tight">Interactive Monitoring</h3>
            <p className="text-xs text-forest-muted mt-2 leading-relaxed">
              Unlock the interactive Parity dashboard by connecting your Web3 browser wallet. Once connected, you can deposit USDC to the vault, view your position equivalents in real time, and monitor live agent rebalances and on-chain logs.
            </p>
          </div>
        </div>

      </section>

    </main>
  );
}
