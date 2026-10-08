"use client";

import React, { useEffect, useState, useRef, use, Suspense } from "react";
import Link from "next/link";
import { Button, RunTimeline, StatusDot } from "@/components";
import {
  getEventsStreamUrl,
  getGuardrailEvents,
  getRun,
  GuardrailEventResponse,
  RunResponse,
  SSEEvent,
} from "@/lib/api";
import { TimelineNode } from "@/components/RunTimeline";

interface PageProps {
  params: Promise<{ id: string }>;
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

  const logContainerRef = useRef<HTMLDivElement>(null);

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

        // Process node transition
        if (payload.event_type === "node_transition" && payload.node) {
          const nodeKey = payload.node.toLowerCase() as TimelineNode["key"];
          setCurrentNode(nodeKey);

          if (payload.agent_text) {
            setAgentOutputs((prev) => [
              ...prev,
              {
                id: `${payload.node}-${Date.now()}`,
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
          const gEvent: GuardrailEventResponse = {
            id: (payload.id as string) || String(Date.now()),
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

  // Auto-scroll log
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [events]);

  if (loading) {
    return (
      <div className="border-2 border-[#0A0A0A] p-12 text-center bg-[#FAFAFA] font-mono text-sm">
        <span className="inline-block w-4 h-4 bg-[#1D3557] animate-ping mr-3" />
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
        <p className="font-mono text-sm mb-6 text-[#0A0A0A]/80">{error}</p>
        <Link href="/">
          <Button variant="outline" size="sm">
            &larr; Back to Runs Dashboard
          </Button>
        </Link>
      </div>
    );
  }

  // Budget calculations
  const tokenBudget = 500000;
  const tokenPct = Math.min(100, Math.round((run.tokens_used / tokenBudget) * 100));
  const pagesBudget = 20;
  const pagesPct = Math.min(100, Math.round((run.pages_processed / pagesBudget) * 100));
  const toolCallsBudget = 200;
  const toolCallsPct = Math.min(100, Math.round((run.tool_calls_made / toolCallsBudget) * 100));

  return (
    <div className="space-y-8">
      {/* Top Breadcrumb & Status Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b-2 border-[#0A0A0A] gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-[#0A0A0A]/60 mb-1">
            <Link href="/" className="hover:underline">
              RUNS
            </Link>
            <span>/</span>
            <span>{run.id}</span>
          </div>
          <h1 className="font-['Space_Grotesk'] font-bold text-2xl uppercase tracking-tight text-[#0A0A0A]">
            Research Run Telemetry
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 border-2 border-[#0A0A0A] px-3 py-1.5 bg-[#FAFAFA]">
            <StatusDot status={run.status} size="md" />
            <span className="font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wider">
              {run.status}
            </span>
          </div>

          <Button variant="outline" size="sm" onClick={loadRun}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Interrupted Human-in-the-Loop Alert Banner */}
      {run.status === "interrupted" && (
        <div className="border-2 border-[#F4A300] bg-[#F4A300]/15 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="w-5 h-5 bg-[#F4A300] border-2 border-[#0A0A0A] inline-block shrink-0 mt-0.5" />
            <div>
              <h3 className="font-['Space_Grotesk'] font-bold text-base uppercase text-[#0A0A0A]">
                Human Review Interruption Gate
              </h3>
              <p className="font-['Inter'] text-sm text-[#0A0A0A]/80">
                The Validator issued an UNCERTAIN verdict or budget warning.
                Review the pending item to approve or reject.
              </p>
            </div>
          </div>
          <Link href="/reviews">
            <Button variant="primary" size="sm">
              Open Review Queue &rarr;
            </Button>
          </Link>
        </div>
      )}

      {/* Research Goal Header Card */}
      <div className="border-2 border-[#0A0A0A] bg-[#FAFAFA] p-6">
        <span className="font-mono text-xs uppercase text-[#0A0A0A]/60 block mb-1">
          Objective / Goal
        </span>
        <p className="font-['Inter'] text-base text-[#0A0A0A] leading-relaxed font-medium">
          {run.goal}
        </p>
      </div>

      {/* Bauhaus State Machine Timeline */}
      <div className="border-2 border-[#0A0A0A] bg-[#FAFAFA] p-6">
        <div className="flex items-center justify-between pb-3 border-b border-[#0A0A0A]/20 mb-4">
          <h2 className="font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wide">
            State Machine Progression // 5-Node Graph
          </h2>
          <span className="font-mono text-xs text-[#0A0A0A]/60">
            ACTIVE NODE: {currentNode.toUpperCase()}
          </span>
        </div>
        <RunTimeline currentNode={currentNode} nodes={timelineNodes} />
      </div>

      {/* Live Agent Reasoning & Work Text Stream (Like AI Chat / Output Stream) */}
      <div className="border-2 border-[#0A0A0A] bg-[#FAFAFA] p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b-2 border-[#0A0A0A]">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 bg-[#E63946] inline-block" />
            <h2 className="font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wide">
              Agent Work & Reasoning Stream // Live Text Output
            </h2>
          </div>
          <span className="font-mono text-xs text-[#0A0A0A]/60">
            {agentOutputs.length} AGENT STAGES COMPLETED
          </span>
        </div>

        {agentOutputs.length === 0 ? (
          <div className="border border-dashed border-[#0A0A0A]/30 p-8 text-center bg-[#FAFAFA]">
            <div className="inline-block animate-pulse w-2.5 h-2.5 bg-[#1D3557] mr-2" />
            <span className="font-mono text-xs text-[#0A0A0A]/70 uppercase">
              {run.status === "running"
                ? `Agent [${currentNode.toUpperCase()}] is actively reasoning and processing...`
                : "Awaiting agent execution output..."}
            </span>
          </div>
        ) : (
          <div className="space-y-4">
            {agentOutputs.map((out) => (
              <div
                key={out.id}
                className="border-2 border-[#0A0A0A] bg-[#FFFFFF] p-5 space-y-3 shadow-none"
              >
                <div className="flex items-center justify-between pb-2 border-b border-[#0A0A0A]/15 text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 ${
                        out.status === "FAILED" ? "bg-[#E63946]" : "bg-[#2A9D8F]"
                      }`}
                    />
                    <span className="font-bold uppercase tracking-wider text-[#0A0A0A]">
                      {out.node.toUpperCase()} AGENT
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[#0A0A0A]/60">
                    {out.duration_ms !== undefined && (
                      <span className="px-1.5 py-0.5 border border-[#0A0A0A]/20 bg-[#0A0A0A]/5">
                        {out.duration_ms}ms
                      </span>
                    )}
                    <span>{new Date(out.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>

                <pre className="font-mono text-xs text-[#0A0A0A] whitespace-pre-wrap leading-relaxed select-text bg-[#FAFAFA] p-4 border border-[#0A0A0A]/20 overflow-x-auto">
                  {out.agent_text}
                </pre>
              </div>
            ))}

            {run.status === "running" && (
              <div className="flex items-center gap-2 text-xs font-mono text-[#1D3557] p-3 border border-dashed border-[#1D3557]/40 bg-[#1D3557]/5">
                <span className="w-2 h-2 bg-[#1D3557] animate-ping" />
                <span className="uppercase font-bold">
                  [{currentNode.toUpperCase()}] Agent is working & streaming output...
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Budget Usage Bars Grid */}
      <div className="border-2 border-[#0A0A0A] bg-[#FAFAFA] p-6">
        <h2 className="font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wide pb-3 border-b border-[#0A0A0A]/20 mb-6">
          Swarm Resource & Budget Allocations
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {/* Tokens */}
          <div className="space-y-2">
            <div className="flex justify-between font-mono text-xs">
              <span className="text-[#0A0A0A]/70 uppercase">Tokens Budget</span>
              <span className="font-bold">
                {run.tokens_used.toLocaleString()} / {tokenBudget.toLocaleString()} ({tokenPct}%)
              </span>
            </div>
            <div className="w-full h-3 border border-[#0A0A0A] bg-[#FAFAFA] p-[1px]">
              <div
                className={`h-full transition-all ${
                  tokenPct >= 80 ? "bg-[#E63946]" : "bg-[#1D3557]"
                }`}
                style={{ width: `${tokenPct}%` }}
              />
            </div>
          </div>

          {/* Pages Processed */}
          <div className="space-y-2">
            <div className="flex justify-between font-mono text-xs">
              <span className="text-[#0A0A0A]/70 uppercase">Pages Processed</span>
              <span className="font-bold">
                {run.pages_processed} / {pagesBudget} ({pagesPct}%)
              </span>
            </div>
            <div className="w-full h-3 border border-[#0A0A0A] bg-[#FAFAFA] p-[1px]">
              <div
                className={`h-full transition-all ${
                  pagesPct >= 80 ? "bg-[#E63946]" : "bg-[#2A9D8F]"
                }`}
                style={{ width: `${pagesPct}%` }}
              />
            </div>
          </div>

          {/* Tool Calls */}
          <div className="space-y-2">
            <div className="flex justify-between font-mono text-xs">
              <span className="text-[#0A0A0A]/70 uppercase">Tool Calls</span>
              <span className="font-bold">
                {run.tool_calls_made} / {toolCallsBudget} ({toolCallsPct}%)
              </span>
            </div>
            <div className="w-full h-3 border border-[#0A0A0A] bg-[#FAFAFA] p-[1px]">
              <div
                className="h-full bg-[#0A0A0A] transition-all"
                style={{ width: `${toolCallsPct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Dual Split: Live Tool-Call Log (Left) & Guardrail Audit Log (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Monospace Tool-Call and Transition Event Log */}
        <div className="border-2 border-[#0A0A0A] bg-[#FAFAFA] p-6 flex flex-col h-[480px]">
          <div className="flex items-center justify-between pb-3 border-b-2 border-[#0A0A0A] mb-4">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-[#1D3557] inline-block" />
              <h2 className="font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wide">
                Live Node Events Stream
              </h2>
            </div>
            <span className="font-mono text-xs text-[#0A0A0A]/60">
              {events.length} EVENTS
            </span>
          </div>

          <div
            ref={logContainerRef}
            className="flex-1 overflow-y-auto border border-[#0A0A0A]/20 bg-[#0A0A0A]/5 p-4 font-mono text-xs space-y-2 leading-relaxed"
          >
            {events.length === 0 ? (
              <div className="text-[#0A0A0A]/50 italic">
                Awaiting node transition events from SSE stream...
              </div>
            ) : (
              events.map((ev, i) => (
                <div key={i} className="pb-1 border-b border-[#0A0A0A]/5">
                  <span className="text-[#0A0A0A]/40 mr-2">
                    {ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : `[#${i + 1}]`}
                  </span>
                  <span className="font-bold text-[#1D3557] uppercase mr-2">
                    {ev.event_type}
                  </span>
                  {ev.node && (
                    <span className="font-bold text-[#0A0A0A] mr-2">
                      [{ev.node.toUpperCase()}]
                    </span>
                  )}
                  {ev.status && (
                    <span
                      className={`mr-2 px-1 text-[10px] uppercase ${
                        ev.status === "SUCCESS"
                          ? "bg-[#2A9D8F]/20 text-[#2A9D8F]"
                          : "bg-[#E63946]/20 text-[#E63946]"
                      }`}
                    >
                      {ev.status}
                    </span>
                  )}
                  {ev.duration_ms !== undefined && (
                    <span className="text-[#0A0A0A]/60 mr-2">{ev.duration_ms}ms</span>
                  )}
                  {ev.error_message && (
                    <div className="text-[#E63946] mt-0.5 pl-4 border-l border-[#E63946]">
                      {ev.error_message}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Guardrail Decisions for this Run */}
        <div className="border-2 border-[#0A0A0A] bg-[#FAFAFA] p-6 flex flex-col h-[480px]">
          <div className="flex items-center justify-between pb-3 border-b-2 border-[#0A0A0A] mb-4">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-[#E63946] inline-block" />
              <h2 className="font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wide">
                Guardrail Decisions // Audit Trail
              </h2>
            </div>
            <span className="font-mono text-xs text-[#0A0A0A]/60">
              {guardrailEvents.length} DECISIONS
            </span>
          </div>

          <div className="flex-1 overflow-y-auto border border-[#0A0A0A]/20 bg-[#0A0A0A]/5 p-4 font-mono text-xs space-y-2.5">
            {guardrailEvents.length === 0 ? (
              <div className="text-[#0A0A0A]/50 italic">
                No guardrail decisions logged yet for this run.
              </div>
            ) : (
              guardrailEvents.map((gev) => (
                <div
                  key={gev.id}
                  className="p-2.5 border border-[#0A0A0A]/10 bg-[#FAFAFA] space-y-1"
                >
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="font-bold text-[#0A0A0A] uppercase">
                      {`${gev.agent_name} // ${gev.event_type}`}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 text-[10px] font-bold ${
                        gev.decision === "PASS"
                          ? "bg-[#2A9D8F] text-[#FAFAFA]"
                          : "bg-[#E63946] text-[#FAFAFA]"
                      }`}
                    >
                      {gev.decision}
                    </span>
                  </div>
                  <pre className="text-[10px] text-[#0A0A0A]/80 whitespace-pre-wrap break-all bg-[#0A0A0A]/5 p-1.5 border border-[#0A0A0A]/10 max-h-24 overflow-y-auto">
                    {JSON.stringify(gev.details, null, 2)}
                  </pre>
                </div>
              ))
            )}
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
        <div className="border-2 border-[#0A0A0A] p-12 text-center bg-[#FAFAFA] font-mono text-sm">
          <span className="inline-block w-3 h-3 bg-[#1D3557] animate-ping mr-3" />
          INITIALIZING RUN VIEW...
        </div>
      }
    >
      <RunDetailContent {...props} />
    </Suspense>
  );
}
