"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertBanner, Button, ConfirmationModal, CopyButton, StatusDot } from "@/components";
import {
  approveReview,
  getReviews,
  getRuns,
  rejectReview,
  ReviewResponse,
  RunSummaryResponse,
} from "@/lib/api";

function ReviewsContent() {
  const searchParams = useSearchParams();
  const initialRunId = searchParams.get("run_id") || "";

  const [runs, setRuns] = useState<RunSummaryResponse[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>(initialRunId);
  const [reviews, setReviews] = useState<ReviewResponse[]>([]);
  const [activeTab, setActiveTab] = useState<"pending" | "resolved">("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  // Reject confirmation modal
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);

  // Fetch runs list for the run selector dropdown
  useEffect(() => {
    getRuns()
      .then((data) => setRuns(data))
      .catch(() => {});
  }, []);

  const fetchReviews = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getReviews(selectedRunId ? selectedRunId : undefined, true);
      setReviews(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reviews");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews();
  }, [selectedRunId]);

  const handleApprove = async (reviewId: string) => {
    setActionInProgress(reviewId);
    setActionSuccessMessage(null);
    try {
      await approveReview(reviewId);
      setActionSuccessMessage(`Review ${reviewId.slice(0, 8)} approved. Swarm execution resumed.`);
      // Update local state: mark review as approved
      setReviews((prev) =>
        prev.map((r) => (r.id === reviewId ? { ...r, status: "approved" } : r))
      );
    } catch (err) {
      alert(`Approval failed: ${err instanceof Error ? err.message : "Error"}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectTargetId) return;
    const reviewId = rejectTargetId;
    setRejectTargetId(null);
    setActionInProgress(reviewId);
    setActionSuccessMessage(null);
    try {
      await rejectReview(reviewId);
      setActionSuccessMessage(`Review ${reviewId.slice(0, 8)} rejected. Candidate paper discarded and run resumed.`);
      // Update local state: mark review as rejected
      setReviews((prev) =>
        prev.map((r) => (r.id === reviewId ? { ...r, status: "rejected" } : r))
      );
    } catch (err) {
      alert(`Rejection failed: ${err instanceof Error ? err.message : "Error"}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const pendingReviews = reviews.filter((r) => r.status === "pending");
  const resolvedReviews = reviews.filter((r) => r.status !== "pending");
  const currentRun = runs.find((r) => r.id === selectedRunId);

  return (
    <div className="space-y-8">
      {/* Page Header with Back Navigation */}
      <div className="flex flex-col md:flex-row md:items-end justify-between pb-6 border-b-2 border-[#0A0A0A] dark:border-[#2C3142] gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 mb-1">
            <span>HUMAN-IN-THE-LOOP GATE</span>
            <span>/</span>
            <span>RUN-ISOLATED VALIDATION REVIEWS</span>
          </div>
          <h1 className="font-['Archivo_Black'] text-3xl sm:text-4xl uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2]">
            Validation Reviews
          </h1>
          <p className="font-['Inter'] text-sm text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 max-w-2xl mt-1">
            Each research run has its own isolated review records. Inspect candidate extractions flagged as uncertain and view past decisions taken in this chat.
          </p>
        </div>

        {/* Navigation & Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <Link
            href="/dashboard"
            className="px-3 py-1.5 border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] font-['Space_Grotesk'] font-bold text-xs uppercase hover:bg-[#0A0A0A] hover:text-[#FAFAFA] dark:hover:bg-[#EDEEF2] dark:hover:text-[#0A0A0A] transition-colors inline-flex items-center gap-1.5 shadow-[2px_2px_0px_0px_#0A0A0A] dark:shadow-none"
          >
            <span>&larr;</span> Back to Dashboard
          </Link>

          {/* Chat / Run Selector */}
          <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] px-3 py-1.5 flex items-center gap-2">
            <span className="font-mono text-xs font-bold uppercase text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">
              Filter Chat:
            </span>
            <select
              value={selectedRunId}
              onChange={(e) => setSelectedRunId(e.target.value)}
              className="font-mono text-xs font-bold bg-transparent outline-none cursor-pointer max-w-[220px] sm:max-w-[320px] truncate text-[#0A0A0A] dark:text-[#EDEEF2]"
            >
              <option value="" className="dark:bg-[#14161E] dark:text-[#EDEEF2]">All Research Chats</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id} className="dark:bg-[#14161E] dark:text-[#EDEEF2]">
                  {r.goal.slice(0, 45)}... ({r.id.slice(0, 8)})
                </option>
              ))}
            </select>
          </div>

          <Button variant="outline" size="sm" onClick={fetchReviews} loading={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Selected Run Banner (if filtered) */}
      {currentRun && (
        <div className="p-3.5 border-2 border-[#1D3557] dark:border-[#70B4FF] bg-[#1D3557]/5 dark:bg-[#70B4FF]/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 font-mono text-xs">
          <div>
            <span className="font-bold text-[#1D3557] dark:text-[#70B4FF] uppercase block text-[10px]">
              Inspecting Run Scope:
            </span>
            <span className="font-['Inter'] text-sm font-semibold text-[#0A0A0A] dark:text-[#EDEEF2]">
              {currentRun.goal}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/runs/${currentRun.id}`}
              className="px-3 py-1 bg-[#1D3557] text-[#FAFAFA] font-bold uppercase hover:bg-[#E63946] transition-colors"
            >
              View Telemetry &rarr;
            </Link>
            <button
              onClick={() => setSelectedRunId("")}
              className="px-2.5 py-1 border border-[#0A0A0A] dark:border-[#2C3142] bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] hover:bg-[#0A0A0A] hover:text-[#FAFAFA] font-bold uppercase cursor-pointer"
            >
              Clear Filter
            </button>
          </div>
        </div>
      )}

      {/* Notifications */}
      {actionSuccessMessage && (
        <AlertBanner
          variant="success"
          title="Review Completed"
          message={actionSuccessMessage}
          onClose={() => setActionSuccessMessage(null)}
        />
      )}

      {error && !loading && (
        <AlertBanner
          variant="error"
          title="Failed to Query Reviews"
          message={error}
          onClose={() => setError(null)}
        />
      )}

      {/* Tabs: Pending vs Resolved History */}
      <div className="flex items-center gap-2 border-b-2 border-[#0A0A0A] dark:border-[#2C3142]">
        <button
          onClick={() => setActiveTab("pending")}
          className={`px-4 py-2 font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer border-t-2 border-x-2 -mb-[2px] ${
            activeTab === "pending"
              ? "bg-[#FAFAFA] dark:bg-[#14161E] border-[#0A0A0A] dark:border-[#2C3142] text-[#0A0A0A] dark:text-[#EDEEF2]"
              : "bg-transparent border-transparent text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 hover:text-[#0A0A0A] dark:hover:text-[#EDEEF2]"
          }`}
        >
          <span>Pending Decisions</span>
          {pendingReviews.length > 0 && (
            <span className="ml-2 px-1.5 py-0.2 bg-[#E63946] text-[#FAFAFA] text-[10px] rounded-full">
              {pendingReviews.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("resolved")}
          className={`px-4 py-2 font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer border-t-2 border-x-2 -mb-[2px] ${
            activeTab === "resolved"
              ? "bg-[#FAFAFA] dark:bg-[#14161E] border-[#0A0A0A] dark:border-[#2C3142] text-[#0A0A0A] dark:text-[#EDEEF2]"
              : "bg-transparent border-transparent text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 hover:text-[#0A0A0A] dark:hover:text-[#EDEEF2]"
          }`}
        >
          <span>Review History ({resolvedReviews.length})</span>
        </button>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] p-12 text-center bg-[#FAFAFA] dark:bg-[#14161E] font-mono text-sm text-[#0A0A0A] dark:text-[#EDEEF2]">
          <span className="inline-block w-3 h-3 bg-[#F4A300] animate-ping mr-3" />
          FETCHING ISOLATED REVIEW DATA...
        </div>
      )}

      {/* Tab 1: Pending Reviews */}
      {!loading && !error && activeTab === "pending" && (
        <div className="space-y-6">
          {pendingReviews.length === 0 ? (
            <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] p-12 text-center bg-[#FAFAFA] dark:bg-[#14161E]">
              <span className="w-8 h-8 border-2 border-[#2A9D8F] bg-[#2A9D8F]/20 inline-block mb-3" />
              <h3 className="font-['Space_Grotesk'] font-bold text-lg uppercase mb-1 text-[#0A0A0A] dark:text-[#EDEEF2]">
                No Pending Decisions
              </h3>
              <p className="font-['Inter'] text-sm text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 max-w-md mx-auto">
                {selectedRunId
                  ? "This research chat currently has no pending review items requiring human intervention."
                  : "All active swarm runs are proceeding without interruptions."}
              </p>
            </div>
          ) : (
            pendingReviews.map((rev) => {
              const vOut = rev.validator_output || {};
              const confidence = typeof vOut.confidence === "number" ? vOut.confidence : 0;
              const safetyFlags = vOut.safety_flags || [];

              const candidatePaper = ((vOut.candidate_paper || vOut.extracted_json || {}) as Record<string, unknown>);
              const candTitle = candidatePaper.title ? String(candidatePaper.title) : null;
              const candSummary = candidatePaper.summary
                ? String(candidatePaper.summary)
                : candidatePaper.description
                ? String(candidatePaper.description)
                : null;
              const candHeadings = Array.isArray(candidatePaper.headings)
                ? (candidatePaper.headings as unknown[]).map(String)
                : [];

              return (
                <div
                  key={rev.id}
                  className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-6 space-y-6 transition-all"
                >
                  {/* Header row */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b-2 border-[#0A0A0A] dark:border-[#2C3142] gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <StatusDot status="interrupted" size="sm" />
                        <span className="font-['Space_Grotesk'] font-bold text-sm uppercase text-[#0A0A0A] dark:text-[#EDEEF2]">
                          Review Item: {rev.id}
                        </span>
                        <CopyButton text={rev.id} label="Review ID" variant="pill" />
                      </div>
                      <span className="font-mono text-xs text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 block">
                        Chat Scope:{" "}
                        <Link
                          href={`/runs/${rev.run_id}`}
                          className="underline font-bold text-[#1D3557] dark:text-[#70B4FF] hover:text-[#E63946]"
                        >
                          {rev.run_id}
                        </Link>
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs px-2.5 py-1 bg-[#F4A300]/20 border border-[#F4A300] text-[#0A0A0A] dark:text-[#EDEEF2] font-bold">
                        VERDICT: UNCERTAIN ({(confidence * 100).toFixed(0)}%)
                      </span>
                    </div>
                  </div>

                  {/* URL */}
                  <div className="font-mono text-xs flex items-center justify-between bg-[#FFFFFF] dark:bg-[#0C0D12] p-2.5 border border-[#0A0A0A]/20 dark:border-[#2C3142]">
                    <div className="truncate mr-2">
                      <span className="font-bold text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">SOURCE URL: </span>
                      <a
                        href={rev.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#1D3557] dark:text-[#70B4FF] underline truncate hover:text-[#E63946]"
                      >
                        {rev.url}
                      </a>
                    </div>
                    <CopyButton text={rev.url} label="URL" variant="button" />
                  </div>

                  {/* Candidate Content Body */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                    {/* Left: Raw Candidate Paper */}
                    <div className="border border-[#0A0A0A] dark:border-[#2C3142] p-4 bg-[#FFFFFF] dark:bg-[#0C0D12] space-y-3">
                      <div className="flex items-center justify-between border-b pb-2 border-[#0A0A0A]/10 dark:border-[#2C3142]">
                        <span className="font-['Space_Grotesk'] font-bold text-xs uppercase text-[#0A0A0A] dark:text-[#EDEEF2]">
                          Extracted Candidate Data // Raw Untrusted
                        </span>
                        <CopyButton
                          text={JSON.stringify(vOut.extracted_json || candidatePaper || {}, null, 2)}
                          label="JSON"
                          variant="button"
                        />
                      </div>

                      {candTitle && (
                        <div>
                          <span className="font-mono text-[10px] uppercase text-[#0A0A0A]/50 dark:text-[#EDEEF2]/50 block">
                            Title:
                          </span>
                          <h4 className="font-['Inter'] font-bold text-sm text-[#0A0A0A] dark:text-[#EDEEF2]">
                            {candTitle}
                          </h4>
                        </div>
                      )}

                      {candSummary && (
                        <div>
                          <span className="font-mono text-[10px] uppercase text-[#0A0A0A]/50 dark:text-[#EDEEF2]/50 block">
                            Summary:
                          </span>
                          <p className="font-['Inter'] text-xs text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80 leading-relaxed max-h-48 overflow-y-auto">
                            {candSummary}
                          </p>
                        </div>
                      )}

                      {candHeadings.length > 0 && (
                        <div>
                          <span className="font-mono text-[10px] uppercase text-[#0A0A0A]/50 dark:text-[#EDEEF2]/50 block">
                            Headings:
                          </span>
                          <ul className="list-disc pl-4 text-xs font-mono text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70">
                            {candHeadings.map((h, i) => (
                              <li key={i}>{h}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {!candTitle && !candSummary && (
                        <pre className="font-mono text-[11px] p-2 bg-[#0A0A0A]/5 dark:bg-[#FFFFFF]/5 overflow-x-auto max-h-48">
                          {JSON.stringify(vOut.extracted_json || candidatePaper || {}, null, 2)}
                        </pre>
                      )}
                    </div>

                    {/* Right: Validation Breakdown */}
                    <div className="border border-[#0A0A0A] dark:border-[#2C3142] p-4 bg-[#FAFAFA] dark:bg-[#14161E] space-y-3">
                      <div className="flex items-center justify-between border-b pb-2 border-[#0A0A0A]/10 dark:border-[#2C3142]">
                        <span className="font-['Space_Grotesk'] font-bold text-xs uppercase text-[#0A0A0A] dark:text-[#EDEEF2]">
                          Validator Analysis // Why Uncertain?
                        </span>
                        <span className="font-mono text-xs text-[#E63946] dark:text-[#FF5C6C] font-bold">
                          GATE TRIGGERED
                        </span>
                      </div>

                      {safetyFlags.length > 0 && (
                        <div className="p-3 bg-[#E63946]/10 border-2 border-[#E63946] mb-4 space-y-1">
                          <span className="font-mono text-xs font-bold text-[#E63946] dark:text-[#FF5C6C] block">
                            SAFETY FLAGS TRIGGERED:
                          </span>
                          <ul className="list-disc pl-4 font-mono text-xs text-[#E63946] dark:text-[#FF5C6C]">
                            {safetyFlags.map((flag, idx) => (
                              <li key={idx}>{flag}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {vOut.faithfulness_notes && (
                        <div className="mb-3">
                          <span className="font-['Space_Grotesk'] font-bold text-xs text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 uppercase block mb-1">
                            Faithfulness Assessment:
                          </span>
                          <p className="font-['Inter'] text-xs text-[#0A0A0A] dark:text-[#EDEEF2] leading-relaxed bg-[#0A0A0A]/5 dark:bg-[#FFFFFF]/5 p-2.5 border border-[#0A0A0A]/10 dark:border-[#2C3142]">
                            {vOut.faithfulness_notes}
                          </p>
                        </div>
                      )}

                      {vOut.relevance_notes && (
                        <div>
                          <span className="font-['Space_Grotesk'] font-bold text-xs text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 uppercase block mb-1">
                            Relevance Assessment:
                          </span>
                          <p className="font-['Inter'] text-xs text-[#0A0A0A] dark:text-[#EDEEF2] leading-relaxed bg-[#0A0A0A]/5 dark:bg-[#FFFFFF]/5 p-2.5 border border-[#0A0A0A]/10 dark:border-[#2C3142]">
                            {vOut.relevance_notes}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action Decision Buttons */}
                  <div className="pt-4 border-t-2 border-[#0A0A0A] dark:border-[#2C3142] flex flex-col sm:flex-row items-center justify-end gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRejectTargetId(rev.id)}
                      loading={actionInProgress === rev.id}
                      className="w-full sm:w-auto hover:border-[#E63946] hover:text-[#E63946]"
                    >
                      Reject &amp; Discard Item
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleApprove(rev.id)}
                      loading={actionInProgress === rev.id}
                      className="w-full sm:w-auto"
                    >
                      Approve &amp; Resume Run &rarr;
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Tab 2: Review Decisions Taken in this Chat */}
      {!loading && !error && activeTab === "resolved" && (
        <div className="space-y-4">
          {resolvedReviews.length === 0 ? (
            <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] p-12 text-center bg-[#FAFAFA] dark:bg-[#14161E]">
              <span className="w-8 h-8 border-2 border-[#0A0A0A] dark:border-[#2C3142] inline-block mb-3" />
              <h3 className="font-['Space_Grotesk'] font-bold text-lg uppercase mb-1 text-[#0A0A0A] dark:text-[#EDEEF2]">
                No Past Decisions Recorded
              </h3>
              <p className="font-['Inter'] text-sm text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 max-w-md mx-auto">
                No human review decisions have been taken yet in this scope.
              </p>
            </div>
          ) : (
            <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] overflow-x-auto bg-[#FAFAFA] dark:bg-[#14161E]">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-[#FAFAFA] dark:bg-[#14161E] z-10">
                  <tr className="border-b-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#0A0A0A]/5 dark:bg-[#FFFFFF]/5 font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wider text-[#0A0A0A] dark:text-[#EDEEF2]">
                    <th className="p-3 w-28 text-center">Decision</th>
                    <th className="p-3">Source URL / Article</th>
                    <th className="p-3 w-48">Chat Scope</th>
                    <th className="p-3 w-36">Reviewed At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#0A0A0A]/10 dark:divide-[#2C3142] font-mono text-xs">
                  {resolvedReviews.map((r) => {
                    const isApproved = r.status === "approved";
                    const candidatePaper = (r.validator_output?.candidate_paper || r.validator_output?.extracted_json || {}) as Record<string, unknown>;
                    const title = candidatePaper.title ? String(candidatePaper.title) : r.url;

                    return (
                      <tr key={r.id} className="hover:bg-[#0A0A0A]/5 dark:hover:bg-[#FFFFFF]/5 transition-colors">
                        <td className="p-3 text-center">
                          <span
                            className={`px-2 py-0.5 font-bold uppercase text-[10px] inline-block ${
                              isApproved
                                ? "bg-[#2A9D8F]/20 text-[#2A9D8F] dark:text-[#48CAE4] border border-[#2A9D8F]"
                                : "bg-[#E63946]/20 text-[#E63946] dark:text-[#FF5C6C] border border-[#E63946]"
                            }`}
                          >
                            {isApproved ? "APPROVED" : "DISCARDED"}
                          </span>
                        </td>
                        <td className="p-3 font-['Inter'] text-xs font-medium text-[#0A0A0A] dark:text-[#EDEEF2]">
                          <span className="font-bold block text-sm">{title}</span>
                          <span className="font-mono text-[11px] text-[#1D3557] dark:text-[#70B4FF] truncate block mt-0.5">
                            {r.url}
                          </span>
                        </td>
                        <td className="p-3 font-mono text-[11px] text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70">
                          <Link href={`/runs/${r.run_id}`} className="underline hover:text-[#E63946]">
                            {r.run_id.slice(0, 8)}...
                          </Link>
                        </td>
                        <td className="p-3 font-mono text-[11px] text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">
                          {r.created_at ? new Date(r.created_at).toLocaleDateString() : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal for Discarding Candidate */}
      <ConfirmationModal
        isOpen={Boolean(rejectTargetId)}
        title="Discard Candidate Paper?"
        description="Are you sure you want to reject and discard this candidate literature? The unverified content will be expunged from the extraction buffer, and the swarm will search for alternate peer-reviewed sources."
        confirmText="Discard Candidate"
        cancelText="Keep Item"
        variant="danger"
        loading={actionInProgress === rejectTargetId}
        onConfirm={handleConfirmReject}
        onCancel={() => setRejectTargetId(null)}
      />
    </div>
  );
}

export default function ReviewsPage() {
  return (
    <Suspense fallback={<div className="border-2 border-[#0A0A0A] p-8 text-center font-mono text-sm">LOADING REVIEW SUITE...</div>}>
      <ReviewsContent />
    </Suspense>
  );
}
