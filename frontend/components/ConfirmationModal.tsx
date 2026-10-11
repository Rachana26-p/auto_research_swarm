"use client";

import React, { useEffect } from "react";
import { Button } from "./Button";

export interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message?: string;
  description?: string;
  confirmLabel?: string;
  confirmText?: string;
  cancelLabel?: string;
  cancelText?: string;
  variant?: "danger" | "primary";
  isLoading?: boolean;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmationModal({
  isOpen,
  title,
  message,
  description,
  confirmLabel = "Confirm",
  confirmText,
  cancelLabel = "Cancel",
  cancelText,
  variant = "danger",
  isLoading = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmationModalProps) {
  const modalMessage = description || message || "Please confirm this action.";
  const modalConfirmLabel = confirmText || confirmLabel;
  const modalCancelLabel = cancelText || cancelLabel;
  const isBusy = isLoading || loading;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isBusy) {
        onCancel();
      }
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, isBusy, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[#0A0A0A]/60 dark:bg-black/70 backdrop-blur-xs transition-opacity animate-fade-in"
        onClick={!isBusy ? onCancel : undefined}
      />

      {/* Modal Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="relative w-full max-w-md border-3 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-6 shadow-[8px_8px_0px_0px_#0A0A0A] dark:shadow-[8px_8px_0px_0px_rgba(0,0,0,0.8)] z-10 space-y-5 animate-scale-up"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b-2 border-[#0A0A0A] dark:border-[#2C3142] pb-3">
          <span
            className={`w-3.5 h-3.5 inline-block border border-[#0A0A0A] ${
              variant === "danger" ? "bg-[#E63946]" : "bg-[#1D3557]"
            }`}
          />
          <h3
            id="modal-title"
            className="font-['Archivo_Black'] text-lg uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2]"
          >
            {title}
          </h3>
        </div>

        {/* Body Text */}
        <p className="font-['Inter'] text-sm text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80 leading-relaxed font-medium">
          {modalMessage}
        </p>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t-2 border-[#0A0A0A] dark:border-[#2C3142]">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={isBusy}
            className="font-mono text-xs uppercase"
          >
            {modalCancelLabel}
          </Button>

          <Button
            type="button"
            variant={variant === "danger" ? "primary" : "outline"}
            size="sm"
            onClick={onConfirm}
            loading={isBusy}
            className={`font-mono text-xs uppercase ${
              variant === "danger"
                ? "bg-[#E63946] text-[#FAFAFA] hover:bg-[#0A0A0A]"
                : ""
            }`}
          >
            {modalConfirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
