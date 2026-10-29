"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mapAuthError, MappedAuthError } from "@/lib/auth-errors";

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorState, setErrorState] = useState<MappedAuthError | null>(null);
  const [successConfirmation, setSuccessConfirmation] = useState(false);

  // Live Password Strength & Rule Checklist
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

    if (!hasMinLength || !hasLetter || !hasNumber) {
      setErrorState({
        message: "Password does not satisfy minimum complexity rules.",
        field: "password",
        code: "WEAK_PASSWORD",
      });
      return;
    }

    setLoading(true);
    const cleanEmail = email.trim().toLowerCase();

    try {
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        setErrorState(mapAuthError(error, "signup"));
        setLoading(false);
        return;
      }

      // If Supabase has email confirmation enabled
      if (data.user && !data.session) {
        setSuccessConfirmation(true);
      } else if (data.session) {
        // Confirmation is disabled, user is immediately signed in
        router.push("/");
        router.refresh();
      }
    } catch (err) {
      setErrorState(mapAuthError(err, "signup"));
    } finally {
      setLoading(false);
    }
  };

  if (successConfirmation) {
    return (
      <div className="max-w-md mx-auto my-12 border-2 border-[#0A0A0A] bg-[#FAFAFA] dark:bg-[#101217] dark:border-[#2C3142] p-8 shadow-[4px_4px_0px_0px_#0A0A0A] dark:shadow-none">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 bg-[#2A9D8F] text-[#FAFAFA] flex items-center justify-center font-bold text-xl mx-auto border-2 border-[#0A0A0A]">
            ✓
          </div>
          <h2 className="font-['Archivo_Black'] text-xl uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2]">
            Confirmation Email Sent
          </h2>
          <p className="font-mono text-xs text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80 leading-relaxed">
            We have dispatched a verification link to <span className="font-bold">{email}</span>.
            Please verify your email address to activate your autonomous research workspace.
          </p>
          <div className="pt-4 border-t-2 border-[#0A0A0A] dark:border-[#2C3142]">
            <Link
              href="/sign-in"
              className="inline-block px-5 py-2.5 bg-[#0A0A0A] text-[#FAFAFA] font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wider hover:bg-[#1D3557] transition-colors"
            >
              Return to Sign In &rarr;
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto my-12 border-2 border-[#0A0A0A] bg-[#FAFAFA] dark:bg-[#101217] dark:border-[#2C3142] p-8 shadow-[4px_4px_0px_0px_#0A0A0A] dark:shadow-none transition-colors">
      <div className="mb-6 border-b-2 border-[#0A0A0A] dark:border-[#2C3142] pb-4">
        <span className="font-mono text-xs uppercase tracking-wider text-[#1D3557] dark:text-[#70B4FF] block mb-1">
          // RESEARCH REGISTRATION
        </span>
        <h1 className="font-['Archivo_Black'] text-2xl uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2]">
          Create Account
        </h1>
      </div>

      {errorState && (
        <div
          role="alert"
          className="mb-6 p-4 border-2 border-[#E63946] bg-[#E63946]/10 text-[#0A0A0A] dark:text-[#EDEEF2] font-mono text-xs flex items-start gap-2 shadow-[2px_2px_0px_0px_#E63946]"
        >
          <span className="font-bold text-[#E63946]">[ERROR]</span>
          <span className="leading-relaxed">{errorState.message}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block font-mono text-xs uppercase font-bold text-[#0A0A0A] dark:text-[#EDEEF2] mb-1.5">
            Academic / Work Email
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
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="font-mono text-[11px] text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 hover:text-[#0A0A0A]"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          <input
            type={showPassword ? "text" : "password"}
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min 8 chars with letter & number"
            className={`w-full px-3 py-2 border-2 ${
              errorState?.field === "password" ? "border-[#E63946]" : "border-[#0A0A0A] dark:border-[#2C3142]"
            } bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#1D3557]`}
          />
        </div>

        <div>
          <label className="block font-mono text-xs uppercase font-bold text-[#0A0A0A] dark:text-[#EDEEF2] mb-1.5">
            Confirm Password
          </label>
          <input
            type={showPassword ? "text" : "password"}
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter password"
            className={`w-full px-3 py-2 border-2 ${
              errorState?.field === "confirmPassword" ? "border-[#E63946]" : "border-[#0A0A0A] dark:border-[#2C3142]"
            } bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#1D3557]`}
          />
        </div>

        {/* Live Password Rules Checklist */}
        <div className="p-3 bg-[#FFFFFF] dark:bg-[#0C0D12] border border-[#0A0A0A] dark:border-[#2C3142] space-y-1 font-mono text-[11px]">
          <div className="font-bold text-[#0A0A0A] dark:text-[#EDEEF2] mb-1 uppercase tracking-wider">
            Password Criteria:
          </div>
          <div className={`flex items-center gap-1.5 ${hasMinLength ? "text-[#2A9D8F]" : "text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60"}`}>
            <span>{hasMinLength ? "✓" : "○"}</span>
            <span>At least 8 characters in length</span>
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
          {loading ? "Registering Workspace..." : "Create Account &rarr;"}
        </button>
      </form>

      <div className="mt-6 pt-4 border-t-2 border-[#0A0A0A] dark:border-[#2C3142] text-center">
        <p className="font-mono text-xs text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80">
          Already registered?{" "}
          <Link
            href="/sign-in"
            className="font-bold text-[#1D3557] dark:text-[#70B4FF] underline hover:text-[#E63946]"
          >
            Sign In &rarr;
          </Link>
        </p>
      </div>
    </div>
  );
}
