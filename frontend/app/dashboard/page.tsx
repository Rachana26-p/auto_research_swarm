"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertBanner, Button, ConfirmationModal, CopyButton, PencilIcon, StatusDot, TrashIcon } from "@/components";
import { createRun, deleteRun, getRuns, RunSummaryResponse, updateRun } from "@/lib/api";

const SUGGESTIONS = [
  "Test-time compute scaling and dynamic search architectures in frontier LLMs",
  "Monte Carlo Tree Search versus beam search for complex mathematical reasoning",
  "Empirical multi-agent debate and cross-examination architectures for LLM self-correction",
  "Quantum computing error mitigation algorithms and zero-noise extrapolation advances in 2026",
];

export default function DashboardPage() {
  const router = useRouter();

  // Prompt & Form State
  const [goal, setGoal] = useState("");
  const [depthTier, setDepthTier] = useState<"light" | "standard" | "deep">("standard");
  const [modelProvider, setModelProvider] = useState<"gemini" | "groq">("gemini");
  const [modelName, setModelName] = useState("gemini-1.5-flash");
  const [honeypot, setHoneypot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Depth tier mapped to pages & tokens
  const depthConfig = {
    light: { pages: 10, tokens: 250000 },
    standard: { pages: 20, tokens: 500000 },
    deep: { pages: 35, tokens: 800000 },
  }[depthTier];

  // Dynamic budget calculation: ~5 calls per page + 10 base planning calls
  const dynamicBudget = Math.max(20, depthConfig.pages * 5 + 10);

  // Runs List State
  const [runs, setRuns] = useState<RunSummaryResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  // Rename inline state
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const [editingGoal, setEditingGoal] = useState("");

  // Confirmation modal state
  const [deleteTargetRunId, setDeleteTargetRunId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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

  // Dynamic metrics computed from runs
  const totalPersisted = runs.reduce((acc, r) => acc + (r.pages_persisted || 0), 0);
  const totalTokens = runs.reduce((acc, r) => acc + (r.tokens_used || 0), 0);
  const activeRunsCount = runs.filter((r) => r.status === "running" || r.status === "pending").length;
  const completedRunsCount = runs.filter((r) => r.status === "completed").length;

  useEffect(() => {
    setIsMounted(true);
    let active = true;

    const poll = async (isInitial = false) => {
      try {
        const data = await getRuns();
        if (active) {
          setRuns(data);
          setError(null);
        }
      } catch (err) {
        if (active && isInitial) {
          setError(err instanceof Error ? err.message : "Failed to load runs");
        }
      } finally {
        if (active && isInitial) {
          setLoading(false);
        }
      }
    };

    // Initial fetch
    poll(true);

    // Live polling every 3 seconds so persisted pages and tokens update dynamically
    const timer = setInterval(() => {
      poll(false);
    }, 3000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Bot honeypot protection check
    if (honeypot.trim()) {
      setFormError("Spam/bot submission detected and rejected.");
      return;
    }

    const trimmedGoal = goal.trim();
    if (!trimmedGoal) {
      setFormError("Please enter a research topic or question");
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
        max_pages: depthConfig.pages,
        max_tokens: depthConfig.tokens,
        max_tool_calls: dynamicBudget,
        provider: modelProvider,
        model: modelName,
      });

      // Clear the console input so it refreshes cleanly
      setGoal("");
      setSubmitting(false);

      // Navigate immediately to the isolated research chat
      router.push(`/runs/${newRun.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to launch run");
      setSubmitting(false);
    }
  };

  const handleStartRename = (r: RunSummaryResponse, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingRunId(r.id);
    setEditingGoal(r.goal);
  };

  const handleSaveRename = async (runId: string) => {
    const trimmed = editingGoal.trim();
    if (!trimmed) {
      setEditingRunId(null);
      return;
    }
    try {
      await updateRun(runId, trimmed);
      setRuns((prev) =>
        prev.map((item) => (item.id === runId ? { ...item, goal: trimmed } : item))
      );
    } catch (err) {
      alert(`Rename failed: ${err instanceof Error ? err.message : "Error"}`);
    } finally {
      setEditingRunId(null);
    }
  };

  const handleDeleteRun = (runId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteTargetRunId(runId);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetRunId) return;
    setIsDeleting(true);
    try {
      await deleteRun(deleteTargetRunId);
      setRuns((prev) => prev.filter((item) => item.id !== deleteTargetRunId));
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : "Error"}`);
    } finally {
      setIsDeleting(false);
      setDeleteTargetRunId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-12">
      {/* GPT-Style Header & Welcome */}
      <div className="text-center pt-4 pb-2 space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#1D3557]/10 dark:bg-[#70B4FF]/10 border border-[#1D3557] dark:border-[#70B4FF]/40 font-mono text-xs uppercase tracking-wider text-[#1D3557] dark:text-[#70B4FF]">
          <span className="w-2 h-2 bg-[#E63946] inline-block" />
          <span>5-Node Autonomous Research Swarm</span>
        </div>
        <h1 className="font-['Archivo_Black'] text-3xl sm:text-5xl uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2]">
          What should the Swarm investigate?
        </h1>
        <p className="font-['Inter'] text-sm sm:text-base text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 max-w-2xl mx-auto leading-relaxed">
          Each research chat runs isolated. The swarm decomposes subtasks, discovers peer-reviewed papers, extracts grounded findings, validates claims, and compiles an Overleaf-ready LaTeX survey.
        </p>
      </div>

      {/* Dynamic Swarm Telemetry Stats (Live Updating Every 3s) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-4 flex flex-col justify-between shadow-[2px_2px_0px_0px_#0A0A0A] dark:shadow-none hover:border-[#2A9D8F] transition-colors">
          <div className="flex items-center justify-between mb-1">
            <span className="font-mono text-[10px] uppercase text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 font-bold tracking-wider">
              Persisted Articles
            </span>
            {activeRunsCount > 0 ? (
              <span className="flex items-center gap-1 font-mono text-[10px] text-[#2A9D8F] dark:text-[#48CAE4] font-bold">
                <span className="w-2 h-2 rounded-full bg-[#2A9D8F] animate-ping" />
                LIVE
              </span>
            ) : (
              <span className="w-2 h-2 rounded-full bg-[#2A9D8F]" />
            )}
          </div>
          <div className="font-['Archivo_Black'] text-3xl sm:text-4xl text-[#0A0A0A] dark:text-[#EDEEF2]">
            {totalPersisted}
          </div>
          <span className="font-mono text-[11px] text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 block mt-1">
            Knowledge Articles Saved
          </span>
        </div>

        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-4 flex flex-col justify-between shadow-[2px_2px_0px_0px_#0A0A0A] dark:shadow-none hover:border-[#E63946] transition-colors">
          <div className="flex items-center justify-between mb-1">
            <span className="font-mono text-[10px] uppercase text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 font-bold tracking-wider">
              Tokens Used So Far
            </span>
            {activeRunsCount > 0 ? (
              <span className="flex items-center gap-1 font-mono text-[10px] text-[#E63946] dark:text-[#FF5C6C] font-bold">
                <span className="w-2 h-2 rounded-full bg-[#E63946] animate-pulse" />
                LIVE
              </span>
            ) : (
              <span className="w-2 h-2 rounded-full bg-[#1D3557] dark:bg-[#70B4FF]" />
            )}
          </div>
          <div className="font-['Archivo_Black'] text-3xl sm:text-4xl text-[#0A0A0A] dark:text-[#EDEEF2]">
            {totalTokens.toLocaleString()}
          </div>
          <span className="font-mono text-[11px] text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 block mt-1">
            Inference Compute Consumed
          </span>
        </div>

        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-4 flex flex-col justify-between shadow-[2px_2px_0px_0px_#0A0A0A] dark:shadow-none hover:border-[#1D3557] transition-colors">
          <div className="font-mono text-[10px] uppercase text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 font-bold tracking-wider mb-1">
            Active Swarm Runs
          </div>
          <div className="font-['Archivo_Black'] text-3xl sm:text-4xl text-[#1D3557] dark:text-[#70B4FF]">
            {activeRunsCount}
          </div>
          <span className="font-mono text-[11px] text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 block mt-1">
            Currently Processing
          </span>
        </div>

        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-4 flex flex-col justify-between shadow-[2px_2px_0px_0px_#0A0A0A] dark:shadow-none hover:border-[#2A9D8F] transition-colors">
          <div className="font-mono text-[10px] uppercase text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 font-bold tracking-wider mb-1">
            Completed Chats
          </div>
          <div className="font-['Archivo_Black'] text-3xl sm:text-4xl text-[#2A9D8F] dark:text-[#48CAE4]">
            {completedRunsCount}
          </div>
          <span className="font-mono text-[11px] text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 block mt-1">
            Surveys &amp; LaTeX Ready
          </span>
        </div>
      </div>

      {/* GPT-Style Console Prompt Box */}
      <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-4 sm:p-6 shadow-[4px_4px_0px_0px_#0A0A0A] dark:shadow-[4px_4px_0px_0px_rgba(0,0,0,0.7)] transition-all">
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <AlertBanner
              variant="error"
              title="Execution Pre-flight Error"
              message={formError}
              onClose={() => setFormError(null)}
            />
          )}

          {/* Prompt Textarea */}
          <div className="relative">
            <textarea
              id="goal-input"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Describe your research topic or question (e.g., Investigate recent breakthrough quantum error mitigation algorithms published in 2026...)"
              rows={4}
              required
              disabled={submitting}
              className="w-full border-2 border-[#0A0A0A] dark:border-[#2C3142] p-4 font-['Inter'] text-sm sm:text-base bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] placeholder-[#0A0A0A]/40 dark:placeholder-[#EDEEF2]/40 focus:outline-none focus:border-[#E63946] dark:focus:border-[#FF5C6C] transition-colors resize-y"
            />
            <div className="absolute right-3 bottom-3 text-[11px] font-mono text-[#0A0A0A]/40 dark:text-[#EDEEF2]/40 pointer-events-none">
              {goal.length} / 5000
            </div>
          </div>

          {/* Honeypot field for bot/spam protection */}
          <input
            type="text"
            name="company_website_url"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            className="hidden"
            aria-hidden="true"
          />

          {/* Bottom Bar: Engine, Depth, and Action */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-2 border-t border-[#0A0A0A]/10 dark:border-[#2C3142]">
            {/* Left Controls: Provider & Depth */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Provider Selector */}
              <div className="flex items-center gap-1.5 border border-[#0A0A0A] dark:border-[#2C3142] px-2.5 py-1.5 bg-[#FFFFFF] dark:bg-[#0C0D12] text-xs font-mono">
                <span className="text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 font-bold">MODEL:</span>
                <select
                  value={modelProvider}
                  onChange={(e) => {
                    const p = e.target.value as "gemini" | "groq";
                    setModelProvider(p);
                    setModelName(p === "gemini" ? "gemini-1.5-flash" : "llama-3.3-70b-versatile");
                  }}
                  className="bg-transparent font-bold outline-none cursor-pointer text-[#0A0A0A] dark:text-[#EDEEF2]"
                >
                  <option value="gemini" className="dark:bg-[#14161E] dark:text-[#EDEEF2]">Google Gemini 1.5 Flash</option>
                  <option value="groq" className="dark:bg-[#14161E] dark:text-[#EDEEF2]">Groq Llama 3.3 70B</option>
                </select>
              </div>

              {/* Research Depth Pill Selector */}
              <div className="flex items-center gap-1 border border-[#0A0A0A] dark:border-[#2C3142] p-0.5 bg-[#FFFFFF] dark:bg-[#0C0D12] text-xs font-mono">
                <button
                  type="button"
                  onClick={() => setDepthTier("light")}
                  className={`px-2 py-1 text-[11px] font-bold uppercase transition-colors ${
                    depthTier === "light"
                      ? "bg-[#0A0A0A] text-[#FAFAFA] dark:bg-[#EDEEF2] dark:text-[#0A0A0A]"
                      : "text-[#0A0A0A] dark:text-[#EDEEF2] hover:bg-[#0A0A0A]/10"
                  }`}
                  title="Fast overview (10 pages)"
                >
                  Light
                </button>
                <button
                  type="button"
                  onClick={() => setDepthTier("standard")}
                  className={`px-2 py-1 text-[11px] font-bold uppercase transition-colors ${
                    depthTier === "standard"
                      ? "bg-[#0A0A0A] text-[#FAFAFA] dark:bg-[#EDEEF2] dark:text-[#0A0A0A]"
                      : "text-[#0A0A0A] dark:text-[#EDEEF2] hover:bg-[#0A0A0A]/10"
                  }`}
                  title="Standard survey (20 pages)"
                >
                  Standard
                </button>
                <button
                  type="button"
                  onClick={() => setDepthTier("deep")}
                  className={`px-2 py-1 text-[11px] font-bold uppercase transition-colors ${
                    depthTier === "deep"
                      ? "bg-[#0A0A0A] text-[#FAFAFA] dark:bg-[#EDEEF2] dark:text-[#0A0A0A]"
                      : "text-[#0A0A0A] dark:text-[#EDEEF2] hover:bg-[#0A0A0A]/10"
                  }`}
                  title="Comprehensive deep survey (35 pages)"
                >
                  Deep
                </button>
              </div>
            </div>

            {/* Launch Swarm Action */}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={submitting}
              className="font-['Space_Grotesk'] font-bold uppercase tracking-wider text-xs sm:text-sm px-6 py-2.5"
            >
              {submitting ? "Deploying Swarm..." : "Launch Research Swarm ↵"}
            </Button>
          </div>
        </form>

        {/* Quick Suggestion Pills */}
        <div className="mt-4 pt-3 border-t border-[#0A0A0A]/10 dark:border-[#2C3142]">
          <div className="text-[10px] font-mono text-[#0A0A0A]/50 dark:text-[#EDEEF2]/50 uppercase tracking-wider font-bold mb-2">
            Suggested Research Questions:
          </div>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setGoal(s)}
                className="text-left text-xs font-mono p-2 border border-[#0A0A0A]/30 dark:border-[#2C3142] bg-[#FFFFFF] dark:bg-[#0C0D12] hover:border-[#E63946] dark:hover:border-[#FF5C6C] hover:bg-[#E63946]/5 text-[#0A0A0A] dark:text-[#EDEEF2] transition-colors cursor-pointer"
              >
                &ldquo;{s}&rdquo;
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Isolated Research Chats Table */}
      <div className="space-y-4 pt-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b-2 border-[#0A0A0A] dark:border-[#2C3142]">
          <div className="flex items-center gap-3">
            <h2 className="font-['Space_Grotesk'] font-bold text-xl uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2]">
              Isolated Research Chats &amp; Runs
            </h2>
            <span className="font-mono text-xs bg-[#0A0A0A] dark:bg-[#EDEEF2] text-[#FAFAFA] dark:text-[#0A0A0A] px-2 py-0.5 font-bold">
              {runs.length} CHATS
            </span>
            <span className="hidden sm:inline-flex items-center gap-1.5 font-mono text-[10px] text-[#2A9D8F] dark:text-[#48CAE4] font-bold border border-[#2A9D8F]/30 px-2 py-0.5 bg-[#2A9D8F]/10">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2A9D8F] animate-ping" />
              LIVE TELEMETRY SYNC
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchRunsList} loading={loading}>
              Refresh Chats
            </Button>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] p-8 text-center bg-[#FAFAFA] dark:bg-[#14161E] font-mono text-sm text-[#0A0A0A] dark:text-[#EDEEF2]">
            <span className="inline-block w-3 h-3 bg-[#1D3557] dark:bg-[#70B4FF] animate-ping mr-2" />
            SYNCHRONIZING RESEARCH CHATS...
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="border-2 border-[#E63946] bg-[#E63946]/10 p-6 text-center">
            <p className="font-mono text-sm text-[#E63946] mb-4">
              FAILED TO LOAD CHATS: {error}
            </p>
            <Button variant="outline" size="sm" onClick={fetchRunsList}>
              Retry Query
            </Button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && runs.length === 0 && (
          <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] p-12 text-center bg-[#FAFAFA] dark:bg-[#14161E]">
            <span className="w-8 h-8 border-2 border-[#0A0A0A] dark:border-[#2C3142] inline-block mb-3" />
            <h3 className="font-['Space_Grotesk'] font-bold text-lg uppercase mb-1 text-[#0A0A0A] dark:text-[#EDEEF2]">
              No Research Chats Yet
            </h3>
            <p className="font-['Inter'] text-sm text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 max-w-md mx-auto">
              Submit your first research goal above. Each run will be created as an isolated chat with dedicated logs, reviews, and LaTeX survey generation.
            </p>
          </div>
        )}

        {/* Runs List Table */}
        {!loading && !error && runs.length > 0 && (
          <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-[#FAFAFA] dark:bg-[#14161E] z-10">
                <tr className="border-b-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#0A0A0A]/5 dark:bg-[#FFFFFF]/5 font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wider text-[#0A0A0A] dark:text-[#EDEEF2]">
                  <th className="p-3 w-12 text-center">Status</th>
                  <th className="p-3">Research Goal / Topic</th>
                  <th className="p-3 w-28 text-center">Persisted</th>
                  <th className="p-3 w-28 text-center">Tokens</th>
                  <th className="p-3 w-32 text-center">Created</th>
                  <th className="p-3 w-40 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#0A0A0A]/10 dark:divide-[#2C3142] font-mono text-xs">
                {runs.map((r) => {
                  const isEditing = editingRunId === r.id;
                  return (
                    <tr
                      key={r.id}
                      className="hover:bg-[#0A0A0A]/5 dark:hover:bg-[#FFFFFF]/5 transition-colors group"
                    >
                      <td className="p-3 text-center">
                        <div className="flex justify-center items-center">
                          <StatusDot status={r.status} size="md" />
                        </div>
                      </td>

                      <td className="p-3 font-['Inter'] text-sm font-medium text-[#0A0A0A] dark:text-[#EDEEF2]">
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={editingGoal}
                              onChange={(e) => setEditingGoal(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveRename(r.id);
                                if (e.key === "Escape") setEditingRunId(null);
                              }}
                              autoFocus
                              className="border border-[#0A0A0A] dark:border-[#2C3142] p-1.5 text-xs font-mono w-full bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2]"
                            />
                            <button
                              onClick={() => handleSaveRename(r.id)}
                              className="px-2.5 py-1 bg-[#0A0A0A] dark:bg-[#EDEEF2] text-[#FAFAFA] dark:text-[#0A0A0A] text-xs font-mono font-bold hover:bg-[#2A9D8F]"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingRunId(null)}
                              className="px-2 py-1 border border-[#0A0A0A] dark:border-[#2C3142] text-xs font-mono hover:bg-[#E63946] hover:text-[#FAFAFA]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div>
                            <Link
                              href={`/runs/${r.id}`}
                              className="hover:text-[#E63946] dark:hover:text-[#FF5C6C] transition-colors block line-clamp-2"
                            >
                              {r.goal}
                            </Link>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[11px] font-mono text-[#0A0A0A]/50 dark:text-[#EDEEF2]/50">
                                ID: {r.id}
                              </span>
                              <CopyButton text={r.id} label="ID" variant="pill" />
                            </div>
                          </div>
                        )}
                      </td>

                      <td className="p-3 text-center font-bold text-[#0A0A0A] dark:text-[#EDEEF2]">
                        <div className="flex items-center justify-center gap-1.5">
                          {(r.status === "running" || r.status === "pending") && (
                            <span className="w-1.5 h-1.5 rounded-full bg-[#2A9D8F] animate-ping" />
                          )}
                          <span>{r.pages_persisted} pages</span>
                        </div>
                      </td>

                      <td className="p-3 text-center text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80">
                        <div className="flex items-center justify-center gap-1.5">
                          {(r.status === "running" || r.status === "pending") && (
                            <span className="w-1.5 h-1.5 rounded-full bg-[#E63946] animate-pulse" />
                          )}
                          <span>{r.tokens_used.toLocaleString()}</span>
                        </div>
                      </td>

                      <td className="p-3 text-center text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">
                        {isMounted && r.created_at ? new Date(r.created_at).toLocaleDateString() : ""}
                      </td>

                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Link
                            href={`/runs/${r.id}`}
                            className="px-2.5 py-1 font-['Space_Grotesk'] font-bold text-xs uppercase border border-[#0A0A0A] dark:border-[#2C3142] hover:bg-[#0A0A0A] hover:text-[#FAFAFA] dark:hover:bg-[#EDEEF2] dark:hover:text-[#0A0A0A] transition-colors"
                          >
                            Open &rarr;
                          </Link>
                          <button
                            onClick={(e) => handleStartRename(r, e)}
                            className="p-1 border border-[#0A0A0A] dark:border-[#2C3142] hover:bg-[#0A0A0A] hover:text-[#FAFAFA] dark:hover:bg-[#EDEEF2] dark:hover:text-[#0A0A0A] text-xs transition-colors cursor-pointer flex items-center justify-center"
                            title="Rename chat"
                            aria-label="Rename chat"
                          >
                            <PencilIcon size={12} />
                          </button>
                          <button
                            onClick={(e) => handleDeleteRun(r.id, e)}
                            className="p-1 border border-[#0A0A0A] dark:border-[#2C3142] hover:bg-[#E63946] hover:text-[#FAFAFA] hover:border-[#E63946] dark:hover:bg-[#FF5C6C] dark:hover:border-[#FF5C6C] text-xs transition-colors cursor-pointer flex items-center justify-center"
                            title="Delete chat"
                            aria-label="Delete chat"
                          >
                            <TrashIcon size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reusable Confirmation Modal for Deleting Chat */}
      <ConfirmationModal
        isOpen={Boolean(deleteTargetRunId)}
        title="Delete Research Chat?"
        description="Are you sure you want to delete this research chat? All isolated logs, generated survey artifacts, and evaluation metrics for this run will be permanently erased."
        confirmText="Delete Chat"
        cancelText="Cancel"
        variant="danger"
        loading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTargetRunId(null)}
      />
    </div>
  );
}
