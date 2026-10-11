"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, PasswordInput, AlertBanner } from "@/components";
import { supabase } from "@/lib/supabase";

export default function RegisterPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!firstName.trim() || !lastName.trim()) {
      setError("Please enter both First Name and Last Name");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);

    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/dashboard` : undefined,
          data: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            full_name: fullName,
          },
        },
      });

      if (signUpError) throw signUpError;

      if (typeof window !== "undefined") {
        localStorage.setItem("swarm_user_name", fullName);
      }

      if (data.session) {
        router.push("/dashboard");
        router.refresh();
      } else {
        setSuccessMessage("Account created. Please check your email to confirm registration.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register account");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[75vh] flex flex-col items-center justify-center p-4">
      {/* Back navigation buttons */}
      <div className="w-full max-w-md mb-4 flex justify-between items-center">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider font-bold text-[#0A0A0A] dark:text-[#EDEEF2] hover:text-[#E63946] dark:hover:text-[#FF5C6C] transition-colors p-1"
        >
          <span>&larr;</span> Back to Home
        </Link>
        <Link
          href="/auth/login"
          className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider font-bold text-[#1D3557] dark:text-[#70B4FF] hover:underline"
        >
          Sign In &rarr;
        </Link>
      </div>

      <div className="w-full max-w-md border-2 border-[#0A0A0A] bg-[#FAFAFA] dark:bg-[#14161E] dark:border-[#2C3142] p-6 sm:p-8 space-y-6 shadow-[6px_6px_0px_0px_#0A0A0A] dark:shadow-[6px_6px_0px_0px_rgba(0,0,0,0.7)]">
        {/* Header */}
        <div className="border-b-2 border-[#0A0A0A] dark:border-[#2C3142] pb-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-3.5 h-3.5 bg-[#2A9D8F] inline-block border border-[#0A0A0A]" />
            <span className="font-mono text-xs uppercase tracking-wider text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">
              NEW RESEARCHER IDENTITY // REGISTRATION
            </span>
          </div>
          <h1 className="font-['Archivo_Black'] text-2xl uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2]">
            Create Account
          </h1>
        </div>

        {error && (
          <AlertBanner
            variant="error"
            title="Registration Error"
            message={error}
            onClose={() => setError(null)}
          />
        )}

        {successMessage && (
          <AlertBanner
            variant="success"
            title="Account Created"
            message={successMessage}
            onClose={() => setSuccessMessage(null)}
          />
        )}

        {/* Register Form */}
        <form onSubmit={handleRegister} className="space-y-4">
          {/* Name Row: First & Last Name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-['Space_Grotesk'] font-bold text-xs uppercase text-[#0A0A0A] dark:text-[#EDEEF2] mb-1">
                First Name
              </label>
              <input
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Ada"
                className="w-full border-2 border-[#0A0A0A] dark:border-[#2C3142] p-2.5 font-mono text-xs bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] focus:outline-none focus:border-[#E63946] transition-colors"
              />
            </div>
            <div>
              <label className="block font-['Space_Grotesk'] font-bold text-xs uppercase text-[#0A0A0A] dark:text-[#EDEEF2] mb-1">
                Last Name
              </label>
              <input
                type="text"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Lovelace"
                className="w-full border-2 border-[#0A0A0A] dark:border-[#2C3142] p-2.5 font-mono text-xs bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] focus:outline-none focus:border-[#E63946] transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block font-['Space_Grotesk'] font-bold text-xs uppercase text-[#0A0A0A] dark:text-[#EDEEF2] mb-1">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="researcher@quantum.org"
              className="w-full border-2 border-[#0A0A0A] dark:border-[#2C3142] p-2.5 font-mono text-xs bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] focus:outline-none focus:border-[#E63946] transition-colors"
            />
          </div>

          <PasswordInput
            label="Password (Min 6 chars)"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
          />

          <PasswordInput
            label="Confirm Password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••••••"
          />

          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={loading}
            className="w-full mt-2"
          >
            Create Researcher Account &rarr;
          </Button>
        </form>

        {/* Footer */}
        <div className="pt-4 border-t border-[#0A0A0A]/20 dark:border-[#2C3142] text-center font-mono text-xs text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70">
          <span>Already have an account? </span>
          <Link href="/auth/login" className="font-bold underline text-[#0A0A0A] dark:text-[#EDEEF2] hover:text-[#E63946] dark:hover:text-[#FF5C6C] transition-colors">
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
