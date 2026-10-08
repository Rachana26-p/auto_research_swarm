"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Button, StatusDot } from "@/components";
import {
  approveReview,
  getReviews,
  rejectReview,
  ReviewResponse,
} from "@/lib/api";

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<ReviewResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  const fetchReviews = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getReviews();
      setReviews(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reviews");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getReviews();
        if (active) {
          setReviews(data);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load reviews");
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

  const handleApprove = async (reviewId: string) => {
    setActionInProgress(reviewId);
    setActionSuccessMessage(null);
    try {
      await approveReview(reviewId);
      setActionSuccessMessage(`Review ${reviewId.slice(0, 8)} approved. Run resumed.`);
      // Remove from pending list
      setReviews((prev) => prev.filter((r) => r.id !== reviewId));
    } catch (err) {
      alert(`Approval failed: ${err instanceof Error ? err.message : "Error"}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleReject = async (reviewId: string) => {
    setActionInProgress(reviewId);
    setActionSuccessMessage(null);
    try {
      await rejectReview(reviewId);
      setActionSuccessMessage(`Review ${reviewId.slice(0, 8)} rejected. Run resumed with item discarded.`);
      // Remove from pending list
      setReviews((prev) => prev.filter((r) => r.id !== reviewId));
    } catch (err) {
      alert(`Rejection failed: ${err instanceof Error ? err.message : "Error"}`);
    } finally {
      setActionInProgress(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b-2 border-[#0A0A0A] gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-[#0A0A0A]/60 mb-1">
            <span>HUMAN-IN-THE-LOOP</span>
            <span>/</span>
            <span>UNCERTAIN REVIEW QUEUE</span>
          </div>
          <h1 className="font-['Archivo_Black'] text-3xl uppercase tracking-tight text-[#0A0A0A]">
            Validation Review Queue
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono text-xs border-2 border-[#0A0A0A] px-3 py-1.5 bg-[#FAFAFA]">
            {reviews.length} PENDING DECISIONS
          </span>
          <Button variant="outline" size="sm" onClick={fetchReviews} loading={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {actionSuccessMessage && (
        <div className="p-4 bg-[#2A9D8F]/15 border-2 border-[#2A9D8F] text-[#0A0A0A] font-mono text-xs flex justify-between items-center">
          <span>{actionSuccessMessage}</span>
          <button
            onClick={() => setActionSuccessMessage(null)}
            className="font-bold cursor-pointer hover:underline"
          >
            DISMISS
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="border-2 border-[#0A0A0A] p-12 text-center bg-[#FAFAFA] font-mono text-sm">
          <span className="inline-block w-3 h-3 bg-[#F4A300] animate-ping mr-3" />
          FETCHING PENDING UNCERTAIN VALIDATION ITEMS...
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="border-2 border-[#E63946] bg-[#E63946]/10 p-6 text-center">
          <p className="font-mono text-sm text-[#E63946] mb-4">
            FAILED TO FETCH REVIEWS: {error}
          </p>
          <Button variant="outline" size="sm" onClick={fetchReviews}>
            Retry
          </Button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && reviews.length === 0 && (
        <div className="border-2 border-[#0A0A0A] p-12 text-center bg-[#FAFAFA]">
          <span className="w-8 h-8 border-2 border-[#2A9D8F] bg-[#2A9D8F]/20 inline-block mb-3" />
          <h3 className="font-['Space_Grotesk'] font-bold text-lg uppercase mb-1">
            Review Queue Clean // No Pending Items
          </h3>
          <p className="font-['Inter'] text-sm text-[#0A0A0A]/70 max-w-md mx-auto">
            All research swarm extractions either passed quality thresholds
            or were rejected. Runs proceed automatically.
          </p>
        </div>
      )}

      {/* Reviews Queue List */}
      {!loading && !error && reviews.length > 0 && (
        <div className="space-y-6">
          {reviews.map((rev) => {
            const vOut = rev.validator_output || {};
            const confidence = typeof vOut.confidence === "number" ? vOut.confidence : 0;
            const safetyFlags = vOut.safety_flags || [];

            return (
              <div
                key={rev.id}
                className="border-2 border-[#0A0A0A] bg-[#FAFAFA] p-6 space-y-6 transition-all"
              >
                {/* Header row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b-2 border-[#0A0A0A] gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <StatusDot status="interrupted" size="sm" />
                      <span className="font-['Space_Grotesk'] font-bold text-sm uppercase">
                        Review Item: {rev.id}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-[#0A0A0A]/60 block">
                      Target Run:{" "}
                      <Link
                        href={`/runs/${rev.run_id}`}
                        className="underline font-bold text-[#1D3557] hover:text-[#E63946]"
                      >
                        {rev.run_id}
                      </Link>
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs px-2.5 py-1 bg-[#F4A300]/20 border border-[#F4A300] text-[#0A0A0A] font-bold">
                      VERDICT: UNCERTAIN ({(confidence * 100).toFixed(0)}%)
                    </span>
                  </div>
                </div>

                {/* Source URL Display (Escaped, inert) */}
                <div className="bg-[#0A0A0A]/5 p-3 border border-[#0A0A0A]/20 font-mono text-xs break-all">
                  <span className="font-bold text-[#0A0A0A] block mb-0.5">SOURCE URL:</span>
                  <span className="text-[#1D3557] select-all">{rev.url}</span>
                </div>

                {/* Dual Column: Extracted Content (Left) vs Validator Reasoning & Safety Flags (Right) */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Left: Scraped & Extracted Content (Escaped text only, NO dangerouslySetInnerHTML) */}
                  <div className="border border-[#0A0A0A] p-4 bg-[#FAFAFA] flex flex-col">
                    <span className="font-['Space_Grotesk'] font-bold text-xs uppercase pb-2 border-b border-[#0A0A0A]/20 mb-3 text-[#0A0A0A]">
                      Extracted Candidate Data // Raw Untrusted
                    </span>
                    <pre className="flex-1 font-mono text-xs text-[#0A0A0A]/90 whitespace-pre-wrap break-words bg-[#FAFAFA] max-h-80 overflow-y-auto p-2 border border-[#0A0A0A]/10">
                      {JSON.stringify(vOut.extracted_json || vOut, null, 2)}
                    </pre>
                  </div>

                  {/* Right: Validator Notes, Confidence, and Safety Flags */}
                  <div className="border border-[#0A0A0A] p-4 bg-[#FAFAFA] flex flex-col justify-between space-y-4">
                    <div>
                      <span className="font-['Space_Grotesk'] font-bold text-xs uppercase pb-2 border-b border-[#0A0A0A]/20 mb-3 text-[#0A0A0A] block">
                        Validator Gate Reasoning & Heuristics
                      </span>

                      {/* Safety Flags Warning if present */}
                      {safetyFlags.length > 0 && (
                        <div className="p-3 bg-[#E63946]/10 border-2 border-[#E63946] mb-4 space-y-1">
                          <span className="font-mono text-xs font-bold text-[#E63946] block">
                            SAFETY FLAGS TRIGGERED:
                          </span>
                          <ul className="list-disc pl-4 font-mono text-xs text-[#E63946]">
                            {safetyFlags.map((flag, idx) => (
                              <li key={idx}>{flag}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Faithfulness Notes */}
                      {vOut.faithfulness_notes && (
                        <div className="mb-3">
                          <span className="font-['Space_Grotesk'] font-bold text-xs text-[#0A0A0A]/70 uppercase block mb-1">
                            Faithfulness Evaluation:
                          </span>
                          <p className="font-['Inter'] text-xs text-[#0A0A0A] leading-relaxed bg-[#0A0A0A]/5 p-2.5 border border-[#0A0A0A]/10">
                            {vOut.faithfulness_notes}
                          </p>
                        </div>
                      )}

                      {/* Relevance Notes */}
                      {vOut.relevance_notes && (
                        <div>
                          <span className="font-['Space_Grotesk'] font-bold text-xs text-[#0A0A0A]/70 uppercase block mb-1">
                            Relevance Evaluation:
                          </span>
                          <p className="font-['Inter'] text-xs text-[#0A0A0A] leading-relaxed bg-[#0A0A0A]/5 p-2.5 border border-[#0A0A0A]/10">
                            {vOut.relevance_notes}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Action Decision Buttons */}
                    <div className="pt-4 border-t-2 border-[#0A0A0A] flex flex-col sm:flex-row items-center justify-end gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleReject(rev.id)}
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
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
