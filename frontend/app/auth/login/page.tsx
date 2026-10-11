"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, PasswordInput, AlertBanner } from "@/components";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        throw authError;
      }

      if (data.session) {
        router.push("/dashboard");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign in");
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async () => {
    if (!email.trim()) {
      setError("Please enter your email to receive a magic link");
      return;
    }
    setError(null);
    setSuccessMessage(null);
    setMagicLinkLoading(true);

    try {
      const { error: magicError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/dashboard` : undefined,
        },
      });

      if (magicError) throw magicError;
      setSuccessMessage("Check your inbox: Magic link sent successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send magic link");
    } finally {
      setMagicLinkLoading(false);
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
          href="/dashboard"
          className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider font-bold text-[#1D3557] dark:text-[#70B4FF] hover:underline"
        >
          Console &rarr;
        </Link>
      </div>

      <div className="w-full max-w-md border-2 border-[#0A0A0A] bg-[#FAFAFA] dark:bg-[#14161E] dark:border-[#2C3142] p-6 sm:p-8 space-y-6 shadow-[6px_6px_0px_0px_#0A0A0A] dark:shadow-[6px_6px_0px_0px_rgba(0,0,0,0.7)]">
        {/* Header */}
        <div className="border-b-2 border-[#0A0A0A] dark:border-[#2C3142] pb-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-3.5 h-3.5 bg-[#E63946] inline-block border border-[#0A0A0A]" />
            <span className="font-mono text-xs uppercase tracking-wider text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">
              SUPABASE IDENTITY // ACCESS GATE
            </span>
          </div>
          <h1 className="font-['Archivo_Black'] text-2xl uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2]">
            Sign In to Swarm
          </h1>
        </div>

        {error && (
          <AlertBanner
            variant="error"
            title="Authentication Error"
            message={error}
            onClose={() => setError(null)}
          />
        )}

        {successMessage && (
          <AlertBanner
            variant="success"
            title="Check Inbox"
            message={successMessage}
            onClose={() => setSuccessMessage(null)}
          />
        )}

        {/* Login Form */}
        <form onSubmit={handlePasswordLogin} className="space-y-4">
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
            label="Password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
          />

          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={loading}
            className="w-full mt-2"
          >
            Sign In with Password &rarr;
          </Button>
        </form>

        <div className="relative flex py-1 items-center">
          <div className="flex-grow border-t border-[#0A0A0A]/20 dark:border-[#2C3142]" />
          <span className="flex-shrink mx-3 text-[10px] font-mono text-[#0A0A0A]/50 dark:text-[#EDEEF2]/50 uppercase">
            OR PASSWORDLESS
          </span>
          <div className="flex-grow border-t border-[#0A0A0A]/20 dark:border-[#2C3142]" />
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleMagicLink}
          loading={magicLinkLoading}
          className="w-full font-mono text-xs"
        >
          Send One-Click Magic Link
        </Button>

        {/* Footer */}
        <div className="pt-4 border-t border-[#0A0A0A]/20 dark:border-[#2C3142] text-center font-mono text-xs text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 space-y-2">
          <div>
            <span>Need a new account? </span>
            <Link href="/auth/register" className="font-bold underline text-[#0A0A0A] dark:text-[#EDEEF2] hover:text-[#E63946] dark:hover:text-[#FF5C6C] transition-colors">
              Register Here
            </Link>
          </div>
          <div>
            <Link href="/dashboard" className="text-[#1D3557] dark:text-[#70B4FF] hover:underline font-bold">
              &larr; Or explore Console directly without sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
