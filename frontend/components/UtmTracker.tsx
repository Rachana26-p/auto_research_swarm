"use client";

import { useEffect } from "react";
import { captureUtmParameters } from "@/lib/utm";

export function UtmTracker() {
  useEffect(() => {
    captureUtmParameters();
  }, []);

  return null;
}
