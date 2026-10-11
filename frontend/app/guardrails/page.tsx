"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AlertBanner, Button, CopyButton } from "@/components";
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
      {/* Header with Back Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b-2 border-[#0A0A0A] dark:border-[#2C3142] gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 mb-1">
            <span>AUDIT TRAIL</span>
            <span>/</span>
            <span>ALL DECISIONS LOGGED (PASS &amp; BLOCK)</span>
          </div>
          <h1 className="font-['Archivo_Black'] text-3xl uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2]">
            Guardrail Decisions Audit
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="px-3 py-1.5 border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] font-['Space_Grotesk'] font-bold text-xs uppercase hover:bg-[#0A0A0A] hover:text-[#FAFAFA] dark:hover:bg-[#EDEEF2] dark:hover:text-[#0A0A0A] transition-colors inline-flex items-center gap-1.5 shadow-[2px_2px_0px_0px_#0A0A0A] dark:shadow-none"
          >
            <span>&larr;</span> Back to Dashboard
          </Link>
          <span className="font-mono text-xs border-2 border-[#0A0A0A] dark:border-[#2C3142] px-3 py-1.5 bg-[#FAFAFA] dark:bg-[#14161E] text-[#0A0A0A] dark:text-[#EDEEF2]">
            {events.length} LOGGED DECISIONS
          </span>
          <Button variant="outline" size="sm" onClick={fetchEvents} loading={loading}>
            Refresh Audit
          </Button>
        </div>
      </div>

      {error && !loading && (
        <AlertBanner
          variant="error"
          title="Audit Log Error"
          message={error}
          onClose={() => setError(null)}
        />
      )}

      {/* Filter Bar */}
      <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] p-4 bg-[#FAFAFA] dark:bg-[#14161E] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Run Filter */}
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <label htmlFor="run-filter-input" className="font-['Space_Grotesk'] font-bold text-xs uppercase text-[#0A0A0A] dark:text-[#EDEEF2] shrink-0">
            Run ID:
          </label>
          <input
            id="run-filter-input"
            type="text"
            value={runFilter}
            onChange={(e) => setRunFilter(e.target.value)}
            placeholder="Filter by UUID..."
            className="w-full border-2 border-[#0A0A0A] dark:border-[#2C3142] p-2 font-mono text-xs bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] focus:outline-none focus:border-[#E63946]"
          />
        </div>

        {/* Verdict Filter Buttons */}
        <div className="flex items-center gap-2">
          <span className="font-['Space_Grotesk'] font-bold text-xs uppercase text-[#0A0A0A] dark:text-[#EDEEF2] shrink-0">
            Decision:
          </span>
          {(["ALL", "PASS", "BLOCK"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVerdictFilter(v)}
              className={`px-3 py-1.5 font-['Space_Grotesk'] font-bold text-xs uppercase border-2 border-[#0A0A0A] dark:border-[#2C3142] transition-colors cursor-pointer ${
                verdictFilter === v
                  ? "bg-[#0A0A0A] text-[#FAFAFA] dark:bg-[#EDEEF2] dark:text-[#0A0A0A]"
                  : "bg-[#FAFAFA] dark:bg-[#14161E] text-[#0A0A0A] dark:text-[#EDEEF2] hover:bg-[#0A0A0A]/10"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] p-12 text-center bg-[#FAFAFA] dark:bg-[#14161E] font-mono text-sm text-[#0A0A0A] dark:text-[#EDEEF2]">
          <span className="inline-block w-3 h-3 bg-[#1D3557] dark:bg-[#70B4FF] animate-ping mr-3" />
          QUERYING CENTRAL GUARDRAIL AUDIT TRAIL...
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && events.length === 0 && (
        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] p-12 text-center bg-[#FAFAFA] dark:bg-[#14161E]">
          <span className="w-8 h-8 border-2 border-[#0A0A0A] dark:border-[#2C3142] inline-block mb-3" />
          <h3 className="font-['Space_Grotesk'] font-bold text-lg uppercase mb-1 text-[#0A0A0A] dark:text-[#EDEEF2]">
            No Guardrail Events Logged
          </h3>
          <p className="font-['Inter'] text-sm text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 max-w-md mx-auto">
            Audit trail records all tool schema checks, SSRF egress validations,
            and prompt injection heuristic verdicts.
          </p>
        </div>
      )}

      {/* Filter Yielded Zero Matches */}
      {!loading && !error && events.length > 0 && filteredEvents.length === 0 && (
        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] p-12 text-center bg-[#FAFAFA] dark:bg-[#14161E]">
          <p className="font-mono text-sm text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70">
            No decisions match current filter criteria.
          </p>
        </div>
      )}

      {/* Events Table */}
      {!loading && !error && filteredEvents.length > 0 && (
        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] overflow-x-auto bg-[#FAFAFA] dark:bg-[#14161E]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-[#FAFAFA] dark:bg-[#14161E] z-10">
              <tr className="border-b-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#0A0A0A]/5 dark:bg-[#FFFFFF]/5 font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wider text-[#0A0A0A] dark:text-[#EDEEF2]">
                <th className="p-4 w-24">Decision</th>
                <th className="p-4 w-32">Agent</th>
                <th className="p-4 w-44">Guardrail Type</th>
                <th className="p-4 w-44">Target Run</th>
                <th className="p-4">Details &amp; Reason (Escaped)</th>
                <th className="p-4 w-40">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0A0A0A]/10 dark:divide-[#2C3142] font-mono text-xs">
              {filteredEvents.map((gev) => (
                <tr key={gev.id} className="hover:bg-[#0A0A0A]/5 dark:hover:bg-[#FFFFFF]/5 transition-colors">
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
                  <td className="p-4 font-bold text-[#0A0A0A] dark:text-[#EDEEF2] uppercase">
                    {gev.agent_name}
                  </td>
                  <td className="p-4 text-[#1D3557] dark:text-[#70B4FF] font-bold">
                    {gev.event_type}
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-1.5">
                      <Link
                        href={`/runs/${gev.run_id}`}
                        className="underline text-[#0A0A0A] dark:text-[#EDEEF2] hover:text-[#E63946] truncate max-w-[130px] inline-block"
                        title={gev.run_id}
                      >
                        {gev.run_id.slice(0, 8)}...
                      </Link>
                      <CopyButton text={gev.run_id} label="Run ID" variant="icon" />
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="relative group">
                      <pre className="text-[11px] text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80 whitespace-pre-wrap break-all bg-[#FFFFFF] dark:bg-[#0C0D12] p-2 border border-[#0A0A0A]/10 dark:border-[#2C3142] max-h-28 overflow-y-auto">
                        {JSON.stringify(gev.details, null, 2)}
                      </pre>
                      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <CopyButton text={JSON.stringify(gev.details, null, 2)} label="JSON" variant="button" />
                      </div>
                    </div>
                  </td>
                  <td className="p-4 text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">
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
