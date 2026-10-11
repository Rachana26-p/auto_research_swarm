import React from "react";
import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms and Conditions | Auto Research Swarm",
  description: "Terms of service and usage guidelines for the Autonomous Research Swarm multi-agent platform.",
};

export default function TermsAndConditionsPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-8 py-4">
      <div className="border-b-2 border-[#0A0A0A] pb-4">
        <div className="flex items-center gap-2 text-xs font-mono text-[#0A0A0A]/60 mb-1">
          <Link href="/" className="hover:underline">HOME</Link>
          <span>/</span>
          <span>LEGAL</span>
        </div>
        <h1 className="font-['Archivo_Black'] text-3xl uppercase tracking-tight text-[#0A0A0A]">
          Terms &amp; Conditions
        </h1>
        <p className="font-mono text-xs text-[#0A0A0A]/60 mt-1">
          Effective Date: October 2026 // Version 1.0
        </p>
      </div>

      <div className="border-2 border-[#0A0A0A] bg-[#FAFAFA] p-6 sm:p-8 space-y-6 font-['Inter'] text-sm leading-relaxed text-[#0A0A0A]">
        <section className="space-y-2">
          <h2 className="font-['Space_Grotesk'] font-bold text-base uppercase text-[#0A0A0A]">
            1. Acceptance of Terms
          </h2>
          <p>
            By accessing or launching research operations via Autonomous Research Swarm, you agree to comply with and be bound by
            these Terms and Conditions. If you do not accept these terms, you must discontinue platform use immediately.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-['Space_Grotesk'] font-bold text-base uppercase text-[#0A0A0A]">
            2. Permissible Research Conduct &amp; API Usage
          </h2>
          <ul className="list-disc pl-5 space-y-1 font-mono text-xs">
            <li><strong>Automated Exploration:</strong> Discovery and extraction agents crawl public academic domains (arXiv, Nature, IEEE, PubMed, OpenReview) adhering to rate limits and robots.txt constraints.</li>
            <li><strong>Forbidden Use:</strong> You may not direct the swarm to conduct unauthorized denial-of-service, penetration testing against private endpoints, or exfiltration of sensitive proprietary data.</li>
            <li><strong>Tool Budget Quotas:</strong> Resource limits (tokens, wall-clock time, and tool invocations) are bounded to safeguard infrastructure availability.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-['Space_Grotesk'] font-bold text-base uppercase text-[#0A0A0A]">
            3. Disclaimer of Scientific Warranty
          </h2>
          <p>
            While the platform employs multi-stage Validator heuristics to assess faithfulness and flag prompt injections,
            all generated research syntheses, LaTeX documents, and comparative matrices are provided for research reference only.
            Peer review verification remains the sole responsibility of the human researcher.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-['Space_Grotesk'] font-bold text-base uppercase text-[#0A0A0A]">
            4. Intellectual Property &amp; Generated LaTeX Artifacts
          </h2>
          <p>
            You retain full ownership of your compiled research outputs, synthesized LaTeX survey documents, and generated PDFs.
            Third-party scientific citations remain subject to their respective original open-access and copyright licenses.
          </p>
        </section>
      </div>

      <div className="flex justify-between items-center text-xs font-mono pt-4 border-t-2 border-[#0A0A0A]">
        <Link href="/" className="font-bold underline hover:text-[#E63946]">
          &larr; Return to Dashboard
        </Link>
        <Link href="/privacy" className="font-bold underline hover:text-[#E63946]">
          View Privacy Policy &rarr;
        </Link>
      </div>
    </div>
  );
}
