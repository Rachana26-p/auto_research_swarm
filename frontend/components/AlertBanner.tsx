"use client";

import React from "react";

export interface AlertBannerProps {
  variant: "success" | "error" | "warning" | "info";
  title?: string;
  message: string;
  onDismiss?: () => void;
  onClose?: () => void;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function AlertBanner({
  variant,
  title,
  message,
  onDismiss,
  onClose,
  action,
  className = "",
}: AlertBannerProps) {
  const dismissHandler = onClose || onDismiss;

  const styles = {
    success: {
      border: "border-[#2A9D8F]",
      bg: "bg-[#2A9D8F]/12 dark:bg-[#48CAE4]/10",
      text: "text-[#0A0A0A] dark:text-[#EDEEF2]",
      badge: "bg-[#2A9D8F] text-[#FAFAFA]",
      icon: "✓",
    },
    error: {
      border: "border-[#E63946]",
      bg: "bg-[#E63946]/12 dark:bg-[#FF5C6C]/10",
      text: "text-[#E63946] dark:text-[#FF5C6C]",
      badge: "bg-[#E63946] text-[#FAFAFA]",
      icon: "✕",
    },
    warning: {
      border: "border-[#F4A300]",
      bg: "bg-[#F4A300]/15 dark:bg-[#F4A300]/10",
      text: "text-[#0A0A0A] dark:text-[#EDEEF2]",
      badge: "bg-[#F4A300] text-[#0A0A0A]",
      icon: "⚠",
    },
    info: {
      border: "border-[#1D3557]",
      bg: "bg-[#1D3557]/10 dark:bg-[#70B4FF]/10",
      text: "text-[#0A0A0A] dark:text-[#EDEEF2]",
      badge: "bg-[#1D3557] text-[#FAFAFA]",
      icon: "ℹ",
    },
  }[variant];

  return (
    <div
      role="alert"
      className={`border-2 ${styles.border} ${styles.bg} p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-[2px_2px_0px_0px_#0A0A0A] dark:shadow-none ${className}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`w-5 h-5 flex items-center justify-center font-bold text-xs shrink-0 ${styles.badge}`}
        >
          {styles.icon}
        </span>
        <div className="space-y-0.5">
          {title && (
            <h4 className="font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wide text-[#0A0A0A] dark:text-[#EDEEF2]">
              {title}
            </h4>
          )}
          <p className={`font-mono text-xs ${styles.text} leading-relaxed`}>
            {message}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
        {action && (
          <button
            onClick={action.onClick}
            className="px-2.5 py-1 border border-[#0A0A0A] dark:border-[#2C3142] bg-[#FFFFFF] dark:bg-[#0C0D12] text-xs font-mono font-bold hover:bg-[#0A0A0A] hover:text-[#FAFAFA] dark:hover:bg-[#EDEEF2] dark:hover:text-[#0A0A0A] transition-colors cursor-pointer"
          >
            {action.label}
          </button>
        )}
        {dismissHandler && (
          <button
            onClick={dismissHandler}
            className="text-xs font-mono font-bold hover:opacity-70 p-1 cursor-pointer text-[#0A0A0A] dark:text-[#EDEEF2]"
            title="Dismiss message"
          >
            &times;
          </button>
        )}
      </div>
    </div>
  );
}
