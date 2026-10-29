"use client";

import React, { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { mapAuthError, MappedAuthError } from "@/lib/auth-errors";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorState, setErrorState] = useState<MappedAuthError | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorState(null);
    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        setErrorState(mapAuthError(error, "forgot"));
      } else {
        setSubmitted(true);
      }
    } catch (err) {
      setErrorState(mapAuthError(err, "forgot"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto my-12 border-2 border-[#0A0A0A] bg-[#FAFAFA] dark:bg-[#101217] dark:border-[#2C3142] p-8 shadow-[4px_4px_0px_0px_#0A0A0A] dark:shadow-none transition-colors">
      <div className="mb-6 border-b-2 border-[#0A0A0A] dark:border-[#2C3142] pb-4">
        <span className="font-mono text-xs uppercase tracking-wider text-[#1D3557] dark:text-[#70B4FF] block mb-1">
          // RECOVERY PORTAL
        </span>
        <h1 className="font-['Archivo_Black'] text-2xl uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2]">
          Reset Password
        </h1>
      </div>

      {submitted ? (
        <div className="space-y-4">
          <div className="p-4 border-2 border-[#2A9D8F] bg-[#2A9D8F]/10 text-[#0A0A0A] dark:text-[#EDEEF2] font-mono text-xs leading-relaxed">
            ✓ Password recovery instructions dispatched to <span className="font-bold">{email}</span>.
            Check your inbox and follow the secure link.
          </div>
          <div className="pt-4 border-t-2 border-[#0A0A0A] dark:border-[#2C3142] text-center">
            <Link
              href="/sign-in"
              className="inline-block px-5 py-2.5 bg-[#0A0A0A] text-[#FAFAFA] font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wider hover:bg-[#1D3557] transition-colors"
            >
              Return to Sign In &rarr;
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
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
              Account Email Address
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="researcher@university.edu"
              className="w-full px-3 py-2 border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#1D3557]"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !email}
            className="w-full py-3 border-2 border-[#0A0A0A] bg-[#0A0A0A] text-[#FAFAFA] dark:bg-[#EDEEF2] dark:text-[#0A0A0A] font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wider hover:bg-[#1D3557] dark:hover:bg-[#70B4FF] hover:border-[#1D3557] transition-colors cursor-pointer disabled:opacity-40"
          >
            {loading ? "Sending Link..." : "Send Reset Link &rarr;"}
          </button>

          <div className="pt-4 border-t-2 border-[#0A0A0A] dark:border-[#2C3142] text-center">
            <Link
              href="/sign-in"
              className="font-mono text-xs text-[#1D3557] dark:text-[#70B4FF] underline hover:text-[#E63946]"
            >
              &larr; Back to Sign In
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
