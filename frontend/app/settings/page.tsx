"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useTheme } from "@/components/ThemeProvider";
import { AlertBanner, ConfirmationModal, MoonIcon, SunIcon, SystemThemeIcon } from "@/components";
import { supabase } from "@/lib/supabase";

export default function SettingsPage() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  // Profile State
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [role, setRole] = useState("Research Scientist");

  // Swarm Defaults
  const [defaultProvider, setDefaultProvider] = useState("gemini");
  const [defaultModel, setDefaultModel] = useState("gemini-1.5-flash");
  const [defaultMaxPages, setDefaultMaxPages] = useState(20);
  const [defaultMaxTokens, setDefaultMaxTokens] = useState(500000);

  // Status message
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // Purge cache modal state
  const [showPurgeModal, setShowPurgeModal] = useState(false);

  useEffect(() => {
    // Load from supabase or local storage
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setEmail(session.user.email || "");
        const meta = session.user.user_metadata || {};
        if (meta.first_name) setFirstName(meta.first_name);
        if (meta.last_name) setLastName(meta.last_name);
        if (meta.affiliation) setAffiliation(meta.affiliation);
        if (meta.role) setRole(meta.role);
      }
    });

    const storedProfile = localStorage.getItem("swarm_user_profile");
    if (storedProfile) {
      try {
        const p = JSON.parse(storedProfile);
        if (p.firstName) setFirstName(p.firstName);
        if (p.lastName) setLastName(p.lastName);
        if (p.affiliation) setAffiliation(p.affiliation);
        if (p.role) setRole(p.role);
        if (p.defaultProvider) setDefaultProvider(p.defaultProvider);
        if (p.defaultModel) setDefaultModel(p.defaultModel);
        if (p.defaultMaxPages) setDefaultMaxPages(p.defaultMaxPages);
        if (p.defaultMaxTokens) setDefaultMaxTokens(p.defaultMaxTokens);
      } catch {}
    }
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();

    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim() || firstName.trim() || "Researcher";
    localStorage.setItem("swarm_user_name", fullName);

    const profileData = {
      firstName,
      lastName,
      affiliation,
      role,
      defaultProvider,
      defaultModel,
      defaultMaxPages,
      defaultMaxTokens,
    };
    localStorage.setItem("swarm_user_profile", JSON.stringify(profileData));

    // Update Supabase if logged in
    try {
      await supabase.auth.updateUser({
        data: {
          first_name: firstName,
          last_name: lastName,
          full_name: fullName,
          affiliation,
          role,
        },
      });
    } catch {
      // non-fatal
    }

    setSavedMessage("Settings and preferences successfully saved.");
    setTimeout(() => setSavedMessage(null), 4000);
  };

  const confirmPurgeCache = () => {
    localStorage.removeItem("swarm_user_projects");
    localStorage.removeItem("swarm_active_run_id");
    setShowPurgeModal(false);
    setSavedMessage("Local workspace cache purged.");
    setTimeout(() => setSavedMessage(null), 3000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      {/* Header with Back Navigation */}
      <div className="border-b-2 border-[#0A0A0A] dark:border-[#2C3142] pb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1 text-xs font-mono text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">
            <span>PREFERENCES</span>
            <span>/</span>
            <span>SYSTEM CONFIGURATION</span>
          </div>
          <h1 className="font-['Archivo_Black'] text-3xl sm:text-4xl uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2]">
            Settings &amp; Profile
          </h1>
          <p className="font-['Inter'] text-sm text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 mt-1">
            Manage your researcher identity, color theme, and default reasoning engine.
          </p>
        </div>

        <Link
          href="/dashboard"
          className="px-4 py-2 border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] font-['Space_Grotesk'] font-bold text-xs uppercase hover:bg-[#0A0A0A] hover:text-[#FAFAFA] dark:hover:bg-[#EDEEF2] dark:hover:text-[#0A0A0A] transition-colors shadow-[2px_2px_0px_0px_#0A0A0A] dark:shadow-none inline-flex items-center gap-1.5"
        >
          <span>&larr;</span> Back to Dashboard
        </Link>
      </div>

      {savedMessage && (
        <AlertBanner
          variant="success"
          title="Preferences Updated"
          message={savedMessage}
          onClose={() => setSavedMessage(null)}
        />
      )}

      {/* Form */}
      <form onSubmit={handleSaveProfile} className="space-y-10">
        {/* Section 1: Appearance & Theme */}
        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-6 sm:p-8 space-y-6">
          <div className="flex items-center justify-between pb-3 border-b-2 border-[#0A0A0A] dark:border-[#2C3142]">
            <div className="flex items-center gap-2.5">
              <span className="w-3 h-3 bg-[#E63946] inline-block" />
              <h2 className="font-['Space_Grotesk'] font-bold text-lg uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2]">
                System Theme &amp; Aesthetics
              </h2>
            </div>
            <span className="font-mono text-xs uppercase text-[#0A0A0A]/50 dark:text-[#EDEEF2]/50">
              Active: {resolvedTheme}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Light Mode */}
            <button
              type="button"
              onClick={() => setTheme("light")}
              className={`p-4 border-2 text-left transition-all cursor-pointer flex flex-col justify-between h-28 ${
                theme === "light"
                  ? "border-[#E63946] bg-[#FFFFFF] shadow-[3px_3px_0px_0px_#E63946]"
                  : "border-[#0A0A0A]/30 dark:border-[#2C3142] bg-[#FFFFFF] dark:bg-[#0C0D12] hover:border-[#0A0A0A] dark:hover:border-[#EDEEF2]"
              }`}
            >
              <div className="flex justify-between items-center">
                <SunIcon size={20} className="text-[#0A0A0A] dark:text-[#EDEEF2]" />
                {theme === "light" && (
                  <span className="font-mono text-[10px] bg-[#E63946] text-[#FAFAFA] px-1.5 py-0.5 font-bold uppercase">
                    ACTIVE
                  </span>
                )}
              </div>
              <div>
                <h3 className="font-['Space_Grotesk'] font-bold text-sm uppercase text-[#0A0A0A] dark:text-[#EDEEF2]">
                  Light Mode
                </h3>
                <p className="text-[11px] font-mono text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">
                  Clean crisp high-contrast layout
                </p>
              </div>
            </button>

            {/* Dark Mode */}
            <button
              type="button"
              onClick={() => setTheme("dark")}
              className={`p-4 border-2 text-left transition-all cursor-pointer flex flex-col justify-between h-28 ${
                theme === "dark"
                  ? "border-[#E63946] bg-[#14161E] text-[#EDEEF2] shadow-[3px_3px_0px_0px_#E63946]"
                  : "border-[#0A0A0A]/30 dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] hover:border-[#0A0A0A] dark:hover:border-[#EDEEF2]"
              }`}
            >
              <div className="flex justify-between items-center">
                <MoonIcon size={20} className="text-[#0A0A0A] dark:text-[#EDEEF2]" />
                {theme === "dark" && (
                  <span className="font-mono text-[10px] bg-[#E63946] text-[#FAFAFA] px-1.5 py-0.5 font-bold uppercase">
                    ACTIVE
                  </span>
                )}
              </div>
              <div>
                <h3 className="font-['Space_Grotesk'] font-bold text-sm uppercase text-[#0A0A0A] dark:text-[#EDEEF2]">
                  Dark Mode
                </h3>
                <p className="text-[11px] font-mono text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">
                  Low-fatigue dark background
                </p>
              </div>
            </button>

            {/* System Default */}
            <button
              type="button"
              onClick={() => setTheme("system")}
              className={`p-4 border-2 text-left transition-all cursor-pointer flex flex-col justify-between h-28 ${
                theme === "system"
                  ? "border-[#E63946] bg-[#FFFFFF] dark:bg-[#14161E] shadow-[3px_3px_0px_0px_#E63946]"
                  : "border-[#0A0A0A]/30 dark:border-[#2C3142] bg-[#FFFFFF] dark:bg-[#0C0D12] hover:border-[#0A0A0A] dark:hover:border-[#EDEEF2]"
              }`}
            >
              <div className="flex justify-between items-center">
                <SystemThemeIcon size={20} className="text-[#0A0A0A] dark:text-[#EDEEF2]" />
                {theme === "system" && (
                  <span className="font-mono text-[10px] bg-[#E63946] text-[#FAFAFA] px-1.5 py-0.5 font-bold uppercase">
                    ACTIVE
                  </span>
                )}
              </div>
              <div>
                <h3 className="font-['Space_Grotesk'] font-bold text-sm uppercase text-[#0A0A0A] dark:text-[#EDEEF2]">
                  System Sync
                </h3>
                <p className="text-[11px] font-mono text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">
                  Match device OS preferences
                </p>
              </div>
            </button>
          </div>
        </div>

        {/* Section 2: Researcher Profile */}
        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-2.5 pb-3 border-b-2 border-[#0A0A0A] dark:border-[#2C3142]">
            <span className="w-3 h-3 bg-[#1D3557] inline-block" />
            <h2 className="font-['Space_Grotesk'] font-bold text-lg uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2]">
              Researcher Identity &amp; Profile
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block font-['Space_Grotesk'] font-bold text-xs uppercase mb-1.5 text-[#0A0A0A] dark:text-[#EDEEF2]">
                First Name
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="e.g., Sreenidhi"
                className="w-full border-2 border-[#0A0A0A] dark:border-[#2C3142] p-2.5 font-mono text-xs bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] outline-none focus:border-[#E63946]"
              />
            </div>

            <div>
              <label className="block font-['Space_Grotesk'] font-bold text-xs uppercase mb-1.5 text-[#0A0A0A] dark:text-[#EDEEF2]">
                Last Name
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="e.g., Sharma"
                className="w-full border-2 border-[#0A0A0A] dark:border-[#2C3142] p-2.5 font-mono text-xs bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] outline-none focus:border-[#E63946]"
              />
            </div>

            <div>
              <label className="block font-['Space_Grotesk'] font-bold text-xs uppercase mb-1.5 text-[#0A0A0A] dark:text-[#EDEEF2]">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                disabled
                className="w-full border-2 border-[#0A0A0A]/30 dark:border-[#2C3142] p-2.5 font-mono text-xs bg-[#0A0A0A]/5 dark:bg-[#FFFFFF]/5 text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 outline-none cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block font-['Space_Grotesk'] font-bold text-xs uppercase mb-1.5 text-[#0A0A0A] dark:text-[#EDEEF2]">
                Academic Affiliation / Lab
              </label>
              <input
                type="text"
                value={affiliation}
                onChange={(e) => setAffiliation(e.target.value)}
                placeholder="e.g., Autonomous Systems Lab"
                className="w-full border-2 border-[#0A0A0A] dark:border-[#2C3142] p-2.5 font-mono text-xs bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] outline-none focus:border-[#E63946]"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-['Space_Grotesk'] font-bold text-xs uppercase mb-1.5 text-[#0A0A0A] dark:text-[#EDEEF2]">
                Primary Role / Title
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full border-2 border-[#0A0A0A] dark:border-[#2C3142] p-2.5 font-mono text-xs bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] outline-none focus:border-[#E63946]"
              >
                <option value="Research Scientist">Research Scientist</option>
                <option value="Principal Investigator">Principal Investigator</option>
                <option value="PhD Candidate / Graduate Researcher">PhD Candidate / Graduate Researcher</option>
                <option value="Machine Learning Engineer">Machine Learning Engineer</option>
                <option value="Independent AI Researcher">Independent AI Researcher</option>
              </select>
            </div>
          </div>
        </div>

        {/* Section 3: Default Reasoning Engine */}
        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-2.5 pb-3 border-b-2 border-[#0A0A0A] dark:border-[#2C3142]">
            <span className="w-3 h-3 bg-[#2A9D8F] inline-block" />
            <h2 className="font-['Space_Grotesk'] font-bold text-lg uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2]">
              Default LLM Provider &amp; Budgets
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block font-['Space_Grotesk'] font-bold text-xs uppercase mb-1.5 text-[#0A0A0A] dark:text-[#EDEEF2]">
                Default LLM Provider
              </label>
              <select
                value={defaultProvider}
                onChange={(e) => {
                  setDefaultProvider(e.target.value);
                  if (e.target.value === "gemini") setDefaultModel("gemini-1.5-flash");
                  else if (e.target.value === "groq") setDefaultModel("llama-3.3-70b-versatile");
                  else setDefaultModel("gpt-4o-mini");
                }}
                className="w-full border-2 border-[#0A0A0A] dark:border-[#2C3142] p-2.5 font-mono text-xs bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] outline-none focus:border-[#E63946]"
              >
                <option value="gemini">Google Gemini (Recommended &bull; Generous Free Tier)</option>
                <option value="groq">Groq Cloud (Fast LPU Inference)</option>
                <option value="openai">OpenAI (GPT-4o)</option>
                <option value="anthropic">Anthropic (Claude 3.5)</option>
                <option value="ollama">Ollama (Local Private)</option>
              </select>
            </div>

            <div>
              <label className="block font-['Space_Grotesk'] font-bold text-xs uppercase mb-1.5 text-[#0A0A0A] dark:text-[#EDEEF2]">
                Default Model
              </label>
              <input
                type="text"
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                className="w-full border-2 border-[#0A0A0A] dark:border-[#2C3142] p-2.5 font-mono text-xs bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] outline-none focus:border-[#E63946]"
              />
            </div>

            <div>
              <label className="block font-['Space_Grotesk'] font-bold text-xs uppercase mb-1.5 text-[#0A0A0A] dark:text-[#EDEEF2]">
                Default Max Pages ({defaultMaxPages})
              </label>
              <input
                type="range"
                min="5"
                max="50"
                step="5"
                value={defaultMaxPages}
                onChange={(e) => setDefaultMaxPages(Number(e.target.value))}
                className="w-full accent-[#E63946]"
              />
            </div>

            <div>
              <label className="block font-['Space_Grotesk'] font-bold text-xs uppercase mb-1.5 text-[#0A0A0A] dark:text-[#EDEEF2]">
                Default Token Ceiling ({defaultMaxTokens.toLocaleString()} tokens)
              </label>
              <input
                type="range"
                min="50000"
                max="1000000"
                step="50000"
                value={defaultMaxTokens}
                onChange={(e) => setDefaultMaxTokens(Number(e.target.value))}
                className="w-full accent-[#E63946]"
              />
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t-2 border-[#0A0A0A] dark:border-[#2C3142]">
          <button
            type="button"
            onClick={() => setShowPurgeModal(true)}
            className="px-4 py-2 border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-transparent text-[#0A0A0A] dark:text-[#EDEEF2] font-['Space_Grotesk'] font-bold text-xs uppercase hover:bg-[#E63946] hover:text-[#FAFAFA] hover:border-[#E63946] transition-colors cursor-pointer"
          >
            Purge Local Cache
          </button>

          <button
            type="submit"
            className="w-full sm:w-auto px-8 py-3 border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#0A0A0A] dark:bg-[#EDEEF2] text-[#FAFAFA] dark:text-[#0A0A0A] font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wider hover:bg-[#E63946] dark:hover:bg-[#FF5C6C] hover:text-[#FAFAFA] transition-colors shadow-[3px_3px_0px_0px_#E63946] cursor-pointer"
          >
            Save All Preferences &rarr;
          </button>
        </div>
      </form>

      {/* Confirmation Modal for Cache Purge */}
      <ConfirmationModal
        isOpen={showPurgeModal}
        title="Purge Local Cache?"
        description="Are you sure you want to clear your local workspace cache and custom project lists? Your backend research runs and persisted synthesis documents will remain completely intact."
        confirmText="Purge Cache"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmPurgeCache}
        onCancel={() => setShowPurgeModal(false)}
      />
    </div>
  );
}
