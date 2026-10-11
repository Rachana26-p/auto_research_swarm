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
        <div className="border-2 border-[#1D3557] dark:border-[#70B4FF] bg-[#1D3557]/10 dark:bg-[#1D3557]/20 p-4 flex flex-col sm:flex-row items-center justify-between gap-3 font-mono text-xs shadow-[3px_3px_0px_0px_#1D3557] dark:shadow-none">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#2A9D8F] inline-block" />
            <span className="text-[#0A0A0A] dark:text-[#EDEEF2]">
              Active session identified for <strong>{userEmail}</strong>
            </span>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-[#1D3557] text-[#FAFAFA] font-['Space_Grotesk'] font-bold uppercase hover:bg-[#E63946] dark:hover:bg-[#FF5C6C] transition-colors"
          >
            Go to Research Console &rarr;
          </Link>
        </div>
      )}

      {/* Hero Section */}
      <section className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-8 sm:p-12 relative overflow-hidden shadow-[6px_6px_0px_0px_#0A0A0A] dark:shadow-[6px_6px_0px_0px_rgba(0,0,0,0.7)] transition-colors">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#E63946] dark:bg-[#FF5C6C] -mr-16 -mt-16 transform rotate-45 border-b-2 border-l-2 border-[#0A0A0A] dark:border-[#2C3142] hidden md:block" />
        
        <div className="max-w-4xl space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#0A0A0A] dark:bg-[#EDEEF2] text-[#FAFAFA] dark:text-[#0A0A0A] font-mono text-xs uppercase tracking-widest">
            <span className="w-2 h-2 bg-[#E63946] dark:bg-[#FF5C6C] inline-block" />
            <span>Autonomous Multi-Agent Swarm // Core 5.0</span>
          </div>

          <h1 className="font-['Archivo_Black'] text-4xl sm:text-6xl uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2] leading-none">
            Literature Discovery &amp; Live LaTeX Synthesis
          </h1>

          <p className="font-['Inter'] text-lg sm:text-xl text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80 leading-relaxed font-normal max-w-3xl">
            Auto Research Swarm is a deterministic 5-node agentic state machine. It autonomously conducts deep academic literature reviews, enforces SSRF &amp; prompt-injection guardrails, and synthesizes publication-ready survey papers with a live Overleaf-grade LaTeX compiler.
          </p>

          {/* Action CTAs */}
          <div className="pt-4 flex flex-wrap items-center gap-4">
            {isMounted && userEmail ? (
              <Link
                href="/dashboard"
                className="px-8 py-4 bg-[#E63946] dark:bg-[#FF5C6C] text-[#FAFAFA] dark:text-[#0A0A0A] font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wide border-2 border-[#0A0A0A] dark:border-[#EDEEF2] shadow-[4px_4px_0px_0px_#0A0A0A] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:translate-x-0.5 hover:translate-y-0.5 transition-all cursor-pointer"
              >
                Enter Research Console &rarr;
              </Link>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  className="px-8 py-4 bg-[#E63946] dark:bg-[#FF5C6C] text-[#FAFAFA] dark:text-[#0A0A0A] font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wide border-2 border-[#0A0A0A] dark:border-[#EDEEF2] shadow-[4px_4px_0px_0px_#0A0A0A] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:translate-x-0.5 hover:translate-y-0.5 transition-all cursor-pointer"
                >
                  Sign In to Swarm &rarr;
                </Link>

                <Link
                  href="/auth/register"
                  className="px-8 py-4 bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wide border-2 border-[#0A0A0A] dark:border-[#2C3142] shadow-[4px_4px_0px_0px_#0A0A0A] dark:shadow-[4px_4px_0px_0px_rgba(0,0,0,0.5)] hover:bg-[#0A0A0A] hover:text-[#FAFAFA] dark:hover:bg-[#EDEEF2] dark:hover:text-[#0A0A0A] transition-all cursor-pointer"
                >
                  Create Account
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-12 pt-8 border-t-2 border-[#0A0A0A] dark:border-[#2C3142] font-mono text-xs">
          <div className="p-3 bg-[#0A0A0A]/5 dark:bg-[#FFFFFF]/5 border border-[#0A0A0A] dark:border-[#2C3142]">
            <span className="text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 block mb-1">NODE TOPOLOGY</span>
            <span className="font-['Space_Grotesk'] font-bold text-base text-[#0A0A0A] dark:text-[#EDEEF2]">5-Agent Graph</span>
          </div>
          <div className="p-3 bg-[#0A0A0A]/5 dark:bg-[#FFFFFF]/5 border border-[#0A0A0A] dark:border-[#2C3142]">
            <span className="text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 block mb-1">TOOL ALLOCATION</span>
            <span className="font-['Space_Grotesk'] font-bold text-base text-[#0A0A0A] dark:text-[#EDEEF2]">Dynamic Budgeting</span>
          </div>
          <div className="p-3 bg-[#0A0A0A]/5 dark:bg-[#FFFFFF]/5 border border-[#0A0A0A] dark:border-[#2C3142]">
            <span className="text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 block mb-1">SYNTHESIS ENGINE</span>
            <span className="font-['Space_Grotesk'] font-bold text-base text-[#E63946] dark:text-[#FF5C6C]">Overleaf-Style TeX</span>
          </div>
          <div className="p-3 bg-[#0A0A0A]/5 dark:bg-[#FFFFFF]/5 border border-[#0A0A0A] dark:border-[#2C3142]">
            <span className="text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 block mb-1">HUMAN GATING</span>
            <span className="font-['Space_Grotesk'] font-bold text-base text-[#1D3557] dark:text-[#70B4FF]">Zero-State Resumption</span>
          </div>
        </div>
      </section>

      {/* 5-Node Swarm Architecture Topology */}
      <section className="space-y-6">
        <div className="border-b-2 border-[#0A0A0A] dark:border-[#2C3142] pb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-3.5 h-3.5 bg-[#1D3557] dark:bg-[#70B4FF] inline-block border border-[#0A0A0A] dark:border-[#2C3142]" />
            <h2 className="font-['Space_Grotesk'] font-bold text-2xl uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2]">
              Deterministic Swarm Topology
            </h2>
          </div>
          <span className="font-mono text-xs text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 uppercase">Zero Shared Memory // Safe Nodes</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {/* Node 1 */}
          <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-5 space-y-3 shadow-[3px_3px_0px_0px_#0A0A0A] dark:shadow-none">
            <div className="flex justify-between items-center pb-2 border-b border-[#0A0A0A]/20 dark:border-[#2C3142]">
              <span className="font-['Archivo_Black'] text-lg text-[#0A0A0A] dark:text-[#EDEEF2]">01</span>
              <span className="font-mono text-[10px] bg-[#0A0A0A] dark:bg-[#EDEEF2] text-[#FAFAFA] dark:text-[#0A0A0A] px-1.5 py-0.5 font-bold">PLANNER</span>
            </div>
            <h3 className="font-['Space_Grotesk'] font-bold text-sm uppercase text-[#0A0A0A] dark:text-[#EDEEF2]">Goal Decomposition</h3>
            <p className="font-['Inter'] text-xs text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80 leading-relaxed">
              Accepts research prompts and recursively breaks them down into bounded subtasks with strict domain constraints.
            </p>
          </div>

          {/* Node 2 */}
          <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-5 space-y-3 shadow-[3px_3px_0px_0px_#0A0A0A] dark:shadow-none">
            <div className="flex justify-between items-center pb-2 border-b border-[#0A0A0A]/20 dark:border-[#2C3142]">
              <span className="font-['Archivo_Black'] text-lg text-[#0A0A0A] dark:text-[#EDEEF2]">02</span>
              <span className="font-mono text-[10px] bg-[#0A0A0A] dark:bg-[#EDEEF2] text-[#FAFAFA] dark:text-[#0A0A0A] px-1.5 py-0.5 font-bold">RETRIEVER</span>
            </div>
            <h3 className="font-['Space_Grotesk'] font-bold text-sm uppercase text-[#0A0A0A] dark:text-[#EDEEF2]">Multi-Source Discovery</h3>
            <p className="font-['Inter'] text-xs text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80 leading-relaxed">
              Scouts arXiv, academic repositories, and prioritized crawl targets with DNS egress protection and allowlist checking.
            </p>
          </div>

          {/* Node 3 */}
          <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-5 space-y-3 shadow-[3px_3px_0px_0px_#0A0A0A] dark:shadow-none">
            <div className="flex justify-between items-center pb-2 border-b border-[#0A0A0A]/20 dark:border-[#2C3142]">
              <span className="font-['Archivo_Black'] text-lg text-[#0A0A0A] dark:text-[#EDEEF2]">03</span>
              <span className="font-mono text-[10px] bg-[#0A0A0A] dark:bg-[#EDEEF2] text-[#FAFAFA] dark:text-[#0A0A0A] px-1.5 py-0.5 font-bold">EXTRACTOR</span>
            </div>
            <h3 className="font-['Space_Grotesk'] font-bold text-sm uppercase text-[#0A0A0A] dark:text-[#EDEEF2]">Sanitized Extraction</h3>
            <p className="font-['Inter'] text-xs text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80 leading-relaxed">
              Isolates DOM, strips tracking tags, extracts structured metadata, summaries, headings, and sanitizes untrusted input.
            </p>
          </div>

          {/* Node 4 */}
          <div className="border-2 border-[#E63946] dark:border-[#FF5C6C] bg-[#FAFAFA] dark:bg-[#14161E] p-5 space-y-3 shadow-[3px_3px_0px_0px_#E63946] dark:shadow-none">
            <div className="flex justify-between items-center pb-2 border-b border-[#E63946]/30 dark:border-[#FF5C6C]/30">
              <span className="font-['Archivo_Black'] text-lg text-[#E63946] dark:text-[#FF5C6C]">04</span>
              <span className="font-mono text-[10px] bg-[#E63946] dark:bg-[#FF5C6C] text-[#FAFAFA] dark:text-[#0A0A0A] px-1.5 py-0.5 font-bold">VALIDATOR</span>
            </div>
            <h3 className="font-['Space_Grotesk'] font-bold text-sm uppercase text-[#E63946] dark:text-[#FF5C6C]">Guardrail &amp; Gate</h3>
            <p className="font-['Inter'] text-xs text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80 leading-relaxed">
              Scores paper confidence. Flags prompt injections and halts on uncertain verdicts to solicit human verification.
            </p>
          </div>

          {/* Node 5 */}
          <div className="border-2 border-[#2A9D8F] dark:border-[#48CAE4] bg-[#FAFAFA] dark:bg-[#14161E] p-5 space-y-3 shadow-[3px_3px_0px_0px_#2A9D8F] dark:shadow-none">
            <div className="flex justify-between items-center pb-2 border-b border-[#2A9D8F]/30 dark:border-[#48CAE4]/30">
              <span className="font-['Archivo_Black'] text-lg text-[#2A9D8F] dark:text-[#48CAE4]">05</span>
              <span className="font-mono text-[10px] bg-[#2A9D8F] dark:bg-[#48CAE4] text-[#FAFAFA] dark:text-[#0A0A0A] px-1.5 py-0.5 font-bold">LATEX WRITER</span>
            </div>
            <h3 className="font-['Space_Grotesk'] font-bold text-sm uppercase text-[#2A9D8F] dark:text-[#48CAE4]">Survey &amp; PDF</h3>
            <p className="font-['Inter'] text-xs text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80 leading-relaxed">
              Synthesizes academic survey articles in LaTeX with citations and tables, compiling them into downloadable PDFs.
            </p>
          </div>
        </div>
      </section>

      {/* Feature Pillars: TeX Editor, Review Queue, & Dynamic Budget */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-6 space-y-3 shadow-[4px_4px_0px_0px_#0A0A0A] dark:shadow-none">
          <span className="font-mono text-xs text-[#E63946] dark:text-[#FF5C6C] font-bold uppercase block">[FEATURE // 01]</span>
          <h3 className="font-['Space_Grotesk'] font-bold text-lg uppercase text-[#0A0A0A] dark:text-[#EDEEF2]">
            Overleaf-Style TeX Studio
          </h3>
          <p className="font-['Inter'] text-sm text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80 leading-relaxed">
            Inspect generated LaTeX syntax in real time. Edit survey sections, modify bibtex citations, and compile live PDF previews with one click.
          </p>
        </div>

        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-6 space-y-3 shadow-[4px_4px_0px_0px_#0A0A0A] dark:shadow-none">
          <span className="font-mono text-xs text-[#1D3557] dark:text-[#70B4FF] font-bold uppercase block">[FEATURE // 02]</span>
          <h3 className="font-['Space_Grotesk'] font-bold text-lg uppercase text-[#0A0A0A] dark:text-[#EDEEF2]">
            Human Review Queue
          </h3>
          <p className="font-['Inter'] text-sm text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80 leading-relaxed">
            Uncertain paper verdicts pause the state machine at checkpoint boundaries. Review candidate articles, approve to resume, or discard to seek higher-quality sources.
          </p>
        </div>

        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-6 space-y-3 shadow-[4px_4px_0px_0px_#0A0A0A] dark:shadow-none">
          <span className="font-mono text-xs text-[#2A9D8F] dark:text-[#48CAE4] font-bold uppercase block">[FEATURE // 03]</span>
          <h3 className="font-['Space_Grotesk'] font-bold text-lg uppercase text-[#0A0A0A] dark:text-[#EDEEF2]">
            Dynamic Tool Allocation
          </h3>
          <p className="font-['Inter'] text-sm text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80 leading-relaxed">
            Replaces static budget ceilings with dynamic allocation computed from targeted pages and max tokens, preventing runaway LLM costs.
          </p>
        </div>
      </section>

      {/* Bottom CTA Banner */}
      <section className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#0A0A0A] dark:bg-[#101217] text-[#FAFAFA] dark:text-[#EDEEF2] p-8 sm:p-12 text-center space-y-6">
        <h2 className="font-['Archivo_Black'] text-3xl sm:text-4xl uppercase tracking-tight">
          Ready to Conduct Autonomous Literature Synthesis?
        </h2>
        <p className="font-['Inter'] text-base text-[#FAFAFA]/80 dark:text-[#EDEEF2]/80 max-w-xl mx-auto leading-relaxed">
          Sign in to access your isolated research workspace, configure Gemini or Groq model providers, and initiate your next research swarm.
        </p>
        <div className="pt-2 flex flex-wrap justify-center gap-4">
          {isMounted && userEmail ? (
            <Link
              href="/dashboard"
              className="px-8 py-3.5 bg-[#E63946] dark:bg-[#FF5C6C] text-[#FAFAFA] dark:text-[#0A0A0A] font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wide border-2 border-[#FAFAFA] dark:border-[#EDEEF2] hover:bg-[#FAFAFA] hover:text-[#0A0A0A] transition-colors cursor-pointer"
            >
              Enter Research Console &rarr;
            </Link>
          ) : (
            <>
              <Link
                href="/auth/login"
                className="px-8 py-3.5 bg-[#E63946] dark:bg-[#FF5C6C] text-[#FAFAFA] dark:text-[#0A0A0A] font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wide border-2 border-[#FAFAFA] dark:border-[#EDEEF2] hover:bg-[#FAFAFA] hover:text-[#0A0A0A] transition-colors cursor-pointer"
              >
                Sign In Now &rarr;
              </Link>
              <Link
                href="/auth/register"
                className="px-8 py-3.5 bg-transparent text-[#FAFAFA] dark:text-[#EDEEF2] font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wide border-2 border-[#FAFAFA] dark:border-[#2C3142] hover:bg-[#FAFAFA] hover:text-[#0A0A0A] dark:hover:bg-[#EDEEF2] dark:hover:text-[#0A0A0A] transition-colors cursor-pointer"
              >
                Create Account
              </Link>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
