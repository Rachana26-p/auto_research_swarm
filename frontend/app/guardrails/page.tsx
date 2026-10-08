"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components";
import { getGuardrailEvents, GuardrailEventResponse } from "@/lib/api";

export default function GuardrailsPage() {
  const [events, setEvents] = useState<GuardrailEventResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [runFilter, setRunFilter] = useState("");
  const [verdictFilter, setVerdictFilter] = useState<"ALL" | "PASS" | "BLOCK">("ALL");

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getGuardrailEvents();
      setEvents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load guardrail events");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getGuardrailEvents();
        if (active) {
          setEvents(data);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load guardrail events");
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

  const filteredEvents = events.filter((ev) => {
    if (runFilter.trim()) {
      const target = runFilter.toLowerCase().trim();
      if (!ev.run_id.toLowerCase().includes(target)) {
        return false;
      }
    }
    if (verdictFilter !== "ALL") {
      if (ev.decision.toUpperCase() !== verdictFilter) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b-2 border-[#0A0A0A] gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-[#0A0A0A]/60 mb-1">
            <span>AUDIT TRAIL</span>
            <span>/</span>
            <span>ALL DECISIONS LOGGED (PASS &amp; BLOCK)</span>
          </div>
          <h1 className="font-['Archivo_Black'] text-3xl uppercase tracking-tight text-[#0A0A0A]">
            Guardrail Decisions Audit
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono text-xs border-2 border-[#0A0A0A] px-3 py-1.5 bg-[#FAFAFA]">
            {events.length} LOGGED DECISIONS
          </span>
          <Button variant="outline" size="sm" onClick={fetchEvents} loading={loading}>
            Refresh Audit
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="border-2 border-[#0A0A0A] p-4 bg-[#FAFAFA] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Run Filter */}
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <label htmlFor="run-filter-input" className="font-['Space_Grotesk'] font-bold text-xs uppercase text-[#0A0A0A] shrink-0">
            Run ID:
          </label>
          <input
            id="run-filter-input"
            type="text"
            value={runFilter}
            onChange={(e) => setRunFilter(e.target.value)}
            placeholder="Filter by UUID..."
            className="w-full border-2 border-[#0A0A0A] p-2 font-mono text-xs bg-[#FAFAFA] text-[#0A0A0A] focus:outline-none focus:border-[#E63946] radius-sm"
          />
        </div>

        {/* Verdict Filter Buttons */}
        <div className="flex items-center gap-2">
          <span className="font-['Space_Grotesk'] font-bold text-xs uppercase text-[#0A0A0A] shrink-0">
            Decision:
          </span>
          {(["ALL", "PASS", "BLOCK"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVerdictFilter(v)}
              className={`px-3 py-1.5 font-['Space_Grotesk'] font-bold text-xs uppercase border-2 border-[#0A0A0A] transition-colors cursor-pointer ${
                verdictFilter === v
                  ? "bg-[#0A0A0A] text-[#FAFAFA]"
                  : "bg-[#FAFAFA] text-[#0A0A0A] hover:bg-[#0A0A0A]/10"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="border-2 border-[#0A0A0A] p-12 text-center bg-[#FAFAFA] font-mono text-sm">
          <span className="inline-block w-3 h-3 bg-[#1D3557] animate-ping mr-3" />
          QUERYING CENTRAL GUARDRAIL AUDIT TRAIL...
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="border-2 border-[#E63946] bg-[#E63946]/10 p-6 text-center">
          <p className="font-mono text-sm text-[#E63946] mb-4">
            FAILED TO RETRIEVE AUDIT LOG: {error}
          </p>
          <Button variant="outline" size="sm" onClick={fetchEvents}>
            Retry Query
          </Button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && events.length === 0 && (
        <div className="border-2 border-[#0A0A0A] p-12 text-center bg-[#FAFAFA]">
          <span className="w-8 h-8 border-2 border-[#0A0A0A] inline-block mb-3" />
          <h3 className="font-['Space_Grotesk'] font-bold text-lg uppercase mb-1">
            No Guardrail Events Logged
          </h3>
          <p className="font-['Inter'] text-sm text-[#0A0A0A]/70 max-w-md mx-auto">
            Audit trail records all tool schema checks, SSRF egress validations,
            and prompt injection heuristic verdicts.
          </p>
        </div>
      )}

      {/* Filter Yielded Zero Matches */}
      {!loading && !error && events.length > 0 && filteredEvents.length === 0 && (
        <div className="border-2 border-[#0A0A0A] p-12 text-center bg-[#FAFAFA]">
          <p className="font-mono text-sm text-[#0A0A0A]/70">
            No decisions match current filter criteria.
          </p>
        </div>
      )}

      {/* Events Table */}
      {!loading && !error && filteredEvents.length > 0 && (
        <div className="border-2 border-[#0A0A0A] overflow-x-auto bg-[#FAFAFA]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-[#0A0A0A] bg-[#0A0A0A]/5 font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wider text-[#0A0A0A]">
                <th className="p-4 w-24">Decision</th>
                <th className="p-4 w-32">Agent</th>
                <th className="p-4 w-44">Guardrail Type</th>
                <th className="p-4 w-44">Target Run</th>
                <th className="p-4">Details &amp; Reason (Escaped)</th>
                <th className="p-4 w-40">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y border-[#0A0A0A]/10 font-mono text-xs">
              {filteredEvents.map((gev) => (
                <tr key={gev.id} className="hover:bg-[#0A0A0A]/5 transition-colors">
                  <td className="p-4">
                    <span
                      className={`inline-block px-2.5 py-1 text-[10px] font-bold uppercase border ${
                        gev.decision === "PASS"
                          ? "bg-[#2A9D8F] text-[#FAFAFA] border-[#2A9D8F]"
                          : "bg-[#E63946] text-[#FAFAFA] border-[#E63946]"
                      }`}
                    >
                      {gev.decision}
                    </span>
                  </td>
                  <td className="p-4 font-bold text-[#0A0A0A] uppercase">
                    {gev.agent_name}
                  </td>
                  <td className="p-4 text-[#1D3557] font-bold">
                    {gev.event_type}
                  </td>
                  <td className="p-4">
                    <Link
                      href={`/runs/${gev.run_id}`}
                      className="underline text-[#0A0A0A] hover:text-[#E63946] truncate max-w-[130px] inline-block"
                      title={gev.run_id}
                    >
                      {gev.run_id.slice(0, 8)}...
                    </Link>
                  </td>
                  <td className="p-4">
                    <pre className="text-[11px] text-[#0A0A0A]/80 whitespace-pre-wrap break-all bg-[#0A0A0A]/5 p-2 border border-[#0A0A0A]/10 max-h-28 overflow-y-auto">
                      {JSON.stringify(gev.details, null, 2)}
                    </pre>
                  </td>
                  <td className="p-4 text-[#0A0A0A]/60">
                    {new Date(gev.created_at).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
