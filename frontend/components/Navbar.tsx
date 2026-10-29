"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/components/ThemeProvider";
import { SunIcon, MoonIcon } from "@/components/Icons";

function ThemeToggleButton() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="w-8 h-8 border border-[#0A0A0A]/30 dark:border-[#2C3142] p-1 flex items-center justify-center text-xs opacity-50">
        &bull;
      </div>
    );
  }

  return (
    <button
      onClick={toggleTheme}
      className="p-1.5 border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] text-[#0A0A0A] dark:text-[#EDEEF2] hover:bg-[#0A0A0A] hover:text-[#FAFAFA] dark:hover:bg-[#EDEEF2] dark:hover:text-[#0A0A0A] transition-colors cursor-pointer text-xs font-mono font-bold flex items-center justify-center"
      title={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
      aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
    >
      {resolvedTheme === "dark" ? <SunIcon size={14} /> : <MoonIcon size={14} />}
    </button>
  );
}

export function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<{ id: string; email?: string; name?: string } | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);

    const updateFromSession = (sessionUser: any) => {
      if (!sessionUser) {
        setUser(null);
        return;
      }
      const meta = sessionUser.user_metadata || {};
      const storedName = typeof window !== "undefined" ? localStorage.getItem("swarm_user_name") : null;
      const fullName = meta.full_name || (meta.first_name ? `${meta.first_name} ${meta.last_name || ""}`.trim() : storedName);
      
      setUser({
        id: sessionUser.id,
        email: sessionUser.email,
        name: fullName || sessionUser.email?.split("@")[0] || "Researcher",
      });
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      updateFromSession(session?.user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      updateFromSession(session?.user);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    if (typeof window !== "undefined") {
      localStorage.removeItem("swarm_user_name");
      localStorage.removeItem("swarm_current_chat_id");
    }
    setUser(null);
    router.push("/sign-in");
    router.refresh();
  };

  return (
    <header className="border-b-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#101217] sticky top-0 z-50 transition-colors">
      <div className="w-full px-4 sm:px-6 py-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        {/* Brand Logo */}
        <div className="flex items-center gap-3">
          <span className="w-4 h-4 bg-[#E63946] inline-block border border-[#0A0A0A] dark:border-[#2C3142]" />
          <Link
            href="/"
            className="font-['Archivo_Black'] text-xl tracking-tight uppercase text-[#0A0A0A] dark:text-[#EDEEF2] hover:text-[#E63946] dark:hover:text-[#FF5C6C] transition-colors"
          >
            Auto Research Swarm
          </Link>
        </div>

        {/* Navigation Links & User Profile Status */}
        <nav className="flex items-center gap-4 sm:gap-6 font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wide">
          <Link
            href="/dashboard"
            className={`pb-1 border-b-2 transition-colors ${
              pathname === "/dashboard"
                ? "border-[#E63946] text-[#E63946] dark:text-[#FF5C6C] dark:border-[#FF5C6C]"
                : "border-transparent text-[#0A0A0A] dark:text-[#EDEEF2] hover:border-[#E63946] hover:text-[#E63946] dark:hover:text-[#FF5C6C]"
            }`}
          >
            Dashboard
          </Link>
          <Link
            href="/chats"
            className={`pb-1 border-b-2 transition-colors ${
              pathname?.startsWith("/chats")
                ? "border-[#E63946] text-[#E63946] dark:text-[#FF5C6C] dark:border-[#FF5C6C]"
                : "border-transparent text-[#0A0A0A] dark:text-[#EDEEF2] hover:border-[#E63946] hover:text-[#E63946] dark:hover:text-[#FF5C6C]"
            }`}
          >
            Chats // Paper Studio
          </Link>
          <Link
            href="/reviews"
            className={`pb-1 border-b-2 transition-colors ${
              pathname === "/reviews"
                ? "border-[#E63946] text-[#E63946] dark:text-[#FF5C6C] dark:border-[#FF5C6C]"
                : "border-transparent text-[#0A0A0A] dark:text-[#EDEEF2] hover:border-[#E63946] hover:text-[#E63946] dark:hover:text-[#FF5C6C]"
            }`}
          >
            Reviews
          </Link>
          <Link
            href="/knowledge"
            className={`pb-1 border-b-2 transition-colors ${
              pathname === "/knowledge"
                ? "border-[#E63946] text-[#E63946] dark:text-[#FF5C6C] dark:border-[#FF5C6C]"
                : "border-transparent text-[#0A0A0A] dark:text-[#EDEEF2] hover:border-[#E63946] hover:text-[#E63946] dark:hover:text-[#FF5C6C]"
            }`}
          >
            Knowledge
          </Link>
          <Link
            href="/guardrails"
            className={`pb-1 border-b-2 transition-colors ${
              pathname === "/guardrails"
                ? "border-[#E63946] text-[#E63946] dark:text-[#FF5C6C] dark:border-[#FF5C6C]"
                : "border-transparent text-[#0A0A0A] dark:text-[#EDEEF2] hover:border-[#E63946] hover:text-[#E63946] dark:hover:text-[#FF5C6C]"
            }`}
          >
            Guardrails
          </Link>
          <Link
            href="/settings"
            className={`pb-1 border-b-2 transition-colors ${
              pathname === "/settings"
                ? "border-[#E63946] text-[#E63946] dark:text-[#FF5C6C] dark:border-[#FF5C6C]"
                : "border-transparent text-[#0A0A0A] dark:text-[#EDEEF2] hover:border-[#E63946] hover:text-[#E63946] dark:hover:text-[#FF5C6C]"
            }`}
          >
            Settings
          </Link>

          {/* Theme Quick Toggle */}
          <ThemeToggleButton />

          {/* User Auth Connectivity */}
          {isMounted && user ? (
            <div className="flex items-center gap-2 pl-2 border-l-2 border-[#0A0A0A]/20 dark:border-[#2C3142]">
              <Link
                href="/settings"
                className="flex items-center gap-1.5 px-2.5 py-1 bg-[#1D3557]/10 dark:bg-[#1D3557]/30 border border-[#1D3557] dark:border-[#70B4FF] text-[#1D3557] dark:text-[#70B4FF] font-mono font-bold lowercase text-[11px] hover:border-[#E63946] transition-colors"
                title="View researcher profile"
              >
                <span className="w-2 h-2 rounded-full bg-[#2A9D8F] inline-block" />
                <span className="truncate max-w-[120px] sm:max-w-[160px] font-['Space_Grotesk'] font-bold uppercase text-xs">
                  {user.name}
                </span>
              </Link>
              <button
                onClick={handleSignOut}
                className="px-2.5 py-1 bg-[#0A0A0A] dark:bg-[#EDEEF2] text-[#FAFAFA] dark:text-[#0A0A0A] border border-[#0A0A0A] dark:border-[#EDEEF2] hover:bg-[#E63946] dark:hover:bg-[#FF5C6C] dark:hover:text-[#FAFAFA] transition-colors font-mono text-[11px] cursor-pointer"
                title="Sign out of workspace"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <Link
              href="/sign-in"
              className="px-3.5 py-1.5 bg-[#0A0A0A] dark:bg-[#EDEEF2] text-[#FAFAFA] dark:text-[#0A0A0A] border border-[#0A0A0A] dark:border-[#EDEEF2] hover:bg-[#E63946] dark:hover:bg-[#FF5C6C] dark:hover:text-[#FAFAFA] transition-colors shadow-[2px_2px_0px_0px_#0A0A0A] dark:shadow-none ml-2"
            >
              Sign In
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
