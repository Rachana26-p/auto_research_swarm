"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mapAuthError, MappedAuthError } from "@/lib/auth-errors";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorState, setErrorState] = useState<MappedAuthError | null>(null);
  const [success, setSuccess] = useState(false);

  const hasMinLength = password.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  const isFormValid = hasMinLength && hasLetter && hasNumber && passwordsMatch;
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorState(null);

    if (!passwordsMatch) {
      setErrorState({
        message: "Passwords do not match.",
        field: "confirmPassword",
        code: "PASSWORD_MISMATCH",
      });
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        setErrorState(mapAuthError(error, "reset"));
      } else {
        setSuccess(true);
        setTimeout(() => {
          router.push("/sign-in");
        }, 2500);
      }
    } catch (err) {
      setErrorState(mapAuthError(err, "reset"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto my-12 border-2 border-[#0A0A0A] bg-[#FAFAFA] dark:bg-[#101217] dark:border-[#2C3142] p-8 shadow-[4px_4px_0px_0px_#0A0A0A] dark:shadow-none transition-colors">
      <div className="mb-6 border-b-2 border-[#0A0A0A] dark:border-[#2C3142] pb-4">
        <span className="font-mono text-xs uppercase tracking-wider text-[#1D3557] dark:text-[#70B4FF] block mb-1">
          // SECURITY CREDENTIAL UPDATE
        </span>
        <h1 className="font-['Archivo_Black'] text-2xl uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2]">
          New Password
        </h1>
      </div>

      {success ? (
        <div className="p-4 border-2 border-[#2A9D8F] bg-[#2A9D8F]/10 text-[#0A0A0A] dark:text-[#EDEEF2] font-mono text-xs space-y-2">
          <p className="font-bold">✓ Password updated successfully.</p>
          <p className="text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70">Redirecting to Sign In...</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {errorState && (
            <div
              role="alert"
              className="p-3 border-2 border-[#E63946] bg-[#E63946]/10 text-[#0A0A0A] dark:text-[#EDEEF2] font-mono text-xs flex items-start gap-2"
            >
              <span className="font-bold text-[#E63946]">[ERROR]</span>
              <span>{errorState.message}</span>
            </div>
          )}

          <div>
            <label className="block font-mono text-xs uppercase font-bold text-[#0A0A0A] dark:text-[#EDEEF2] mb-1.5">
              New Password
            </label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 8 chars with letter & number"
              className="w-full px-3 py-2 border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#1D3557]"
            />
          </div>

          <div>
            <label className="block font-mono text-xs uppercase font-bold text-[#0A0A0A] dark:text-[#EDEEF2] mb-1.5">
              Confirm New Password
            </label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              className="w-full px-3 py-2 border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#1D3557]"
            />
          </div>

          {/* Rules */}
          <div className="p-3 bg-[#FFFFFF] dark:bg-[#0C0D12] border border-[#0A0A0A] dark:border-[#2C3142] space-y-1 font-mono text-[11px]">
            <div className={`flex items-center gap-1.5 ${hasMinLength ? "text-[#2A9D8F]" : "text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60"}`}>
              <span>{hasMinLength ? "✓" : "○"}</span>
              <span>At least 8 characters</span>
            </div>
            <div className={`flex items-center gap-1.5 ${hasLetter ? "text-[#2A9D8F]" : "text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60"}`}>
              <span>{hasLetter ? "✓" : "○"}</span>
              <span>Contains at least one letter</span>
            </div>
            <div className={`flex items-center gap-1.5 ${hasNumber ? "text-[#2A9D8F]" : "text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60"}`}>
              <span>{hasNumber ? "✓" : "○"}</span>
              <span>Contains at least one number</span>
            </div>
            <div className={`flex items-center gap-1.5 ${passwordsMatch ? "text-[#2A9D8F]" : "text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60"}`}>
              <span>{passwordsMatch ? "✓" : "○"}</span>
              <span>Passwords match</span>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !isFormValid}
            className="w-full py-3 border-2 border-[#0A0A0A] bg-[#0A0A0A] text-[#FAFAFA] dark:bg-[#EDEEF2] dark:text-[#0A0A0A] font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wider hover:bg-[#1D3557] dark:hover:bg-[#70B4FF] hover:border-[#1D3557] transition-colors cursor-pointer disabled:opacity-40"
          >
            {loading ? "Saving Credentials..." : "Update Password &rarr;"}
          </button>
        </form>
      )}
    </div>
  );
}
