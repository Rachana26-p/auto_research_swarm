"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, StatusDot } from "@/components";
import { createRun, getRuns, RunSummaryResponse } from "@/lib/api";

export default function HomePage() {
  const router = useRouter();

  // Form State
  const [goal, setGoal] = useState("");
  const [maxPages, setMaxPages] = useState(20);
  const [maxTokens, setMaxTokens] = useState(500000);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Runs List State
  const [runs, setRuns] = useState<RunSummaryResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRunsList = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getRuns();
      setRuns(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getRuns();
        if (active) {
          setRuns(data);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load runs");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedGoal = goal.trim();
    if (!trimmedGoal) {
      setFormError("Research goal cannot be empty");
      return;
    }
    if (trimmedGoal.length > 5000) {
      setFormError("Research goal exceeds maximum length of 5000 characters");
      return;
    }

    setSubmitting(true);
    try {
      const newRun = await createRun({
        goal: trimmedGoal,
        max_pages: Number(maxPages),
        max_tokens: Number(maxTokens),
      });
      router.push(`/runs/${newRun.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to launch run");
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-12">
      {/* Hero Section */}
      <div className="border-b-2 border-[#0A0A0A] pb-8">
        <div className="flex items-center gap-3 mb-2">
          <span className="w-3 h-3 bg-[#E63946] inline-block" />
          <span className="font-mono text-xs uppercase tracking-widest text-[#0A0A0A]/60">
            System Controller // Phase 3
          </span>
        </div>
        <h1 className="font-['Archivo_Black'] text-4xl sm:text-5xl uppercase tracking-tight text-[#0A0A0A] leading-none mb-4">
          Autonomous Research Swarm
        </h1>
        <p className="font-['Inter'] text-base text-[#0A0A0A]/80 max-w-2xl leading-relaxed">
          Deterministic 5-agent state machine. Planner decomposes goals,
          Discovery scouts domains, Extractor retrieves pure structured data,
          Validator gates quality, and Writer synthesizes knowledge articles.
        </p>
      </div>

      {/* Main Grid: Goal Launch Form & Status */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Launch Form (7 cols) */}
        <div className="lg:col-span-7 border-2 border-[#0A0A0A] bg-[#FAFAFA] p-6 sm:p-8">
          <div className="flex items-center justify-between pb-4 border-b-2 border-[#0A0A0A] mb-6">
            <h2 className="font-['Space_Grotesk'] font-bold text-xl uppercase tracking-tight">
              Initialize Research Run
            </h2>
            <span className="font-mono text-xs uppercase text-[#E63946] font-bold">
              [GOAL INPUT]
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {formError && (
              <div className="p-4 bg-[#E63946]/10 border-2 border-[#E63946] text-[#E63946] font-mono text-xs">
                <span className="font-bold">ERROR: </span>
                {formError}
              </div>
            )}

            <div>
              <div className="flex justify-between items-center mb-2">
                <label
                  htmlFor="goal-input"
                  className="font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wide text-[#0A0A0A]"
                >
                  Research Goal / Objective
                </label>
                <span className="font-mono text-xs text-[#0A0A0A]/50">
                  {goal.length} / 5000
                </span>
              </div>
              <textarea
                id="goal-input"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="e.g., Investigate recent breakthrough quantum computing error mitigation algorithms published in 2026..."
                rows={5}
                required
                className="w-full border-2 border-[#0A0A0A] p-4 font-['Inter'] text-sm bg-[#FAFAFA] text-[#0A0A0A] placeholder-[#0A0A0A]/40 focus:outline-none focus:border-[#E63946] transition-colors resize-y radius-sm"
              />
            </div>

            {/* Budget Configuration */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label
                  htmlFor="max-pages-input"
                  className="block font-['Space_Grotesk'] font-bold text-xs uppercase text-[#0A0A0A] mb-1"
                >
                  Max Pages Budget
                </label>
                <input
                  id="max-pages-input"
                  type="number"
                  min={1}
                  max={100}
                  value={maxPages}
                  onChange={(e) => setMaxPages(Number(e.target.value))}
                  className="w-full border-2 border-[#0A0A0A] p-2.5 font-mono text-sm bg-[#FAFAFA] text-[#0A0A0A] focus:outline-none focus:border-[#E63946] radius-sm"
                />
              </div>

              <div>
                <label
                  htmlFor="max-tokens-input"
                  className="block font-['Space_Grotesk'] font-bold text-xs uppercase text-[#0A0A0A] mb-1"
                >
                  Max Token Budget
                </label>
                <input
                  id="max-tokens-input"
                  type="number"
                  min={1000}
                  max={2000000}
                  step={10000}
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                  className="w-full border-2 border-[#0A0A0A] p-2.5 font-mono text-sm bg-[#FAFAFA] text-[#0A0A0A] focus:outline-none focus:border-[#E63946] radius-sm"
                />
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={submitting}
              className="w-full mt-4"
            >
              Start Autonomous Run &rarr;
            </Button>
          </form>
        </div>

        {/* Swarm Architecture Summary Card (5 cols) */}
        <div className="lg:col-span-5 border-2 border-[#0A0A0A] bg-[#FAFAFA] p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 pb-4 border-b-2 border-[#0A0A0A] mb-4">
              <span className="w-3 h-3 bg-[#1D3557] inline-block" />
              <h2 className="font-['Space_Grotesk'] font-bold text-xl uppercase tracking-tight">
                Node Topology
              </h2>
            </div>
            <p className="font-['Inter'] text-sm text-[#0A0A0A]/80 mb-6 leading-relaxed">
              Every research run passes through strictly isolated nodes. No
              direct agent-to-agent memory or unvalidated writes.
            </p>

            <ul className="space-y-3 font-mono text-xs">
              <li className="flex items-start gap-2 border-l-2 border-[#0A0A0A] pl-3 py-0.5">
                <span className="font-bold text-[#0A0A0A]">01 PLANNER</span>
                <span className="text-[#0A0A0A]/70">— Decomposes into bounded subtasks</span>
              </li>
              <li className="flex items-start gap-2 border-l-2 border-[#0A0A0A] pl-3 py-0.5">
                <span className="font-bold text-[#0A0A0A]">02 DISCOVERY</span>
                <span className="text-[#0A0A0A]/70">— Discovers ranked web sources</span>
              </li>
              <li className="flex items-start gap-2 border-l-2 border-[#0A0A0A] pl-3 py-0.5">
                <span className="font-bold text-[#0A0A0A]">03 EXTRACTOR</span>
                <span className="text-[#0A0A0A]/70">— Pure structured extraction (SSRF guarded)</span>
              </li>
              <li className="flex items-start gap-2 border-l-2 border-[#E63946] pl-3 py-0.5">
                <span className="font-bold text-[#E63946]">04 VALIDATOR</span>
                <span className="text-[#0A0A0A]/70">— Faithfulness & injection gate</span>
              </li>
              <li className="flex items-start gap-2 border-l-2 border-[#2A9D8F] pl-3 py-0.5">
                <span className="font-bold text-[#2A9D8F]">05 WRITER</span>
                <span className="text-[#0A0A0A]/70">— Atomic Markdown & embedding persistence</span>
              </li>
            </ul>
          </div>

          <div className="mt-8 pt-4 border-t border-[#0A0A0A]/20 flex justify-between items-center text-xs font-mono text-[#0A0A0A]/60">
            <span>EGRESS ALLOWLIST ACTIVE</span>
            <span>PROMPT INJECTION GATE ACTIVE</span>
          </div>
        </div>
      </div>

      {/* Recent Runs Section */}
      <div className="border-t-2 border-[#0A0A0A] pt-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <h2 className="font-['Space_Grotesk'] font-bold text-2xl uppercase tracking-tight">
              Recent Research Runs
            </h2>
            <span className="font-mono text-xs bg-[#0A0A0A] text-[#FAFAFA] px-2 py-0.5">
              {runs.length} TOTAL
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={fetchRunsList} loading={loading}>
            Refresh Runs
          </Button>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="border-2 border-[#0A0A0A] p-8 text-center bg-[#FAFAFA] font-mono text-sm">
            <span className="inline-block w-3 h-3 bg-[#1D3557] animate-ping mr-2" />
            QUERYING RUN DATABASE...
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="border-2 border-[#E63946] bg-[#E63946]/10 p-6 text-center">
            <p className="font-mono text-sm text-[#E63946] mb-4">
              FAILED TO LOAD RUNS: {error}
            </p>
            <Button variant="outline" size="sm" onClick={fetchRunsList}>
              Retry Query
            </Button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && runs.length === 0 && (
          <div className="border-2 border-[#0A0A0A] p-12 text-center bg-[#FAFAFA]">
            <span className="w-8 h-8 border-2 border-[#0A0A0A] inline-block mb-3" />
            <h3 className="font-['Space_Grotesk'] font-bold text-lg uppercase mb-1">
              No Research Runs Found
            </h3>
            <p className="font-['Inter'] text-sm text-[#0A0A0A]/70 max-w-md mx-auto">
              Initialize a research goal using the form above to trigger the
              5-agent supervisor workflow.
            </p>
          </div>
        )}

        {/* Runs List Table */}
        {!loading && !error && runs.length > 0 && (
          <div className="border-2 border-[#0A0A0A] overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b-2 border-[#0A0A0A] bg-[#0A0A0A]/5 font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wider text-[#0A0A0A]">
                  <th className="p-4 w-12 text-center">Status</th>
                  <th className="p-4">Goal / Objective</th>
                  <th className="p-4 w-32">Pages</th>
                  <th className="p-4 w-32">Tokens</th>
                  <th className="p-4 w-40">Created</th>
                  <th className="p-4 w-28 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y border-[#0A0A0A]/10 font-mono text-xs">
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-[#0A0A0A]/5 transition-colors group"
                  >
                    <td className="p-4 text-center">
                      <div className="flex justify-center items-center">
                        <StatusDot status={r.status} size="md" />
                      </div>
                    </td>
                    <td className="p-4 font-['Inter'] text-sm font-medium text-[#0A0A0A]">
                      <Link
                        href={`/runs/${r.id}`}
                        className="hover:text-[#E63946] transition-colors block line-clamp-2"
                      >
                        {r.goal}
                      </Link>
                      <span className="text-[11px] font-mono text-[#0A0A0A]/50 block mt-0.5">
                        ID: {r.id}
                      </span>
                    </td>
                    <td className="p-4 font-bold text-[#0A0A0A]">
                      {r.pages_persisted} saved
                    </td>
                    <td className="p-4 text-[#0A0A0A]/80">
                      {r.tokens_used.toLocaleString()}
                    </td>
                    <td className="p-4 text-[#0A0A0A]/60">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="p-4 text-right">
                      <Link
                        href={`/runs/${r.id}`}
                        className="inline-block px-3 py-1 font-['Space_Grotesk'] font-bold text-xs uppercase border border-[#0A0A0A] hover:bg-[#0A0A0A] hover:text-[#FAFAFA] transition-colors"
                      >
                        View &rarr;
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
