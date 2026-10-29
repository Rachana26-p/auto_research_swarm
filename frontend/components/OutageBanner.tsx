"use client";

import React, { useEffect, useState, useCallback } from "react";

interface HealthData {
  status: string;
  db: string;
  auth: string;
}

export function OutageBanner() {
  const [isOutage, setIsOutage] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(15);
  const [checking, setChecking] = useState(false);

  const checkHealth = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/health/deep", {
        headers: { "Cache-Control": "no-cache" },
      });
      if (res.status === 503) {
        setIsOutage(true);
        setRetryCountdown(15);
      } else {
        const data: HealthData = await res.json().catch(() => ({ status: "ok", db: "reachable", auth: "reachable" }));
        if (data.status === "degraded" || data.db === "unreachable") {
          setIsOutage(true);
          setRetryCountdown(15);
        } else {
          setIsOutage(false);
        }
      }
    } catch {
      setIsOutage(true);
      setRetryCountdown(15);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (active) void checkHealth();
    }, 100);

    const interval = setInterval(() => {
      if (active) void checkHealth();
    }, isOutage ? 15000 : 30000);

    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [checkHealth, isOutage]);

  useEffect(() => {
    if (!isOutage) return;
    const timer = setInterval(() => {
      setRetryCountdown((prev) => (prev > 1 ? prev - 1 : 15));
    }, 1000);
    return () => clearInterval(timer);
  }, [isOutage]);

  if (!isOutage) return null;

  return (
    <div
      role="alert"
      className="bg-[#E63946] text-[#FAFAFA] border-b-2 border-[#0A0A0A] px-4 py-2.5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs font-mono shadow-[0_2px_0_0_#0A0A0A] z-[9999]"
    >
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 bg-[#F4A300] animate-pulse inline-block" />
        <span className="font-bold tracking-wider uppercase font-['Space_Grotesk']">
          DATABASE UNAVAILABLE — SUPABASE INFRASTRUCTURE DOWN
        </span>
        <span className="hidden md:inline text-white/80">
          (AUTO-RETRYING IN {retryCountdown}s)
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={checkHealth}
          disabled={checking}
          className="px-2.5 py-1 bg-[#FAFAFA] text-[#0A0A0A] font-bold text-xs uppercase hover:bg-[#F4A300] transition-colors border border-[#0A0A0A] cursor-pointer disabled:opacity-50"
        >
          {checking ? "Checking..." : "Retry Now"}
        </button>
      </div>
    </div>
  );
}
