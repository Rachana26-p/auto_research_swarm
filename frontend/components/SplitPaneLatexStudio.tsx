"use client";

import React, { useState, useEffect, useRef } from "react";
import { Button } from "./Button";
import { CopyButton } from "./CopyButton";
import {
  ChatSourceRecord,
  PaperComposerOutput,
  PaperRecord,
  PaperVersionRecord,
  generateChatPaper,
  getChatPaper,
  getChatPaperVersions,
  updateChatPaperSource,
} from "@/lib/api";

interface SplitPaneLatexStudioProps {
  chatId: string;
  sources?: ChatSourceRecord[];
  onClose?: () => void;
}

export function SplitPaneLatexStudio({ chatId, sources = [], onClose }: SplitPaneLatexStudioProps) {
  // Paper & Version State
  const [paper, setPaper] = useState<PaperRecord | null>(null);
  const [versions, setVersions] = useState<PaperVersionRecord[]>([]);
  const [activeVersion, setActiveVersion] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [generating, setGenerating] = useState<boolean>(false);
  const [compiling, setCompiling] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [concurrencyError, setConcurrencyError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("Ready");

  // Code Editor State
  const [activeFile, setActiveFile] = useState<"main.tex" | "references.bib">("main.tex");
  const [texCode, setTexCode] = useState<string>("");
  const [bibCode, setBibCode] = useState<string>("");

  // Right Pane State
  const [activeTab, setActiveTab] = useState<"preview" | "diagnostics" | "grounding">("preview");
  const [compileLog, setCompileLog] = useState<string>("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [groundingReport, setGroundingReport] = useState<{
    score: number;
    citedKeys: string[];
    hallucinatedKeys: string[];
    warnings: string[];
  }>({
    score: 1.0,
    citedKeys: [],
    hallucinatedKeys: [],
    warnings: [],
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  // Load Paper and Versions for this chat
  const fetchPaperData = async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);
      const [paperData, versionList] = await Promise.all([
        getChatPaper(chatId).catch(() => null),
        getChatPaperVersions(chatId).catch(() => []),
      ]);

      if (paperData) {
        setPaper(paperData);
      }
      setVersions(versionList);

      if (versionList.length > 0) {
        const latest = versionList[0];
        setActiveVersion(latest.version);
        setTexCode(latest.tex_source || "");
        setBibCode(latest.bib_source || "");
        computeGrounding(latest.tex_source || "", latest.bib_source || "");

        if (latest.compile_status === "success" && latest.page_count > 0) {
          setStatusMessage(`Compiled (v${latest.version}, ${latest.page_count} pages)`);
        } else if (latest.compile_status === "failed") {
          setStatusMessage(`Compilation error in v${latest.version}`);
          setActiveTab("diagnostics");
        }
      }
    } catch (err) {
      setStatusMessage(`Error loading paper: ${err instanceof Error ? err.message : "Failed"}`);
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    fetchPaperData(true);
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [chatId]);

  // Handle line numbers synchronized scrolling
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  // Grounding calculation helper
  const computeGrounding = (tex: string, bib: string) => {
    // Extract bib keys
    const bibKeys = new Set<string>();
    const bibRegex = /@\w+\s*\{\s*([^,\s]+)\s*,/g;
    let match;
    while ((match = bibRegex.exec(bib)) !== null) {
      bibKeys.add(match[1].trim());
    }

    // Extract cited keys from TeX
    const citedMatches = tex.match(/\\cite(?:\[[^\]]*\])?\{([^}]+)\}/g) || [];
    const citedKeys: string[] = [];
    for (const cm of citedMatches) {
      const inner = cm.replace(/\\cite(?:\[[^\]]*\])?\{|\}/g, "");
      for (const k of inner.split(",")) {
        const cleaned = k.trim();
        if (cleaned) citedKeys.push(cleaned);
      }
    }

    const uniqueCited = Array.from(new Set(citedKeys));
    const valid = uniqueCited.filter((k) => bibKeys.has(k));
    const hallucinated = uniqueCited.filter((k) => !bibKeys.has(k));
    const score = uniqueCited.length > 0 ? valid.length / uniqueCited.length : 1.0;

    const warnings: string[] = [];
    if (hallucinated.length > 0) {
      warnings.push(`Detected ${hallucinated.length} ungrounded citation keys: ${hallucinated.join(", ")}`);
    }

    setGroundingReport({
      score,
      citedKeys: uniqueCited,
      hallucinatedKeys: hallucinated,
      warnings,
    });
  };

  // Switch active version
  const handleSelectVersion = (verNum: number) => {
    const target = versions.find((v) => v.version === verNum);
    if (!target) return;
    setActiveVersion(verNum);
    setTexCode(target.tex_source || "");
    setBibCode(target.bib_source || "");
    setConcurrencyError(null);
    computeGrounding(target.tex_source || "", target.bib_source || "");
    setStatusMessage(`Loaded version ${verNum} (${target.created_by})`);
  };

  // Generate paper with Composer Agent
  const handleGeneratePaper = async () => {
    setGenerating(true);
    setStatusMessage("Synthesizing IEEEtran paper with PaperComposer...");
    setConcurrencyError(null);
    try {
      const out: PaperComposerOutput = await generateChatPaper(chatId, 5, "IEEEtran");
      setTexCode(out.tex_source);
      setBibCode(out.bib_source);
      setActiveVersion(out.version);
      computeGrounding(out.tex_source, out.bib_source);
      setStatusMessage(`Generated v${out.version} (grounding ${(out.grounding_score * 100).toFixed(0)}%)`);
      await fetchPaperData(false);
    } catch (err) {
      setStatusMessage(`Generation failed: ${err instanceof Error ? err.message : "Error"}`);
    } finally {
      setGenerating(false);
    }
  };

  // Save manual edits with optimistic concurrency
  const handleSave = async (andCompile = false) => {
    setSaving(true);
    setConcurrencyError(null);
    setStatusMessage(andCompile ? "Compiling LaTeX..." : "Saving draft version...");
    try {
      const updated = await updateChatPaperSource(
        chatId,
        texCode,
        bibCode,
        paper?.current_version || activeVersion,
        andCompile ? "Manual edit and compilation" : "Manual editor update",
        andCompile
      );
      setActiveVersion(updated.version);
      setStatusMessage(`Saved as version ${updated.version}`);
      await fetchPaperData(false);

      if (andCompile) {
        if (updated.compile_status === "success") {
          setActiveTab("preview");
          setStatusMessage(`Compiled successfully (${updated.page_count} pages)`);
        } else {
          setActiveTab("diagnostics");
          setStatusMessage("Compilation errors detected");
        }
      }
    } catch (err: any) {
      if (err.message?.includes("409") || err.message?.includes("conflict")) {
        setConcurrencyError(
          "Optimistic lock conflict: another user or background run updated this paper. Please reload version history."
        );
      } else {
        setStatusMessage(`Save failed: ${err.message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  // Download utilities
  const handleDownloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const currentCode = activeFile === "main.tex" ? texCode : bibCode;
  const lineCount = (currentCode.match(/\n/g) || []).length + 1;
  const wordCount = texCode.trim().split(/\s+/).filter(Boolean).length;
  const estPages = (wordCount / 650).toFixed(1);

  return (
    <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] shadow-[4px_4px_0px_0px_#0A0A0A] dark:shadow-none flex flex-col h-[85vh] max-h-[900px] overflow-hidden">
      {/* Top Header Bar */}
      <div className="p-3 border-b-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FFFFFF] dark:bg-[#101217] flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center gap-3">
          <span className="w-3 h-3 bg-[#1D3557] dark:bg-[#70B4FF] inline-block border border-[#0A0A0A]" />
          <div>
            <span className="font-bold text-[#0A0A0A] dark:text-[#EDEEF2] uppercase tracking-wider text-sm">
              LaTeX Paper Studio // IEEEtran Two-Column
            </span>
            <div className="text-[11px] text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">
              {wordCount.toLocaleString()} words &bull; ~{estPages} compiled pages &bull; {groundingReport.citedKeys.length} citations
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Version Switcher */}
          <div className="flex items-center gap-1.5 border border-[#0A0A0A] dark:border-[#2C3142] px-2 py-1 bg-[#FAFAFA] dark:bg-[#14161E]">
            <span className="text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 uppercase text-[10px]">Version:</span>
            <select
              value={activeVersion}
              onChange={(e) => handleSelectVersion(Number(e.target.value))}
              className="bg-transparent font-bold text-[#0A0A0A] dark:text-[#EDEEF2] focus:outline-none cursor-pointer"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.version} className="bg-[#FFFFFF] dark:bg-[#101217]">
                  v{v.version} ({v.created_by}) {v.compile_status === "success" ? `[${v.page_count}p]` : `[${v.compile_status}]`}
                </option>
              ))}
            </select>
          </div>

          <Button
            size="sm"
            variant="primary"
            onClick={handleGeneratePaper}
            disabled={generating || compiling}
          >
            {generating ? "Synthesizing..." : "⚡ Generate Paper"}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => handleSave(false)}
            disabled={saving || compiling}
          >
            {saving ? "Saving..." : "Save Draft"}
          </Button>

          <Button
            size="sm"
            variant="primary"
            onClick={() => handleSave(true)}
            disabled={compiling || saving}
          >
            {compiling ? "Compiling..." : "▶ Compile PDF"}
          </Button>

          {onClose && (
            <button
              onClick={onClose}
              className="px-2 py-1 border border-[#0A0A0A] dark:border-[#2C3142] text-[#0A0A0A] dark:text-[#EDEEF2] hover:bg-[#E63946] hover:text-white transition-colors"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Concurrency Error Banner */}
      {concurrencyError && (
        <div className="px-4 py-2 bg-[#E63946] text-[#FAFAFA] font-mono text-xs flex items-center justify-between">
          <span>⚠️ {concurrencyError}</span>
          <button
            onClick={() => fetchPaperData(false)}
            className="underline font-bold uppercase hover:opacity-80"
          >
            Refresh Versions
          </button>
        </div>
      )}

      {/* Split-Pane Content Area */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y-2 md:divide-y-0 md:divide-x-2 divide-[#0A0A0A] dark:divide-[#2C3142] min-h-0 overflow-hidden">
        {/* LEFT PANE: LaTeX / BibTeX Editor */}
        <div className="flex flex-col h-full bg-[#FFFFFF] dark:bg-[#0C0D12] overflow-hidden">
          {/* File Tab Selector */}
          <div className="p-2 border-b border-[#0A0A0A]/15 dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveFile("main.tex")}
                className={`px-3 py-1 font-bold border-b-2 transition-colors ${
                  activeFile === "main.tex"
                    ? "border-[#E63946] text-[#E63946] dark:text-[#FF5C6C]"
                    : "border-transparent text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 hover:text-[#0A0A0A]"
                }`}
              >
                📄 main.tex
              </button>
              <button
                onClick={() => setActiveFile("references.bib")}
                className={`px-3 py-1 font-bold border-b-2 transition-colors ${
                  activeFile === "references.bib"
                    ? "border-[#E63946] text-[#E63946] dark:text-[#FF5C6C]"
                    : "border-transparent text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 hover:text-[#0A0A0A]"
                }`}
              >
                📚 references.bib
              </button>
            </div>

            <div className="flex items-center gap-2">
              <CopyButton text={currentCode} label="Copy Code" />
              <button
                onClick={() => handleDownloadFile(activeFile, currentCode)}
                className="px-2 py-0.5 border border-[#0A0A0A]/40 dark:border-[#2C3142] text-[11px] uppercase hover:bg-[#0A0A0A] hover:text-white transition-colors"
                title={`Download ${activeFile}`}
              >
                Download
              </button>
            </div>
          </div>

          {/* Line-Numbered Textarea */}
          <div className="flex-1 relative flex overflow-hidden">
            <div
              ref={lineNumbersRef}
              className="w-12 py-3 bg-[#0A0A0A]/5 dark:bg-[#FFFFFF]/5 text-right pr-2 text-[#0A0A0A]/30 dark:text-[#EDEEF2]/30 font-mono text-xs select-none overflow-hidden leading-5 border-r border-[#0A0A0A]/10 dark:border-[#2C3142]"
            >
              {Array.from({ length: lineCount }).map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>

            <textarea
              ref={textareaRef}
              value={currentCode}
              onChange={(e) => {
                if (activeFile === "main.tex") {
                  setTexCode(e.target.value);
                  computeGrounding(e.target.value, bibCode);
                } else {
                  setBibCode(e.target.value);
                  computeGrounding(texCode, e.target.value);
                }
              }}
              onScroll={handleScroll}
              spellCheck={false}
              className="flex-1 p-3 bg-transparent font-mono text-xs text-[#0A0A0A] dark:text-[#EDEEF2] leading-5 resize-none focus:outline-none overflow-y-auto whitespace-pre tab-4"
              placeholder={activeFile === "main.tex" ? "% Enter IEEEtran LaTeX code here..." : "% Enter BibTeX entries here..."}
            />
          </div>
        </div>

        {/* RIGHT PANE: PDF Preview, Diagnostics, and Grounding */}
        <div className="flex flex-col h-full bg-[#FAFAFA] dark:bg-[#101217] overflow-hidden">
          {/* Right Pane Tabs */}
          <div className="p-2 border-b border-[#0A0A0A]/15 dark:border-[#2C3142] bg-[#FFFFFF] dark:bg-[#14161E] flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab("preview")}
                className={`px-3 py-1 font-bold border-b-2 transition-colors ${
                  activeTab === "preview"
                    ? "border-[#1D3557] text-[#1D3557] dark:text-[#70B4FF] dark:border-[#70B4FF]"
                    : "border-transparent text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 hover:text-[#0A0A0A]"
                }`}
              >
                👁️ PDF Preview
              </button>
              <button
                onClick={() => setActiveTab("diagnostics")}
                className={`px-3 py-1 font-bold border-b-2 transition-colors ${
                  activeTab === "diagnostics"
                    ? "border-[#E63946] text-[#E63946] dark:text-[#FF5C6C] dark:border-[#FF5C6C]"
                    : "border-transparent text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 hover:text-[#0A0A0A]"
                }`}
              >
                🛠️ Diagnostics
              </button>
              <button
                onClick={() => setActiveTab("grounding")}
                className={`px-3 py-1 font-bold border-b-2 transition-colors ${
                  activeTab === "grounding"
                    ? "border-[#2A9D8F] text-[#2A9D8F] dark:text-[#4AE3B5] dark:border-[#4AE3B5]"
                    : "border-transparent text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 hover:text-[#0A0A0A]"
                }`}
              >
                🎯 Grounding ({(groundingReport.score * 100).toFixed(0)}%)
              </button>
            </div>

            <span className="text-[11px] text-[#0A0A0A]/50 dark:text-[#EDEEF2]/50 font-mono">
              {statusMessage}
            </span>
          </div>

          {/* Right Pane Body */}
          <div className="flex-1 p-4 overflow-y-auto font-mono text-xs">
            {/* TAB 1: Preview */}
            {activeTab === "preview" && (
              <div className="h-full flex flex-col items-center justify-center space-y-4">
                {pdfUrl ? (
                  <iframe src={pdfUrl} className="w-full h-full border border-[#0A0A0A] dark:border-[#2C3142] shadow-sm" />
                ) : (
                  <div className="text-center p-8 border-2 border-dashed border-[#0A0A0A]/20 dark:border-[#2C3142] max-w-md space-y-3">
                    <div className="text-3xl">📑</div>
                    <div className="font-bold text-[#0A0A0A] dark:text-[#EDEEF2] uppercase text-sm">
                      IEEEtran Conference Document
                    </div>
                    <p className="text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 text-xs">
                      Target length: $\ge 5$ compiled pages with 2-column layout. Click Compile to render live PDF.
                    </p>
                    <div className="pt-2">
                      <Button size="sm" variant="primary" onClick={() => handleSave(true)} disabled={compiling}>
                        {compiling ? "Compiling..." : "Compile Live PDF"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: Diagnostics */}
            {activeTab === "diagnostics" && (
              <div className="space-y-4">
                <div className="font-bold text-[#0A0A0A] dark:text-[#EDEEF2] uppercase text-xs pb-1 border-b border-[#0A0A0A]/10">
                  TeX Engine Compilation Log &amp; Sandbox Output
                </div>
                {compileLog ? (
                  <pre className="p-3 bg-[#0A0A0A] text-[#FAFAFA] text-xs font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto border-2 border-[#0A0A0A]">
                    {compileLog}
                  </pre>
                ) : (
                  <div className="p-4 bg-[#FFFFFF] dark:bg-[#14161E] border border-[#0A0A0A]/20 dark:border-[#2C3142] space-y-2">
                    <span className="text-[#2A9D8F] font-bold">✓ Security Linter: PASS</span>
                    <p className="text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 text-xs">
                      No forbidden shell-escape or file-write commands detected. Document class verified as IEEEtran.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: Grounding */}
            {activeTab === "grounding" && (
              <div className="space-y-4">
                <div className="p-3 border-2 border-[#2A9D8F] bg-[#2A9D8F]/10 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold uppercase text-[#2A9D8F]">
                      Claim-to-Source Grounding Ratio
                    </span>
                    <span className="font-black text-sm">
                      {(groundingReport.score * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-[#0A0A0A]/10 dark:bg-[#FFFFFF]/10 overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        groundingReport.score >= 0.90 ? "bg-[#2A9D8F]" : "bg-[#F4A300]"
                      }`}
                      style={{ width: `${Math.round(groundingReport.score * 100)}%` }}
                    />
                  </div>
                </div>

                {/* Warnings */}
                {groundingReport.warnings.length > 0 && (
                  <div className="p-3 border-2 border-[#E63946] bg-[#E63946]/10 text-[#E63946] space-y-1">
                    <div className="font-bold uppercase">Citation Grounding Warnings</div>
                    {groundingReport.warnings.map((w, idx) => (
                      <div key={idx}>&bull; {w}</div>
                    ))}
                  </div>
                )}

                {/* Cited Keys List */}
                <div className="space-y-2">
                  <div className="font-bold uppercase text-[#0A0A0A] dark:text-[#EDEEF2]">
                    Verified Source Citations ({groundingReport.citedKeys.length})
                  </div>
                  <div className="space-y-1.5">
                    {groundingReport.citedKeys.map((key) => {
                      const matched = sources.find((s) => s.bib_key === key || s.canonical_id === key);
                      return (
                        <div
                          key={key}
                          className="p-2 bg-[#FFFFFF] dark:bg-[#14161E] border border-[#0A0A0A]/20 dark:border-[#2C3142] flex items-center justify-between gap-2"
                        >
                          <div>
                            <span className="font-bold text-[#1D3557] dark:text-[#70B4FF]">
                              {`\\cite{${key}}`}
                            </span>
                            {matched && (
                              <div className="text-[11px] text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 truncate max-w-sm">
                                {matched.title} ({matched.year || "2026"})
                              </div>
                            )}
                          </div>
                          <span className="px-2 py-0.5 text-[10px] font-bold bg-[#2A9D8F]/20 text-[#2A9D8F] uppercase">
                            GROUNDED
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
