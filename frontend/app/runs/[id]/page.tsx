"use client";

import React, { useEffect, useState, useRef, use, Suspense } from "react";
import Link from "next/link";
import { Button, CopyButton, RunTimeline, StatusDot, TexEditor } from "@/components";
import {
  getEventsStreamUrl,
  getGuardrailEvents,
  getRun,
  redoRun,
  GuardrailEventResponse,
  RunResponse,
  SSEEvent,
} from "@/lib/api";
import { TimelineNode } from "@/components/RunTimeline";

interface PageProps {
  params: Promise<{ id: string }>;
}

function formatLocalTime(isoString?: string): string {
  if (!isoString) return "";
  try {
    let clean = isoString.trim();
    if (!clean.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(clean)) {
      clean += "Z";
    }
    const d = new Date(clean);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

function GuardrailDecisionCard({ gev }: { gev: GuardrailEventResponse }) {
  const [expanded, setExpanded] = useState(false);
  const details = (gev.details || {}) as Record<string, any>;

  const rawVerdict = details.verdict || gev.decision || "UNKNOWN";
  const verdict = String(rawVerdict).toUpperCase();
  const confidence =
    typeof details.confidence === "number"
      ? Math.round(details.confidence * 100)
      : null;
  const url = (details.url || details.source_url) as string | undefined;
  const faithfulness = details.faithfulness_notes as string | undefined;
  const relevance = details.relevance_notes as string | undefined;
  const subtask = details.subtask_description as string | undefined;
  const safetyFlags = Array.isArray(details.safety_flags) ? details.safety_flags : [];
  const structuralIssues = Array.isArray(details.structural_issues)
    ? details.structural_issues
    : [];

  const isPass = verdict === "PASS";
  const isFail = verdict === "FAIL";

  return (
    <div className="p-3 border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FFFFFF] dark:bg-[#0C0D12] space-y-2 text-xs font-mono">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-2 pb-1.5 border-b border-[#0A0A0A]/15 dark:border-[#2C3142]">
        <div className="flex items-center gap-2">
          <span className="font-bold text-[#0A0A0A] dark:text-[#EDEEF2] uppercase tracking-wide">
            {gev.agent_name} // {gev.event_type}
          </span>
          {confidence !== null && (
            <span className="text-[10px] text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 font-medium">
              ({confidence}% conf)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              isPass
                ? "bg-[#2A9D8F] text-[#FAFAFA]"
                : isFail
                ? "bg-[#E63946] text-[#FAFAFA]"
                : "bg-[#F4A300] text-[#0A0A0A]"
            }`}
          >
            {verdict}
          </span>
          <span className="text-[10px] text-[#0A0A0A]/40 dark:text-[#EDEEF2]/40 font-mono">
            {formatLocalTime(gev.created_at)}
          </span>
        </div>
      </div>

      {/* Target Source URL */}
      {url && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-[#1D3557] dark:text-[#70B4FF]">
          <div className="flex items-start gap-1 truncate">
            <span className="font-bold text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 shrink-0">Paper URL:</span>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-[#E63946] break-all truncate"
              title={url}
            >
              {url}
            </a>
          </div>
          <CopyButton text={url} label="URL" variant="pill" />
        </div>
      )}

      {/* Subtask Context */}
      {subtask && (
        <div className="text-[11px] text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80 bg-[#FAFAFA] dark:bg-[#14161E] p-2 border border-[#0A0A0A]/10 dark:border-[#2C3142]">
          <span className="font-bold text-[#0A0A0A] dark:text-[#EDEEF2] block text-[10px] uppercase text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 mb-0.5">
            Subtask Evaluated
          </span>
          <p className="line-clamp-2">{subtask}</p>
        </div>
      )}

      {/* Audit Notes: Faithfulness & Relevance */}
      {(faithfulness || relevance) && (
        <div className="space-y-1.5 text-[11px] pt-1">
          {faithfulness && (
            <div className="p-2 border-l-2 border-[#E63946] bg-[#E63946]/5 text-[#0A0A0A] dark:text-[#EDEEF2]">
              <span className="font-bold text-[#E63946] dark:text-[#FF5C6C] block text-[10px] uppercase mb-0.5">
                Faithfulness Assessment
              </span>
              <p className="leading-relaxed">{faithfulness}</p>
            </div>
          )}

          {relevance && (
            <div className="p-2 border-l-2 border-[#1D3557] dark:border-[#70B4FF] bg-[#1D3557]/5 text-[#0A0A0A] dark:text-[#EDEEF2]">
              <span className="font-bold text-[#1D3557] dark:text-[#70B4FF] block text-[10px] uppercase mb-0.5">
                Relevance Assessment
              </span>
              <p className="leading-relaxed">{relevance}</p>
            </div>
          )}
        </div>
      )}

      {/* Safety & Structural Issues */}
      {(safetyFlags.length > 0 || structuralIssues.length > 0) && (
        <div className="flex flex-wrap gap-1 pt-1">
          {safetyFlags.map((flag: string, i: number) => (
            <span
              key={i}
              className="px-1.5 py-0.5 bg-[#E63946] text-[#FAFAFA] text-[9px] font-bold uppercase"
            >
              SAFETY: {flag}
            </span>
          ))}
          {structuralIssues.map((issue: string, i: number) => (
            <span
              key={i}
              className="px-1.5 py-0.5 bg-[#F4A300] text-[#0A0A0A] text-[9px] font-bold uppercase"
            >
              STRUCT: {issue}
            </span>
          ))}
        </div>
      )}

      {/* Raw JSON toggle */}
      <div className="pt-1 border-t border-[#0A0A0A]/10 dark:border-[#2C3142] flex justify-between items-center text-[10px]">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 hover:text-[#E63946] font-bold cursor-pointer underline"
        >
          {expanded ? "Hide Raw Audit JSON ▲" : "Inspect Raw Audit JSON ▼"}
        </button>
        {expanded && (
          <CopyButton text={JSON.stringify(details, null, 2)} label="JSON" variant="pill" />
        )}
      </div>

      {expanded && (
        <pre className="text-[10px] text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80 whitespace-pre-wrap break-all bg-[#0A0A0A]/5 dark:bg-[#FFFFFF]/5 p-2 border border-[#0A0A0A]/15 dark:border-[#2C3142] max-h-40 overflow-y-auto">
          {JSON.stringify(details, null, 2)}
        </pre>
      )}
    </div>
  );
}

function RunDetailContent({ params }: PageProps) {
  const { id: runId } = use(params);

  const [run, setRun] = useState<RunResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // SSE Live State
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [currentNode, setCurrentNode] = useState<string>("planner");
  const [timelineNodes, setTimelineNodes] = useState<TimelineNode[]>([
    { name: "Planner", key: "planner", status: "pending" },
    { name: "Discovery", key: "discovery", status: "pending" },
    { name: "Extractor", key: "extractor", status: "pending" },
    { name: "Validator", key: "validator", status: "pending" },
    { name: "Writer", key: "writer", status: "pending" },
  ]);

  // Guardrail Events for this run
  const [guardrailEvents, setGuardrailEvents] = useState<GuardrailEventResponse[]>([]);

  // Agent output text stream (human-readable AI work text)
  const [agentOutputs, setAgentOutputs] = useState<
    Array<{
      id: string;
      node: string;
      status: string;
      duration_ms?: number;
      agent_text: string;
      timestamp: string;
    }>
  >([]);

  // Overleaf-style TeX Studio state
  const [showTexEditor, setShowTexEditor] = useState<boolean>(false);
  const [isRedoing, setIsRedoing] = useState<boolean>(false);

  // Layout Height Constraint: Right column strictly locked to left column (guardrail box bottom)
  const [leftColHeight, setLeftColHeight] = useState<number | undefined>(undefined);
  const leftColRef = useRef<HTMLDivElement>(null);

  const logContainerRef = useRef<HTMLDivElement>(null);
  const streamContainerRef = useRef<HTMLDivElement>(null);

  const handleRedoRun = async () => {
    setIsRedoing(true);
    try {
      const updated = await redoRun(runId);
      setRun(updated);
      setEvents([]);
      setAgentOutputs([]);
      setCurrentNode("planner");
      setTimelineNodes([
        { name: "Planner", key: "planner", status: "running" },
        { name: "Discovery", key: "discovery", status: "pending" },
        { name: "Extractor", key: "extractor", status: "pending" },
        { name: "Validator", key: "validator", status: "pending" },
        { name: "Writer", key: "writer", status: "pending" },
      ]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to redo research run");
    } finally {
      setIsRedoing(false);
    }
  };

  // Initial Run Fetch
  const loadRun = React.useCallback(async () => {
    try {
      const data = await getRun(runId);
      setRun(data);

      if (data.status === "completed") {
        setTimelineNodes((prev) =>
          prev.map((n) => ({ ...n, status: "completed" }))
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run not found");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  const loadGuardrailEvents = React.useCallback(async () => {
    try {
      const data = await getGuardrailEvents(runId);
      setGuardrailEvents(data);
    } catch {
      // non-fatal
    }
  }, [runId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getRun(runId);
        if (active) {
          setRun(data);
          if (data.status === "completed") {
            setTimelineNodes((prev) =>
              prev.map((n) => ({ ...n, status: "completed" }))
            );
          }
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Run not found");
      } finally {
        if (active) setLoading(false);
      }

      try {
        const gData = await getGuardrailEvents(runId);
        if (active) setGuardrailEvents(gData);
      } catch {
        // non-fatal
      }
    })();

    return () => {
      active = false;
    };
  }, [runId]);

  // Connect to SSE Stream
  useEffect(() => {
    if (!runId) return;

    const streamUrl = getEventsStreamUrl(runId);
    const eventSource = new EventSource(streamUrl);

    eventSource.onmessage = (event) => {
      try {
        const payload: SSEEvent = JSON.parse(event.data);
        setEvents((prev) => [...prev, payload]);

        // Live budget telemetry update
        if (
          payload.pages_processed !== undefined ||
          payload.tokens_used !== undefined ||
          payload.tool_calls_made !== undefined
        ) {
          setRun((prev) =>
            prev
              ? {
                  ...prev,
                  pages_processed:
                    typeof payload.pages_processed === "number"
                      ? payload.pages_processed
                      : prev.pages_processed,
                  tool_calls_made:
                    typeof payload.tool_calls_made === "number"
                      ? payload.tool_calls_made
                      : prev.tool_calls_made,
                  tokens_used:
                    typeof payload.tokens_used === "number"
                      ? payload.tokens_used
                      : prev.tokens_used,
                  wall_clock_seconds:
                    typeof payload.wall_clock_seconds === "number"
                      ? payload.wall_clock_seconds
                      : prev.wall_clock_seconds,
                }
              : prev
          );
        }

        // Process node transition
        if (payload.event_type === "node_transition" && payload.node) {
          const nodeKey = payload.node.toLowerCase() as TimelineNode["key"];
          setCurrentNode(nodeKey);

          if (payload.agent_text) {
            const uniqueId = `${payload.node}-${payload.timestamp || Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            setAgentOutputs((prev) => [
              ...prev,
              {
                id: uniqueId,
                node: payload.node as string,
                status: (payload.status as string) || "SUCCESS",
                duration_ms: payload.duration_ms,
                agent_text: payload.agent_text as string,
                timestamp: payload.timestamp || new Date().toISOString(),
              },
            ]);
          }

          setTimelineNodes((prev) =>
            prev.map((n) => {
              if (n.key === nodeKey) {
                return {
                  ...n,
                  status: payload.status === "FAILED" ? "failed" : "completed",
                  duration_ms: payload.duration_ms,
                };
              }
              return n;
            })
          );
        }

        // Process live guardrail event
        if (payload.event_type === "guardrail_event") {
          const uniqueGId = (payload.id as string) || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          const gEvent: GuardrailEventResponse = {
            id: uniqueGId,
            run_id: (payload.run_id as string) || runId,
            agent_name: (payload.agent_name as string) || "guardrail",
            event_type: (payload.event_type as string) || "audit",
            decision: (payload.decision as string) || "PASS",
            details: (payload.details as Record<string, unknown>) || {},
            created_at: (payload.created_at as string) || new Date().toISOString(),
          };
          setGuardrailEvents((prev) => [gEvent, ...prev]);
        }

        // Process run events
        if (payload.event_type === "run_started") {
          setCurrentNode("planner");
          setTimelineNodes((prev) =>
            prev.map((n, idx) => ({
              ...n,
              status: idx === 0 ? "running" : "pending",
            }))
          );
        } else if (payload.event_type === "run_completed") {
          setRun((prev) => (prev ? { ...prev, status: "completed" } : prev));
          setTimelineNodes((prev) =>
            prev.map((n) => ({ ...n, status: "completed" }))
          );
          loadGuardrailEvents();
        } else if (payload.event_type === "run_interrupted") {
          setRun((prev) => (prev ? { ...prev, status: "interrupted" } : prev));
          loadGuardrailEvents();
        } else if (payload.event_type === "run_failed") {
          setRun((prev) => (prev ? { ...prev, status: "failed" } : prev));
          loadGuardrailEvents();
        }
      } catch {
        // Ping comment or parse error
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [runId, loadGuardrailEvents]);

  // Auto-scroll node events log
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [events]);

  // Auto-scroll agent reasoning stream
  useEffect(() => {
    if (streamContainerRef.current) {
      streamContainerRef.current.scrollTop = streamContainerRef.current.scrollHeight;
    }
  }, [agentOutputs, run?.status]);

  // Synchronize height so right column matches left column (bottom of guardrail decisions box)
  useEffect(() => {
    if (!leftColRef.current) return;
    const updateHeight = () => {
      if (leftColRef.current && window.innerWidth >= 1024) {
        setLeftColHeight(leftColRef.current.offsetHeight);
      } else {
        setLeftColHeight(undefined);
      }
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(leftColRef.current);
    window.addEventListener("resize", updateHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [run, events, guardrailEvents, agentOutputs]);

  // When run completes or reaches Writer stage, auto-open Overleaf TeX editor
  useEffect(() => {
    if (run?.status === "completed" || currentNode === "writer") {
      setShowTexEditor(true);
    }
  }, [run?.status, currentNode]);

  if (loading) {
    return (
      <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] p-12 text-center bg-[#FAFAFA] dark:bg-[#14161E] font-mono text-sm text-[#0A0A0A] dark:text-[#EDEEF2]">
        <span className="inline-block w-4 h-4 bg-[#1D3557] dark:bg-[#70B4FF] animate-ping mr-3" />
        CONNECTING TO SWARM TELEMETRY FOR RUN {runId}...
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="border-2 border-[#E63946] bg-[#E63946]/10 p-8 text-center">
        <h2 className="font-['Space_Grotesk'] font-bold text-xl uppercase text-[#E63946] mb-2">
          Run Telemetry Unavailable
        </h2>
        <p className="font-mono text-sm mb-6 text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80">{error}</p>
        <Link href="/dashboard">
          <Button variant="outline" size="sm">
            &larr; Back to Dashboard
          </Button>
        </Link>
      </div>
    );
  }

  // Budget calculations
  const tokenBudget = run.max_tokens || 500000;
  const tokenPct = Math.min(100, Math.round((run.tokens_used / tokenBudget) * 100));
  const pagesBudget = run.max_pages || 20;
  const pagesPct = Math.min(100, Math.round((run.pages_processed / pagesBudget) * 100));
  const toolCallsBudget = run.max_tool_calls || 200;
  const toolCallsPct = Math.min(100, Math.round((run.tool_calls_made / toolCallsBudget) * 100));

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Status Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b-2 border-[#0A0A0A] dark:border-[#2C3142] gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 mb-1">
            <Link href="/dashboard" className="hover:underline font-bold text-[#1D3557] dark:text-[#70B4FF]">
              &larr; BACK TO DASHBOARD
            </Link>
            <span>/</span>
            <span className="truncate max-w-[140px] font-mono">{run.id}</span>
            <CopyButton text={run.id} label="Run ID" variant="pill" />
          </div>
          <h1 className="font-['Space_Grotesk'] font-bold text-2xl uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2]">
            Research Run Telemetry
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href={`/reviews?run_id=${run.id}`}
            className="px-3 py-1.5 border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] font-['Space_Grotesk'] font-bold text-xs uppercase hover:bg-[#0A0A0A] hover:text-[#FAFAFA] dark:hover:bg-[#EDEEF2] dark:hover:text-[#0A0A0A] transition-colors"
          >
            Reviews {run.pages_uncertain_count > 0 ? `(${run.pages_uncertain_count})` : ""}
          </Link>

          <Button
            variant={showTexEditor ? "primary" : "outline"}
            size="sm"
            onClick={() => setShowTexEditor(!showTexEditor)}
            className="font-mono text-xs"
          >
            {showTexEditor ? "Hide TeX Studio" : "TeX Studio & PDF"}
          </Button>

          <div className="flex items-center gap-2 border-2 border-[#0A0A0A] dark:border-[#2C3142] px-3 py-1.5 bg-[#FAFAFA] dark:bg-[#14161E]">
            <StatusDot status={run.status} size="md" />
            <span className="font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wider text-[#0A0A0A] dark:text-[#EDEEF2]">
              {run.status}
            </span>
          </div>

          <Button variant="outline" size="sm" onClick={loadRun}>
            Refresh
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={handleRedoRun}
            disabled={isRedoing}
            className="font-mono text-xs bg-[#E63946] hover:bg-[#0A0A0A]"
          >
            {isRedoing ? "Restarting..." : "Redo Run ↺"}
          </Button>
        </div>
      </div>

      {/* Overleaf-Style TeX Code Editor & Live Compiler */}
      {showTexEditor && (
        <TexEditor
          runId={runId}
          onClose={() => setShowTexEditor(false)}
        />
      )}

      {/* Failed Run Redo Action Banner */}
      {run.status === "failed" && (
        <div className="border-2 border-[#E63946] bg-[#E63946]/10 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="w-5 h-5 bg-[#E63946] border-2 border-[#0A0A0A] inline-block shrink-0 mt-0.5" />
            <div>
              <h3 className="font-['Space_Grotesk'] font-bold text-base uppercase text-[#E63946]">
                Research Run Terminated // Ready to Redo
              </h3>
              <p className="font-['Inter'] text-sm text-[#0A0A0A]/85 dark:text-[#EDEEF2]/85 mt-0.5">
                {run.error_message || "The swarm encountered a validation or resource issue. You can redo the research run now to refine discovery and achieve a successful paper synthesis."}
              </p>
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={handleRedoRun}
            disabled={isRedoing}
            className="shrink-0 bg-[#E63946] hover:bg-[#0A0A0A] font-bold uppercase tracking-wider"
          >
            {isRedoing ? "Restarting Run..." : "Redo Research Run ↺"}
          </Button>
        </div>
      )}

      {/* Interrupted Human-in-the-Loop Alert Banner */}
      {run.status === "interrupted" && (
        <div className="border-2 border-[#F4A300] bg-[#F4A300]/15 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="w-5 h-5 bg-[#F4A300] border-2 border-[#0A0A0A] inline-block shrink-0 mt-0.5" />
            <div>
              <h3 className="font-['Space_Grotesk'] font-bold text-base uppercase text-[#0A0A0A] dark:text-[#EDEEF2]">
                Human Review Interruption Gate
              </h3>
              <p className="font-['Inter'] text-sm text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80">
                The Validator issued an UNCERTAIN verdict or budget warning.
                Review the pending item to approve or reject.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/reviews?run_id=${run.id}`}>
              <Button variant="primary" size="sm">
                Open Review Queue for this Run &rarr;
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRedoRun}
              disabled={isRedoing}
            >
              Redo Run ↺
            </Button>
          </div>
        </div>
      )}

      {/* 2-Column Split-Screen Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (5 of 12 cols): Telemetry, State Machine, Budgets, Logs */}
        <div ref={leftColRef} className="lg:col-span-5 space-y-6 flex flex-col">
          {/* Objective / Goal Header Card */}
          <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-5">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-xs uppercase text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 block">
                Objective / Goal
              </span>
              <CopyButton text={run.goal} label="Goal" variant="pill" />
            </div>
            <p className="font-['Inter'] text-sm text-[#0A0A0A] dark:text-[#EDEEF2] leading-relaxed font-medium">
              {run.goal}
            </p>
          </div>

          {/* State Machine Progression Graph */}
          <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#0A0A0A]/20 dark:border-[#2C3142] mb-4">
              <h2 className="font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wide text-[#0A0A0A] dark:text-[#EDEEF2]">
                State Machine Progression // 5-Node Graph
              </h2>
              <span className="font-mono text-[11px] text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">
                ACTIVE: {currentNode.toUpperCase()}
              </span>
            </div>
            <RunTimeline currentNode={currentNode} nodes={timelineNodes} />
          </div>

          {/* Budget Usage Bars Grid */}
          <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-5">
            <h2 className="font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wide pb-3 border-b border-[#0A0A0A]/20 dark:border-[#2C3142] mb-4 text-[#0A0A0A] dark:text-[#EDEEF2]">
              Swarm Resource & Budget Allocations
            </h2>

            <div className="space-y-4">
              {/* Tokens */}
              <div className="space-y-1.5">
                <div className="flex justify-between font-mono text-xs text-[#0A0A0A] dark:text-[#EDEEF2]">
                  <span className="text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 uppercase">Tokens Budget</span>
                  <span className="font-bold">
                    {run.tokens_used.toLocaleString()} / {tokenBudget.toLocaleString()} ({tokenPct}%)
                  </span>
                </div>
                <div className="w-full h-2.5 border border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#0C0D12] p-[1px]">
                  <div
                    className={`h-full transition-all ${
                      tokenPct >= 80 ? "bg-[#E63946]" : "bg-[#1D3557] dark:bg-[#70B4FF]"
                    }`}
                    style={{ width: `${tokenPct}%` }}
                  />
                </div>
              </div>

              {/* Pages Processed */}
              <div className="space-y-1.5">
                <div className="flex justify-between font-mono text-xs text-[#0A0A0A] dark:text-[#EDEEF2]">
                  <span className="text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 uppercase">Pages Processed</span>
                  <span className="font-bold">
                    {run.pages_processed} / {pagesBudget} ({pagesPct}%)
                  </span>
                </div>
                <div className="w-full h-2.5 border border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#0C0D12] p-[1px]">
                  <div
                    className={`h-full transition-all ${
                      pagesPct >= 80 ? "bg-[#E63946]" : "bg-[#2A9D8F]"
                    }`}
                    style={{ width: `${pagesPct}%` }}
                  />
                </div>
              </div>

              {/* Tool Calls */}
              <div className="space-y-1.5">
                <div className="flex justify-between font-mono text-xs text-[#0A0A0A] dark:text-[#EDEEF2]">
                  <span className="text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 uppercase">Tool Calls</span>
                  <span className="font-bold">
                    {run.tool_calls_made} / {toolCallsBudget} ({toolCallsPct}%)
                  </span>
                </div>
                <div className="w-full h-2.5 border border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#0C0D12] p-[1px]">
                  <div
                    className="h-full bg-[#0A0A0A] dark:bg-[#EDEEF2] transition-all"
                    style={{ width: `${toolCallsPct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Live Node Events Stream */}
          <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-5 flex flex-col h-[280px]">
            <div className="flex items-center justify-between pb-2 border-b-2 border-[#0A0A0A] dark:border-[#2C3142] mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 bg-[#1D3557] inline-block" />
                <h2 className="font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wide text-[#0A0A0A] dark:text-[#EDEEF2]">
                  Live Node Events Stream
                </h2>
              </div>
              <span className="font-mono text-[11px] text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">
                {events.length} EVENTS
              </span>
            </div>

            <div
              ref={logContainerRef}
              className="flex-1 overflow-y-auto border border-[#0A0A0A]/20 dark:border-[#2C3142] bg-[#0A0A0A]/5 dark:bg-[#0C0D12] p-3 font-mono text-[11px] space-y-1.5 leading-relaxed"
            >
              {events.length === 0 ? (
                <div className="text-[#0A0A0A]/50 dark:text-[#EDEEF2]/50 italic">
                  Awaiting node transition events from SSE stream...
                </div>
              ) : (
                events.map((ev, i) => (
                  <div key={`${ev.event_type}-${ev.timestamp || i}-${i}`} className="pb-1 border-b border-[#0A0A0A]/5 dark:border-[#2C3142]">
                    <span className="text-[#0A0A0A]/50 dark:text-[#EDEEF2]/50 mr-1.5">
                      {ev.timestamp ? formatLocalTime(ev.timestamp) : `[#${i + 1}]`}
                    </span>
                    <span className="font-bold text-[#1D3557] dark:text-[#70B4FF] uppercase mr-1.5">
                      {ev.event_type}
                    </span>
                    {ev.node && (
                      <span className="font-bold text-[#0A0A0A] dark:text-[#EDEEF2] mr-1.5">
                        [{ev.node.toUpperCase()}]
                      </span>
                    )}
                    {ev.status && (
                      <span
                        className={`mr-1.5 px-1 text-[9px] uppercase ${
                          ev.status === "SUCCESS"
                            ? "bg-[#2A9D8F]/20 text-[#2A9D8F]"
                            : "bg-[#E63946]/20 text-[#E63946]"
                        }`}
                      >
                        {ev.status}
                      </span>
                    )}
                    {ev.duration_ms !== undefined && (
                      <span className="text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 mr-1.5">{ev.duration_ms}ms</span>
                    )}
                    {ev.error_message && (
                      <div className="text-[#E63946] mt-0.5 pl-2 border-l border-[#E63946]">
                        {ev.error_message}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Guardrail Decisions Audit Trail */}
          <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-5 flex flex-col h-[340px]">
            <div className="flex items-center justify-between pb-2 border-b-2 border-[#0A0A0A] dark:border-[#2C3142] mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 bg-[#E63946] inline-block" />
                <h2 className="font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wide text-[#0A0A0A] dark:text-[#EDEEF2]">
                  Guardrail Decisions // Audit Trail
                </h2>
              </div>
              <span className="font-mono text-[11px] text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">
                {guardrailEvents.length} DECISIONS
              </span>
            </div>

            <div className="flex-1 overflow-y-auto border border-[#0A0A0A]/20 dark:border-[#2C3142] bg-[#0A0A0A]/5 dark:bg-[#0C0D12] p-2.5 space-y-2.5">
              {guardrailEvents.length === 0 ? (
                <div className="text-[#0A0A0A]/50 dark:text-[#EDEEF2]/50 italic p-2 font-mono text-[11px]">
                  No guardrail decisions logged yet for this run.
                </div>
              ) : (
                guardrailEvents.map((gev) => (
                  <GuardrailDecisionCard key={gev.id} gev={gev} />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column (7 of 12 cols): Agent Work & Reasoning Stream strictly matched to Guardrail Decisions bottom */}
        <div
          className="lg:col-span-7 flex flex-col overflow-hidden"
          style={{
            height: leftColHeight ? `${leftColHeight}px` : "980px",
            maxHeight: leftColHeight ? `${leftColHeight}px` : "980px",
          }}
        >
          <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] flex flex-col h-full max-h-full overflow-hidden">
            {/* Stream Header */}
            <div className="flex items-center justify-between p-4 border-b-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 bg-[#E63946] inline-block" />
                <h2 className="font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wide text-[#0A0A0A] dark:text-[#EDEEF2]">
                  Agent Work & Reasoning Stream // Live Output
                </h2>
              </div>
              <span className="font-mono text-xs text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">
                {agentOutputs.length} AGENT STAGES COMPLETED
              </span>
            </div>

            {/* Scrollable Stream Content Area */}
            <div
              ref={streamContainerRef}
              className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4"
            >
              {agentOutputs.length === 0 ? (
                <div className="border border-dashed border-[#0A0A0A]/30 dark:border-[#2C3142] p-12 text-center bg-[#FAFAFA] dark:bg-[#14161E] my-8">
                  <div className="inline-block animate-pulse w-3 h-3 bg-[#1D3557] dark:bg-[#70B4FF] mr-2" />
                  <span className="font-mono text-xs text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 uppercase">
                    {run.status === "running"
                      ? `Agent [${currentNode.toUpperCase()}] is actively reasoning and processing...`
                      : "Awaiting agent execution output..."}
                  </span>
                </div>
              ) : (
                agentOutputs.map((out) => (
                  <div
                    key={out.id}
                    className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FFFFFF] dark:bg-[#0C0D12] p-4 space-y-3 shadow-none group"
                  >
                    <div className="flex items-center justify-between pb-2 border-b border-[#0A0A0A]/15 dark:border-[#2C3142] text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 ${
                            out.status === "FAILED" ? "bg-[#E63946]" : "bg-[#2A9D8F]"
                          }`}
                        />
                        <span className="font-bold uppercase tracking-wider text-[#0A0A0A] dark:text-[#EDEEF2]">
                          {out.node.toUpperCase()} AGENT
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">
                        {out.duration_ms !== undefined && (
                          <span className="px-1.5 py-0.5 border border-[#0A0A0A]/20 dark:border-[#2C3142] bg-[#0A0A0A]/5 dark:bg-[#FFFFFF]/5">
                            {out.duration_ms}ms
                          </span>
                        )}
                        <span>{formatLocalTime(out.timestamp)}</span>
                        <CopyButton text={out.agent_text} label="Copy Output" variant="button" />
                      </div>
                    </div>

                    <pre className="font-mono text-xs text-[#0A0A0A] dark:text-[#EDEEF2] whitespace-pre-wrap leading-relaxed select-text bg-[#FAFAFA] dark:bg-[#14161E] p-3.5 border border-[#0A0A0A]/20 dark:border-[#2C3142] overflow-x-auto">
                      {out.agent_text}
                    </pre>
                  </div>
                ))
              )}

              {/* Running pulse card */}
              {run.status === "running" && (
                <div className="flex items-center gap-2 text-xs font-mono text-[#1D3557] dark:text-[#70B4FF] p-3 border border-dashed border-[#1D3557]/40 dark:border-[#70B4FF]/40 bg-[#1D3557]/5 dark:bg-[#70B4FF]/10">
                  <span className="w-2 h-2 bg-[#1D3557] dark:bg-[#70B4FF] animate-ping" />
                  <span className="uppercase font-bold">
                    [{currentNode.toUpperCase()}] Agent is working & streaming output...
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RunDetailPage(props: PageProps) {
  return (
    <Suspense
      fallback={
        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] p-12 text-center bg-[#FAFAFA] dark:bg-[#14161E] font-mono text-sm text-[#0A0A0A] dark:text-[#EDEEF2]">
          <span className="inline-block w-3 h-3 bg-[#1D3557] dark:bg-[#70B4FF] animate-ping mr-3" />
          INITIALIZING RUN VIEW...
        </div>
      }
    >
      <RunDetailContent {...props} />
    </Suspense>
  );
}
