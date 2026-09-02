"use client";

import { 
  useAccount, 
  useConnect, 
  useDisconnect 
} from "wagmi";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Activity, Shield, ArrowUpRight, CheckCircle2, HelpCircle, ShieldCheck } from "lucide-react";

export default function LandingPage() {
  const [mounted, setMounted] = useState(false);

  const router = useRouter();

  // Wagmi wallet hooks
  const { isConnected } = useAccount();
  const { connect, connectors, isPending, error: wagmiConnectError } = useConnect();
  const { disconnect } = useDisconnect();

  const [connectionError, setConnectionError] = useState<string | null>(null);

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
    // Early return guard: prevent duplicate calls while already pending
    if (isPending) return;
    setConnectionError(null);

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
      alert("No Web3 wallet found. Please install MetaMask or Coinbase Wallet extension.");
    }
  };

  const displayError = connectionError || (wagmiConnectError ? (
    (wagmiConnectError as any)?.code === -32002 ||
    (wagmiConnectError as any)?.cause?.code === -32002 ||
    wagmiConnectError.message?.includes("-32002") ||
    wagmiConnectError.message?.toLowerCase().includes("already pending")
      ? "A connection request is already open — please check your wallet extension."
      : wagmiConnectError.message
  ) : null);

  return (
    <main className="min-h-screen w-full flex flex-col m-0 p-0">
      
      {/* TWO-COLUMN HERO */}
      <div className="w-full flex flex-col lg:flex-row">
        {/* LEFT COLUMN: HERO (Cream Background) */}
        <section className="w-full lg:w-[45%] bg-cream-light p-8 md:p-16 lg:p-24 flex flex-col justify-between items-start shrink-0">
          
          {/* Navigation / Header */}
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Parity Logo" className="w-9 h-9 object-contain rounded-lg shadow-sm" />
            <span className="font-serif font-black tracking-widest text-xl text-forest-dark uppercase">Parity</span>
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
              disabled={isPending}
              className={`bg-forest-dark text-cream-light text-xs font-bold uppercase tracking-wider px-8 py-4 rounded-xl transition-all flex items-center gap-2 shadow-sm ${
                isPending
                  ? "opacity-60 cursor-not-allowed"
                  : "hover:bg-forest-dark/90 cursor-pointer"
              }`}
            >
              {isPending ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-cream-light border-t-transparent rounded-full animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  Connect Wallet to Enter Vault
                  <ArrowUpRight className="w-4 h-4" />
                </>
              )}
            </button>

            {/* Connection Error Banner */}
            {displayError && (
              <div className="mt-4 p-3 bg-amber-50 border border-amber-300/80 rounded-xl text-xs text-amber-900 flex items-start justify-between gap-2 max-w-lg shadow-xs">
                <div className="flex items-start gap-2">
                  <span className="text-sm shrink-0">⚠️</span>
                  <span className="leading-snug">{displayError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setConnectionError(null)}
                  className="text-[10px] font-bold uppercase tracking-wider text-amber-900/60 hover:text-amber-900 shrink-0 cursor-pointer ml-2"
                >
                  ✕
                </button>
              </div>
            )}
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
      </div>

      {/* SECTION: HOW IT WORKS */}
      <section id="how-it-works" className="w-full bg-cream-light p-8 md:p-16 lg:p-24 border-t border-forest-dark/10 scroll-mt-6">
        <div className="max-w-5xl mx-auto">
          {/* Section Header */}
          <div className="flex flex-col items-center justify-center mb-16 text-center">
            <p className="text-[11px] font-bold tracking-[0.25em] text-forest-muted uppercase mb-3">
              The Mechanics
            </p>
            <div className="flex items-center gap-2 mb-4">
              <span className="w-8 h-[1.5px] bg-forest-muted/30" />
              <span className="w-1.5 h-1.5 rounded-full bg-forest-muted/60" />
              <span className="w-8 h-[1.5px] bg-forest-muted/30" />
            </div>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-serif font-black text-forest-dark tracking-tight uppercase">
              How Parity Works
            </h2>
          </div>

          {/* Stacked Rows with Alternating (Zigzag) Layout */}
          <div className="flex flex-col gap-4">
            
            {/* Step 01 (Desktop: Text Left, Icon Right) */}
            <div className="bg-cream-card border border-forest-dark/10 rounded-3xl p-6 md:p-10 flex flex-col md:flex-row items-center justify-between gap-8 shadow-xs">
              <div className="flex items-start gap-4 md:gap-6 flex-1">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-forest-dark flex items-center justify-center shrink-0">
                  <span className="text-cream-light font-serif font-bold text-sm md:text-base">01</span>
                </div>
                <div className="flex flex-col">
                  <h3 className="font-serif font-bold text-lg md:text-xl text-forest-dark mb-2">
                    You Deposit USDC
                  </h3>
                  <p className="text-xs md:text-sm text-forest-muted leading-relaxed max-w-lg">
                    Deposit USDC into the vault and receive shares in return — a standard, transparent claim on your proportional part of the vault, the same mechanism used by any reputable yield vault.
                  </p>
                </div>
              </div>
              <div className="w-36 h-36 md:w-48 md:h-48 shrink-0 flex items-center justify-center">
                <img 
                  src="/images/step_01.jpg" 
                  alt="You Deposit USDC" 
                  className="w-full h-full object-contain rounded-2xl drop-shadow-xs"
                />
              </div>
            </div>

            {/* Step 02 (Desktop: Icon Left, Text Right — Zigzag) */}
            <div className="bg-cream-card border border-forest-dark/10 rounded-3xl p-6 md:p-10 flex flex-col md:flex-row-reverse items-center justify-between gap-8 shadow-xs">
              <div className="flex items-start gap-4 md:gap-6 flex-1">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-forest-dark flex items-center justify-center shrink-0">
                  <span className="text-cream-light font-serif font-bold text-sm md:text-base">02</span>
                </div>
                <div className="flex flex-col">
                  <h3 className="font-serif font-bold text-lg md:text-xl text-forest-dark mb-2">
                    Your Funds Go to Work Immediately
                  </h3>
                  <p className="text-xs md:text-sm text-forest-muted leading-relaxed max-w-lg">
                    Your deposit is supplied into Moonwell, a lending market on Base, as collateral. It doesn't sit idle waiting for a decision — it starts earning the moment it lands.
                  </p>
                </div>
              </div>
              <div className="w-36 h-36 md:w-48 md:h-48 shrink-0 flex items-center justify-center">
                <img 
                  src="/images/step_02.jpg" 
                  alt="Your Funds Go to Work Immediately" 
                  className="w-full h-full object-contain rounded-2xl drop-shadow-xs"
                />
              </div>
            </div>

            {/* Step 03 (Desktop: Text Left, Icon Right — Zigzag) */}
            <div className="bg-cream-card border border-forest-dark/10 rounded-3xl p-6 md:p-10 flex flex-col md:flex-row items-center justify-between gap-8 shadow-xs">
              <div className="flex items-start gap-4 md:gap-6 flex-1">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-forest-dark flex items-center justify-center shrink-0">
                  <span className="text-cream-light font-serif font-bold text-sm md:text-base">03</span>
                </div>
                <div className="flex flex-col">
                  <h3 className="font-serif font-bold text-lg md:text-xl text-forest-dark mb-2">
                    The Vault Builds Leverage
                  </h3>
                  <p className="text-xs md:text-sm text-forest-muted leading-relaxed max-w-lg">
                    The vault borrows more against that collateral and resupplies it, looping until it reaches a target leverage level — 70% for the Aggressive vault, 50% for the Conservative vault. This is what grows your position.
                  </p>
                </div>
              </div>
              <div className="w-36 h-36 md:w-48 md:h-48 shrink-0 flex items-center justify-center">
                <img 
                  src="/images/step_03.jpg" 
                  alt="The Vault Builds Leverage" 
                  className="w-full h-full object-contain rounded-2xl drop-shadow-xs"
                />
              </div>
            </div>

            {/* Step 04 (Desktop: Icon Left, Text Right — Zigzag) */}
            <div className="bg-cream-card border border-forest-dark/10 rounded-3xl p-6 md:p-10 flex flex-col md:flex-row-reverse items-center justify-between gap-8 shadow-xs">
              <div className="flex items-start gap-4 md:gap-6 flex-1">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-forest-dark flex items-center justify-center shrink-0">
                  <span className="text-cream-light font-serif font-bold text-sm md:text-base">04</span>
                </div>
                <div className="flex flex-col">
                  <h3 className="font-serif font-bold text-lg md:text-xl text-forest-dark mb-2">
                    You Earn the Spread
                  </h3>
                  <p className="text-xs md:text-sm text-forest-muted leading-relaxed max-w-lg">
                    The vault earns Moonwell's supply rate on the larger, leveraged position while paying Moonwell's borrow rate on the borrowed portion. The gap between those two rates — amplified by leverage — is your yield.
                  </p>
                </div>
              </div>
              <div className="w-36 h-36 md:w-48 md:h-48 shrink-0 flex items-center justify-center">
                <img 
                  src="/images/step_04.jpg" 
                  alt="You Earn the Spread" 
                  className="w-full h-full object-contain rounded-2xl drop-shadow-xs"
                />
              </div>
            </div>

            {/* Step 05 (Desktop: Text Left, Icon Right — Zigzag) */}
            <div className="bg-cream-card border border-forest-dark/10 rounded-3xl p-6 md:p-10 flex flex-col md:flex-row items-center justify-between gap-8 shadow-xs">
              <div className="flex items-start gap-4 md:gap-6 flex-1">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-forest-dark flex items-center justify-center shrink-0">
                  <span className="text-cream-light font-serif font-bold text-sm md:text-base">05</span>
                </div>
                <div className="flex flex-col">
                  <h3 className="font-serif font-bold text-lg md:text-xl text-forest-dark mb-2">
                    The Agent Watches, Always
                  </h3>
                  <p className="text-xs md:text-sm text-forest-muted leading-relaxed max-w-lg">
                    From here, the agent takes over — continuously checking position health and market rates so you don't have to. A hard, code-enforced safety rule protects against liquidation risk with no AI judgment involved, while two independent AI models weigh in on softer calls like rebalance timing for smarter execution.
                  </p>
                </div>
              </div>
              <div className="w-36 h-36 md:w-48 md:h-48 shrink-0 flex items-center justify-center">
                <img 
                  src="/images/step_05.jpg" 
                  alt="The Agent Watches, Always" 
                  className="w-full h-full object-contain rounded-2xl drop-shadow-xs"
                />
              </div>
            </div>

            {/* Closing Row / CTA Strip */}
            <div className="bg-cream-card border border-forest-dark/10 rounded-3xl p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xs mt-2">
              <div className="flex items-center gap-4 md:gap-5 flex-1">
                <div className="w-12 h-12 rounded-2xl bg-forest-dark/10 border border-forest-dark/15 flex items-center justify-center shrink-0 text-forest-dark">
                  <ShieldCheck className="w-6 h-6 text-forest-dark" />
                </div>
                <div className="flex flex-col">
                  <h4 className="font-serif font-bold text-base md:text-lg text-forest-dark">
                    Built for Safety. Designed for Performance.
                  </h4>
                  <p className="text-xs md:text-sm text-forest-muted leading-relaxed">
                    Parity combines transparent DeFi mechanics with autonomous AI agents and hard-coded risk rules to deliver levered yield with confidence.
                  </p>
                </div>
              </div>
              <button
                onClick={handleConnect}
                disabled={isPending}
                className={`bg-forest-dark text-cream-light text-xs font-bold uppercase tracking-wider px-6 py-3.5 rounded-xl transition-all flex items-center gap-2 shrink-0 shadow-sm ${
                  isPending
                    ? "opacity-60 cursor-not-allowed"
                    : "hover:bg-forest-dark/90 cursor-pointer"
                }`}
              >
                {isPending ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-cream-light border-t-transparent rounded-full animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    Explore Parity
                    <ArrowUpRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="w-full bg-forest-dark text-cream-light p-8 md:p-16 lg:px-24 lg:py-16 border-t border-forest-dark shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col">
          {/* Main Footer Content */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 lg:gap-16 pb-12">
            
            {/* Column 1 — Brand */}
            <div className="flex flex-col items-start gap-4">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-cream-light flex items-center justify-center">
                  <span className="text-forest-dark font-serif font-bold text-xs">P</span>
                </div>
                <span className="font-serif font-black tracking-widest text-lg text-cream-light uppercase">Parity</span>
              </div>
              <p className="text-xs font-mono font-semibold tracking-wider text-sage-green uppercase">
                One Engine. Constant Vigilance.
              </p>
              <p className="text-xs text-cream-light/60 leading-relaxed max-w-sm">
                Autonomous leveraged yield optimizer operating on Base Sepolia testnet. Always review safety bounds and simulated parameters before entering.
              </p>
            </div>

            {/* Column 2 — Product */}
            <div className="flex flex-col items-start gap-3">
              <p className="text-[10px] font-bold tracking-[0.2em] text-cream-light/40 uppercase mb-1">
                Product
              </p>
              <a 
                href="#how-it-works" 
                className="text-xs text-cream-light/75 hover:text-cream-light transition-colors"
              >
                How It Works
              </a>
              <button 
                onClick={handleConnect} 
                disabled={isPending}
                className={`text-xs text-cream-light/75 hover:text-cream-light transition-colors text-left ${
                  isPending ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                }`}
              >
                {isPending ? "Connecting..." : "Connect Wallet"}
              </button>
              <Link 
                href="/vault" 
                className="text-xs text-cream-light/75 hover:text-cream-light transition-colors"
              >
                Vault Dashboard
              </Link>
            </div>

            {/* Column 3 — Built With / Transparency */}
            <div className="flex flex-col items-start gap-3">
              <p className="text-[10px] font-bold tracking-[0.2em] text-cream-light/40 uppercase mb-1">
                Built On
              </p>
              <p className="text-xs text-cream-light/75 leading-relaxed">
                Base · Moonwell · Morpho · Groq
              </p>
              <a 
                href="https://sepolia.basescan.org/address/0x72B04f9A0281F9BF84c164C3A27a8Ec70863Fa90"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-sage-green hover:underline flex items-center gap-1.5 mt-1"
              >
                <span>Verify Contracts on Basescan</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </div>

          </div>

          {/* Bottom Hairline Divider & Disclaimer */}
          <div className="pt-8 border-t border-cream-light/10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 text-[11px] text-cream-light/40">
            <p>Parity — Built for Hackathon, 2026</p>
            <p>Testnet only. Not financial advice.</p>
          </div>
        </div>
      </footer>

    </main>
  );
}
