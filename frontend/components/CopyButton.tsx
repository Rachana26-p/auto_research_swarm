"use client";

import React, { useState } from "react";
import { CopyIcon, CheckIcon } from "./Icons";

export interface CopyButtonProps {
  text?: string;
  value?: string;
  textToCopy?: string;
  label?: string;
  className?: string;
  variant?: "icon" | "button" | "pill";
}

export function CopyButton({
  text,
  value,
  textToCopy,
  label = "Copy",
  className = "",
  variant = "button",
}: CopyButtonProps) {
  const contentToCopy = text ?? value ?? textToCopy ?? "";
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(contentToCopy);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = contentToCopy;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  if (variant === "icon") {
    return (
      <button
        onClick={handleCopy}
        className={`p-1.5 border border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] text-[#0A0A0A] dark:text-[#EDEEF2] hover:bg-[#0A0A0A] hover:text-[#FAFAFA] dark:hover:bg-[#EDEEF2] dark:hover:text-[#0A0A0A] transition-colors cursor-pointer text-xs font-mono inline-flex items-center justify-center ${className}`}
        title={copied ? "Copied to clipboard!" : "Copy text"}
        aria-label={copied ? "Copied" : "Copy"}
        type="button"
      >
        {copied ? <CheckIcon size={13} className="text-[#2A9D8F]" /> : <CopyIcon size={13} />}
      </button>
    );
  }

  if (variant === "pill") {
    return (
      <button
        onClick={handleCopy}
        className={`px-2 py-0.5 border text-[10px] font-mono uppercase transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
          copied
            ? "bg-[#2A9D8F] text-[#FAFAFA] border-[#2A9D8F]"
            : "border-[#0A0A0A]/40 dark:border-[#2C3142] bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] hover:border-[#0A0A0A] dark:hover:border-[#EDEEF2]"
        } ${className}`}
        type="button"
      >
        {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
        <span>{copied ? "Copied" : label}</span>
      </button>
    );
  }

  return (
    <button
      onClick={handleCopy}
      className={`px-2.5 py-1 border text-xs font-mono font-bold transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
        copied
          ? "bg-[#2A9D8F] text-[#FAFAFA] border-[#2A9D8F]"
          : "border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] text-[#0A0A0A] dark:text-[#EDEEF2] hover:bg-[#0A0A0A] hover:text-[#FAFAFA] dark:hover:bg-[#EDEEF2] dark:hover:text-[#0A0A0A]"
      } ${className}`}
      type="button"
    >
      {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      <span>{copied ? "Copied!" : label}</span>
    </button>
  );
}
