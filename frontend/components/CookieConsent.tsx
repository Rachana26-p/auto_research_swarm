"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "./Button";

export function CookieConsent() {
  const [showBanner, setShowBanner] = useState<boolean>(false);

  useEffect(() => {
    try {
      const consent = localStorage.getItem("cookie_consent_choice");
      if (!consent) {
        setShowBanner(true);
      }
    } catch {
      // LocalStorage access restricted
    }
  }, []);

  const handleChoice = (choice: "accepted" | "essential") => {
    try {
      localStorage.setItem("cookie_consent_choice", choice);
      localStorage.setItem("cookie_consent_timestamp", new Date().toISOString());
    } catch {
      // fallback
    }
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-md z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-5 shadow-[4px_4px_0px_0px_#0A0A0A] dark:shadow-[4px_4px_0px_0px_rgba(0,0,0,0.6)] space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 bg-[#E63946] inline-block border border-[#0A0A0A] dark:border-[#2C3142]" />
          <h4 className="font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wider text-[#0A0A0A] dark:text-[#EDEEF2]">
            Cookie &amp; Telemetry Notice
          </h4>
        </div>

        <p className="font-['Inter'] text-xs text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80 leading-relaxed">
          We use strictly essential session tokens and anonymous execution telemetry to coordinate
          multi-agent research runs and preserve user state. Read our{" "}
          <Link href="/privacy" className="underline font-bold hover:text-[#E63946] dark:hover:text-[#FF5C6C]">
            Privacy Policy
          </Link>.
        </p>

        <div className="flex items-center gap-2 pt-1 font-mono text-xs">
          <Button
            variant="primary"
            size="sm"
            onClick={() => handleChoice("accepted")}
            className="flex-1"
          >
            Accept All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleChoice("essential")}
            className="flex-1"
          >
            Essential Only
          </Button>
        </div>
      </div>
    </div>
  );
}
