"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LandingPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email) {
        setUserEmail(session.user.email);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email || null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <div className="space-y-16 py-4">
      {/* Logged In Quick Switch Banner if user has active session */}
      {isMounted && userEmail && (
        <div className="border-2 border-[#1D3557] bg-[#1D3557]/10 p-4 flex flex-col sm:flex-row items-center justify-between gap-3 font-mono text-xs shadow-[3px_3px_0px_0px_#1D3557]">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#2A9D8F] inline-block" />
            <span className="text-[#0A0A0A]">
              Active session identified for <strong>{userEmail}</strong>
            </span>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-[#1D3557] text-[#FAFAFA] font-['Space_Grotesk'] font-bold uppercase hover:bg-[#E63946] transition-colors"
          >
            Go to Research Console &rarr;
          </Link>
        </div>
      )}

      {/* Hero Section */}
      <section className="border-2 border-[#0A0A0A] bg-[#FAFAFA] p-8 sm:p-12 relative overflow-hidden shadow-[6px_6px_0px_0px_#0A0A0A]">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#E63946] -mr-16 -mt-16 transform rotate-45 border-b-2 border-l-2 border-[#0A0A0A] hidden md:block" />
        
        <div className="max-w-4xl space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#0A0A0A] text-[#FAFAFA] font-mono text-xs uppercase tracking-widest">
            <span className="w-2 h-2 bg-[#E63946] inline-block" />
            <span>Autonomous Multi-Agent Swarm // Core 5.0</span>
          </div>

          <h1 className="font-['Archivo_Black'] text-4xl sm:text-6xl uppercase tracking-tight text-[#0A0A0A] leading-none">
            Literature Discovery &amp; Live LaTeX Synthesis
          </h1>

          <p className="font-['Inter'] text-lg sm:text-xl text-[#0A0A0A]/80 leading-relaxed font-normal max-w-3xl">
            Auto Research Swarm is a deterministic 5-node agentic state machine. It autonomously conducts deep academic literature reviews, enforces SSRF &amp; prompt-injection guardrails, and synthesizes publication-ready survey papers with a live Overleaf-grade LaTeX compiler.
          </p>

          {/* Action CTAs */}
          <div className="pt-4 flex flex-wrap items-center gap-4">
            <Link
              href="/auth/login"
              className="px-8 py-4 bg-[#E63946] text-[#FAFAFA] font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wide border-2 border-[#0A0A0A] shadow-[4px_4px_0px_0px_#0A0A0A] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_#0A0A0A] transition-all cursor-pointer"
            >
              Sign In to Swarm &rarr;
            </Link>
            
            <Link
              href="/dashboard"
              className="px-8 py-4 bg-[#FAFAFA] text-[#0A0A0A] font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wide border-2 border-[#0A0A0A] shadow-[4px_4px_0px_0px_#0A0A0A] hover:bg-[#0A0A0A] hover:text-[#FAFAFA] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_#0A0A0A] transition-all cursor-pointer"
            >
              Enter Research Console
            </Link>

            <Link
              href="/auth/register"
              className="px-6 py-4 font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wide text-[#1D3557] hover:underline cursor-pointer"
            >
              Create Account
            </Link>
          </div>
        </div>

        {/* Live Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-12 pt-8 border-t-2 border-[#0A0A0A] font-mono text-xs">
          <div className="p-3 bg-[#0A0A0A]/5 border border-[#0A0A0A]">
            <span className="text-[#0A0A0A]/60 block mb-1">NODE TOPOLOGY</span>
            <span className="font-['Space_Grotesk'] font-bold text-base text-[#0A0A0A]">5-Agent Graph</span>
          </div>
          <div className="p-3 bg-[#0A0A0A]/5 border border-[#0A0A0A]">
            <span className="text-[#0A0A0A]/60 block mb-1">TOOL ALLOCATION</span>
            <span className="font-['Space_Grotesk'] font-bold text-base text-[#0A0A0A]">Dynamic Budgeting</span>
          </div>
          <div className="p-3 bg-[#0A0A0A]/5 border border-[#0A0A0A]">
            <span className="text-[#0A0A0A]/60 block mb-1">SYNTHESIS ENGINE</span>
            <span className="font-['Space_Grotesk'] font-bold text-base text-[#E63946]">Overleaf-Style TeX</span>
          </div>
          <div className="p-3 bg-[#0A0A0A]/5 border border-[#0A0A0A]">
            <span className="text-[#0A0A0A]/60 block mb-1">HUMAN GATING</span>
            <span className="font-['Space_Grotesk'] font-bold text-base text-[#1D3557]">Zero-State Resumption</span>
          </div>
        </div>
      </section>

      {/* 5-Node Swarm Architecture Topology */}
      <section className="space-y-6">
        <div className="border-b-2 border-[#0A0A0A] pb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-3.5 h-3.5 bg-[#1D3557] inline-block border border-[#0A0A0A]" />
            <h2 className="font-['Space_Grotesk'] font-bold text-2xl uppercase tracking-tight text-[#0A0A0A]">
              Deterministic Swarm Topology
            </h2>
          </div>
          <span className="font-mono text-xs text-[#0A0A0A]/60 uppercase">Zero Shared Memory // Safe Nodes</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {/* Node 1 */}
          <div className="border-2 border-[#0A0A0A] bg-[#FAFAFA] p-5 space-y-3 shadow-[3px_3px_0px_0px_#0A0A0A]">
            <div className="flex justify-between items-center pb-2 border-b border-[#0A0A0A]/20">
              <span className="font-['Archivo_Black'] text-lg text-[#0A0A0A]">01</span>
              <span className="font-mono text-[10px] bg-[#0A0A0A] text-[#FAFAFA] px-1.5 py-0.5">PLANNER</span>
            </div>
            <h3 className="font-['Space_Grotesk'] font-bold text-sm uppercase">Goal Decomposition</h3>
            <p className="font-['Inter'] text-xs text-[#0A0A0A]/80 leading-relaxed">
              Accepts research prompts and recursively breaks them down into bounded subtasks with strict domain constraints.
            </p>
          </div>

          {/* Node 2 */}
          <div className="border-2 border-[#0A0A0A] bg-[#FAFAFA] p-5 space-y-3 shadow-[3px_3px_0px_0px_#0A0A0A]">
            <div className="flex justify-between items-center pb-2 border-b border-[#0A0A0A]/20">
              <span className="font-['Archivo_Black'] text-lg text-[#0A0A0A]">02</span>
              <span className="font-mono text-[10px] bg-[#0A0A0A] text-[#FAFAFA] px-1.5 py-0.5">RETRIEVER</span>
            </div>
            <h3 className="font-['Space_Grotesk'] font-bold text-sm uppercase">Multi-Source Discovery</h3>
            <p className="font-['Inter'] text-xs text-[#0A0A0A]/80 leading-relaxed">
              Scouts arXiv, academic repositories, and prioritized crawl targets with DNS egress protection and allowlist checking.
            </p>
          </div>

          {/* Node 3 */}
          <div className="border-2 border-[#0A0A0A] bg-[#FAFAFA] p-5 space-y-3 shadow-[3px_3px_0px_0px_#0A0A0A]">
            <div className="flex justify-between items-center pb-2 border-b border-[#0A0A0A]/20">
              <span className="font-['Archivo_Black'] text-lg text-[#0A0A0A]">03</span>
              <span className="font-mono text-[10px] bg-[#0A0A0A] text-[#FAFAFA] px-1.5 py-0.5">EXTRACTOR</span>
            </div>
            <h3 className="font-['Space_Grotesk'] font-bold text-sm uppercase">Sanitized Extraction</h3>
            <p className="font-['Inter'] text-xs text-[#0A0A0A]/80 leading-relaxed">
              Isolates DOM, strips tracking tags, extracts structured metadata, summaries, headings, and sanitizes untrusted input.
            </p>
          </div>

          {/* Node 4 */}
          <div className="border-2 border-[#E63946] bg-[#FAFAFA] p-5 space-y-3 shadow-[3px_3px_0px_0px_#E63946]">
            <div className="flex justify-between items-center pb-2 border-b border-[#E63946]/30">
              <span className="font-['Archivo_Black'] text-lg text-[#E63946]">04</span>
              <span className="font-mono text-[10px] bg-[#E63946] text-[#FAFAFA] px-1.5 py-0.5">VALIDATOR</span>
            </div>
            <h3 className="font-['Space_Grotesk'] font-bold text-sm uppercase text-[#E63946]">Guardrail &amp; Gate</h3>
            <p className="font-['Inter'] text-xs text-[#0A0A0A]/80 leading-relaxed">
              Scores paper confidence. Flags prompt injections and halts on uncertain verdicts to solicit human verification.
            </p>
          </div>

          {/* Node 5 */}
          <div className="border-2 border-[#2A9D8F] bg-[#FAFAFA] p-5 space-y-3 shadow-[3px_3px_0px_0px_#2A9D8F]">
            <div className="flex justify-between items-center pb-2 border-b border-[#2A9D8F]/30">
              <span className="font-['Archivo_Black'] text-lg text-[#2A9D8F]">05</span>
              <span className="font-mono text-[10px] bg-[#2A9D8F] text-[#FAFAFA] px-1.5 py-0.5">LATEX WRITER</span>
            </div>
            <h3 className="font-['Space_Grotesk'] font-bold text-sm uppercase text-[#2A9D8F]">Survey &amp; PDF</h3>
            <p className="font-['Inter'] text-xs text-[#0A0A0A]/80 leading-relaxed">
              Synthesizes academic survey articles in LaTeX with citations and tables, compiling them into downloadable PDFs.
            </p>
          </div>
        </div>
      </section>

      {/* Feature Pillars: TeX Editor, Review Queue, & Dynamic Budget */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="border-2 border-[#0A0A0A] bg-[#FAFAFA] p-6 space-y-3 shadow-[4px_4px_0px_0px_#0A0A0A]">
          <span className="font-mono text-xs text-[#E63946] font-bold uppercase block">[FEATURE // 01]</span>
          <h3 className="font-['Space_Grotesk'] font-bold text-lg uppercase text-[#0A0A0A]">
            Overleaf-Style TeX Studio
          </h3>
          <p className="font-['Inter'] text-sm text-[#0A0A0A]/80 leading-relaxed">
            Inspect generated LaTeX syntax in real time. Edit survey sections, modify bibtex citations, and compile live PDF previews with one click.
          </p>
        </div>

        <div className="border-2 border-[#0A0A0A] bg-[#FAFAFA] p-6 space-y-3 shadow-[4px_4px_0px_0px_#0A0A0A]">
          <span className="font-mono text-xs text-[#1D3557] font-bold uppercase block">[FEATURE // 02]</span>
          <h3 className="font-['Space_Grotesk'] font-bold text-lg uppercase text-[#0A0A0A]">
            Human Review Queue
          </h3>
          <p className="font-['Inter'] text-sm text-[#0A0A0A]/80 leading-relaxed">
            Uncertain paper verdicts pause the state machine at checkpoint boundaries. Review candidate articles, approve to resume, or discard to seek higher-quality sources.
          </p>
        </div>

        <div className="border-2 border-[#0A0A0A] bg-[#FAFAFA] p-6 space-y-3 shadow-[4px_4px_0px_0px_#0A0A0A]">
          <span className="font-mono text-xs text-[#2A9D8F] font-bold uppercase block">[FEATURE // 03]</span>
          <h3 className="font-['Space_Grotesk'] font-bold text-lg uppercase text-[#0A0A0A]">
            Dynamic Tool Allocation
          </h3>
          <p className="font-['Inter'] text-sm text-[#0A0A0A]/80 leading-relaxed">
            Replaces static budget ceilings with dynamic allocation computed from targeted pages and max tokens, preventing runaway LLM costs.
          </p>
        </div>
      </section>

      {/* Bottom CTA Banner */}
      <section className="border-2 border-[#0A0A0A] bg-[#0A0A0A] text-[#FAFAFA] p-8 sm:p-12 text-center space-y-6">
        <h2 className="font-['Archivo_Black'] text-3xl sm:text-4xl uppercase tracking-tight">
          Ready to Conduct Autonomous Literature Synthesis?
        </h2>
        <p className="font-['Inter'] text-base text-[#FAFAFA]/80 max-w-xl mx-auto leading-relaxed">
          Sign in to access your research workspace, configure Gemini or Groq model providers, and initiate your next research swarm.
        </p>
        <div className="pt-2 flex flex-wrap justify-center gap-4">
          <Link
            href="/auth/login"
            className="px-8 py-3.5 bg-[#E63946] text-[#FAFAFA] font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wide border-2 border-[#FAFAFA] hover:bg-[#FAFAFA] hover:text-[#0A0A0A] transition-colors cursor-pointer"
          >
            Sign In Now &rarr;
          </Link>
          <Link
            href="/dashboard"
            className="px-8 py-3.5 bg-transparent text-[#FAFAFA] font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wide border-2 border-[#FAFAFA] hover:bg-[#FAFAFA] hover:text-[#0A0A0A] transition-colors cursor-pointer"
          >
            Open Console (Demo)
          </Link>
        </div>
      </section>
    </div>
  );
}
