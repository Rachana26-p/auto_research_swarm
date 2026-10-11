import React from "react";
import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | Auto Research Swarm",
  description: "Privacy policy and data governance practices for the Autonomous Research Swarm platform.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-8 py-4">
      <div className="border-b-2 border-[#0A0A0A] pb-4">
        <div className="flex items-center gap-2 text-xs font-mono text-[#0A0A0A]/60 mb-1">
          <Link href="/" className="hover:underline">HOME</Link>
          <span>/</span>
          <span>COMPLIANCE</span>
        </div>
        <h1 className="font-['Archivo_Black'] text-3xl uppercase tracking-tight text-[#0A0A0A]">
          Privacy Policy &amp; Data Governance
        </h1>
        <p className="font-mono text-xs text-[#0A0A0A]/60 mt-1">
          Effective Date: October 2026 // Version 1.0
        </p>
      </div>

      <div className="border-2 border-[#0A0A0A] bg-[#FAFAFA] p-6 sm:p-8 space-y-6 font-['Inter'] text-sm leading-relaxed text-[#0A0A0A]">
        <section className="space-y-2">
          <h2 className="font-['Space_Grotesk'] font-bold text-base uppercase text-[#0A0A0A]">
            1. Overview &amp; Architectural Isolation
          </h2>
          <p>
            Autonomous Research Swarm operates an isolated multi-agent execution pipeline. When you initiate research queries,
            our planner, discovery, extractor, validator, and writer agents operate strictly within cryptographic guardrails.
            User research sessions are isolated by authenticated user identifier and protected under Postgres Row Level Security (RLS).
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-['Space_Grotesk'] font-bold text-base uppercase text-[#0A0A0A]">
            2. Information We Process
          </h2>
          <ul className="list-disc pl-5 space-y-1 font-mono text-xs">
            <li><strong>Account Identity:</strong> Email address, authentication tokens, and workspace preferences managed securely through Supabase Auth.</li>
            <li><strong>Research Goals &amp; Queries:</strong> Natural language research objectives input to the supervisor orchestrator.</li>
            <li><strong>Audit Logs &amp; Metrics:</strong> Token expenditures, tool invocations, and guardrail decision logs for runtime safety.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-['Space_Grotesk'] font-bold text-base uppercase text-[#0A0A0A]">
            3. Data Retention &amp; Vector Embeddings
          </h2>
          <p>
            Extracted paper summaries and 768-dimensional vector embeddings are stored in customer-isolated knowledge tables.
            We do not sell, rent, or trade your research artifacts or telemetry with external advertising brokers.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-['Space_Grotesk'] font-bold text-base uppercase text-[#0A0A0A]">
            4. Security Guardrails &amp; Egress Policy
          </h2>
          <p>
            Our backend enforces Server-Side Request Forgery (SSRF) filters and egress blocklists preventing private IP resolution (RFC 1918/Loopback).
            Every candidate paper is validated for faithfulness before knowledge indexing.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-['Space_Grotesk'] font-bold text-base uppercase text-[#0A0A0A]">
            5. Contact &amp; Rights
          </h2>
          <p>
            You may request deletion of all historical runs, chats, and vector embeddings at any time through workspace settings.
            For compliance inquiries: <span className="font-mono text-xs font-bold">compliance@autoresearchswarm.internal</span>.
          </p>
        </section>
      </div>

      <div className="flex justify-between items-center text-xs font-mono pt-4 border-t-2 border-[#0A0A0A]">
        <Link href="/" className="font-bold underline hover:text-[#E63946]">
          &larr; Return to Dashboard
        </Link>
        <Link href="/terms" className="font-bold underline hover:text-[#E63946]">
          View Terms &amp; Conditions &rarr;
        </Link>
      </div>
    </div>
  );
}
