"use client";

import React, { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mapAuthError, MappedAuthError } from "@/lib/auth-errors";

function SignInContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next") || "/";
  const isExpired = searchParams.get("expired") === "true";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorState, setErrorState] = useState<MappedAuthError | null>(
    isExpired
      ? {
          message: "Your session has expired. Please sign in again to continue.",
          field: "global",
          code: "SESSION_EXPIRED",
        }
      : null
  );
  const [resendStatus, setResendStatus] = useState<string | null>(null);

  const supabase = createClient();

  const handleResendConfirmation = async () => {
    if (!email) return;
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
      });
      if (error) {
        setResendStatus(`Failed to resend: ${error.message}`);
      } else {
        setResendStatus("Verification email resent. Please check your inbox.");
      }
    } catch {
      setResendStatus("Network error while requesting verification email.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorState(null);
    setResendStatus(null);
    setLoading(true);

    const cleanEmail = email.trim().toLowerCase();

    // 1. Optional server-side precheck to distinguish wrong email vs wrong password
    try {
      const precheckRes = await fetch("/api/auth/precheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail }),
      });
      if (precheckRes.ok) {
        const precheckData = await precheckRes.json();
        if (precheckData.detailed_enabled && precheckData.exists === false) {
          setErrorState({
            message: "No account found with this email address. Please register first.",
            field: "email",
            code: "EMAIL_NOT_REGISTERED",
          });
          setLoading(false);
          return;
        }
        if (precheckData.detailed_enabled && precheckData.disabled) {
          setErrorState({
            message: "This account has been disabled. Please contact support.",
            field: "global",
            code: "ACCOUNT_DISABLED",
          });
          setLoading(false);
          return;
        }
      }
    } catch {
      // Ignore precheck failure and fall through to regular signIn
    }

    // 2. Perform Supabase authentication
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        const mapped = mapAuthError(error, "signin");
        setErrorState(mapped);
        setLoading(false);
        return;
      }

      if (data.session) {
        // Safe relative redirect
        let safeNext = "/";
        if (
          nextParam &&
          nextParam.startsWith("/") &&
          !nextParam.startsWith("//") &&
          !nextParam.includes("://")
        ) {
          safeNext = nextParam;
        }
        router.push(safeNext);
        router.refresh();
      }
    } catch (err) {
      setErrorState(mapAuthError(err, "signin"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto my-12 border-2 border-[#0A0A0A] bg-[#FAFAFA] dark:bg-[#101217] dark:border-[#2C3142] p-8 shadow-[4px_4px_0px_0px_#0A0A0A] dark:shadow-none transition-colors">
      <div className="mb-6 border-b-2 border-[#0A0A0A] dark:border-[#2C3142] pb-4">
        <span className="font-mono text-xs uppercase tracking-wider text-[#1D3557] dark:text-[#70B4FF] block mb-1">
          // SWARM ACCESS GATEWAY
        </span>
        <h1 className="font-['Archivo_Black'] text-2xl uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2]">
          Sign In
        </h1>
      </div>

      {errorState && (
        <div
          role="alert"
          className="mb-6 p-4 border-2 border-[#E63946] bg-[#E63946]/10 text-[#0A0A0A] dark:text-[#EDEEF2] font-mono text-xs space-y-2 shadow-[2px_2px_0px_0px_#E63946]"
        >
          <div className="flex items-start gap-2">
            <span className="font-bold text-[#E63946]">[ERROR]</span>
            <span className="leading-relaxed">{errorState.message}</span>
          </div>
          {errorState.canResendConfirmation && (
            <button
              type="button"
              onClick={handleResendConfirmation}
              className="mt-2 px-3 py-1 bg-[#1D3557] text-[#FAFAFA] font-bold text-xs uppercase tracking-wider hover:bg-[#0A0A0A] transition-colors"
            >
              Resend Confirmation Email
            </button>
          )}
        </div>
      )}

      {resendStatus && (
        <div className="mb-6 p-3 border-2 border-[#2A9D8F] bg-[#2A9D8F]/10 text-[#0A0A0A] dark:text-[#EDEEF2] font-mono text-xs">
          {resendStatus}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block font-mono text-xs uppercase font-bold text-[#0A0A0A] dark:text-[#EDEEF2] mb-1.5">
            Email Address
          </label>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="researcher@university.edu"
            className={`w-full px-3 py-2 border-2 ${
              errorState?.field === "email" ? "border-[#E63946]" : "border-[#0A0A0A] dark:border-[#2C3142]"
            } bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#1D3557]`}
          />
        </div>

        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="font-mono text-xs uppercase font-bold text-[#0A0A0A] dark:text-[#EDEEF2]">
              Password
            </label>
            <Link
              href="/forgot-password"
              className="font-mono text-[11px] text-[#1D3557] dark:text-[#70B4FF] underline hover:text-[#E63946]"
            >
              Forgot Password?
            </Link>
          </div>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className={`w-full px-3 py-2 border-2 ${
                errorState?.field === "password" ? "border-[#E63946]" : "border-[#0A0A0A] dark:border-[#2C3142]"
              } bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#1D3557]`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[11px] uppercase tracking-wider text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 hover:text-[#0A0A0A]"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 border-2 border-[#0A0A0A] bg-[#0A0A0A] text-[#FAFAFA] dark:bg-[#EDEEF2] dark:text-[#0A0A0A] font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wider hover:bg-[#1D3557] dark:hover:bg-[#70B4FF] hover:border-[#1D3557] transition-colors cursor-pointer disabled:opacity-50"
        >
          {loading ? "Authenticating..." : "Sign In &rarr;"}
        </button>
      </form>

      <div className="mt-8 pt-4 border-t-2 border-[#0A0A0A] dark:border-[#2C3142] text-center">
        <p className="font-mono text-xs text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80">
          Need a research account?{" "}
          <Link
            href="/sign-up"
            className="font-bold text-[#1D3557] dark:text-[#70B4FF] underline hover:text-[#E63946]"
          >
            Create an Account &rarr;
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="p-8 font-mono text-xs">Loading sign in...</div>}>
      <SignInContent />
    </Suspense>
  );
}
