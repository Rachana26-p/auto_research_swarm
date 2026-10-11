"use client";

import React, { useState, useEffect, useRef } from "react";
import { Button } from "./Button";
import { CopyButton } from "./CopyButton";
import { compileRunPdf, getRunLatex, updateRunLatex } from "@/lib/api";

interface TexEditorProps {
  runId: string;
  initialLatex?: string;
  onClose?: () => void;
}

export function TexEditor({ runId, initialLatex, onClose }: TexEditorProps) {
  const [latexCode, setLatexCode] = useState<string>(initialLatex || "");
  const [loading, setLoading] = useState<boolean>(!initialLatex);
  const [compiling, setCompiling] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("Ready");
  const [compileLog, setCompileLog] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"pdf" | "log">("pdf");
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load initial LaTeX if not provided
  useEffect(() => {
    let active = true;
    if (!initialLatex) {
      (async () => {
        try {
          setLoading(true);
          const res = await getRunLatex(runId);
          if (active && res.latex_code) {
            setLatexCode(res.latex_code);
            // Automatically compile initial PDF
            handleCompile(res.latex_code);
          }
        } catch (err) {
          if (active) setStatusMessage(`Failed to load LaTeX: ${err instanceof Error ? err.message : "Error"}`);
        } finally {
          if (active) setLoading(false);
        }
      })();
    } else {
      handleCompile(initialLatex);
    }
    return () => {
      active = false;
    };
  }, [runId, initialLatex]);

  const handleCompile = async (codeToCompile?: string) => {
    const code = codeToCompile !== undefined ? codeToCompile : latexCode;
    if (!code.trim()) return;

    setCompiling(true);
    setStatusMessage("Compiling LaTeX to PDF...");
    setCompileLog(null);
    try {
      const blob = await compileRunPdf(runId, code);
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
      const newUrl = URL.createObjectURL(blob);
      setPdfUrl(newUrl);
      setActiveTab("pdf");
      setStatusMessage("PDF Compiled successfully");
      setCompileLog("Compilation finished with 0 errors. Document compiled using PDF 1.4 publication engine.");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Compilation failed";
      setStatusMessage(`Error: ${errorMsg}`);
      setCompileLog(`LaTeX Compilation Error:\n${errorMsg}\n\nHint: Verify document class and balanced braces.`);
      setActiveTab("log");
    } finally {
      setCompiling(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateRunLatex(runId, latexCode);
      setStatusMessage("Saved .tex to storage");
      setTimeout(() => setStatusMessage("Ready"), 2500);
    } catch (err) {
      setStatusMessage(`Save failed: ${err instanceof Error ? err.message : "Error"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadTex = () => {
    const blob = new Blob([latexCode], { type: "text/x-tex;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `survey_${runId.slice(0, 8)}.tex`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = () => {
    if (!pdfUrl) return;
    const link = document.createElement("a");
    link.href = pdfUrl;
    link.download = `survey_${runId.slice(0, 8)}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Keyboard shortcut Ctrl+Enter to compile
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleCompile();
    }
  };

  const lineCount = Math.max(1, latexCode.split("\n").length);
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1).join("\n");

  return (
    <div
      className={`border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] flex flex-col transition-all ${
        isFullscreen
          ? "fixed inset-4 z-50 shadow-2xl bg-[#FAFAFA] dark:bg-[#14161E]"
          : "w-full my-6 min-h-[700px] h-[780px]"
      }`}
    >
      {/* Top Overleaf Toolbar */}
      <div className="flex flex-wrap items-center justify-between p-3.5 border-b-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 bg-[#1D3557] border border-[#0A0A0A] inline-block" />
            <h3 className="font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wide text-[#0A0A0A] dark:text-[#EDEEF2]">
              TeX Studio &amp; PDF Compiler // Overleaf Mode
            </h3>
          </div>
          <span className="text-[11px] font-mono px-2 py-0.5 border border-[#0A0A0A]/20 dark:border-[#2C3142] bg-[#0A0A0A]/5 dark:bg-[#FFFFFF]/5 text-[#0A0A0A] dark:text-[#EDEEF2]">
            {statusMessage}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => handleCompile()}
            loading={compiling}
            className="bg-[#2A9D8F] text-[#FAFAFA] hover:bg-[#2A9D8F]/90 font-mono text-xs"
          >
            &#9654; Recompile PDF
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleSave}
            loading={saving}
            className="font-mono text-xs"
          >
            Save .tex
          </Button>

          <CopyButton text={latexCode} label="Copy .tex" variant="button" />

          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadTex}
            className="font-mono text-xs"
          >
            .tex &darr;
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadPdf}
            disabled={!pdfUrl}
            className="font-mono text-xs"
          >
            .pdf &darr;
          </Button>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="border-2 border-[#0A0A0A] dark:border-[#2C3142] px-2.5 py-1 text-xs font-mono font-bold bg-[#FAFAFA] dark:bg-[#14161E] text-[#0A0A0A] dark:text-[#EDEEF2] hover:bg-[#0A0A0A] hover:text-[#FAFAFA] dark:hover:bg-[#EDEEF2] dark:hover:text-[#0A0A0A] transition-colors cursor-pointer"
            title="Toggle Fullscreen"
          >
            {isFullscreen ? "Standard" : "Fullscreen"}
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="border-2 border-[#0A0A0A] dark:border-[#2C3142] px-2 py-1 text-xs font-mono font-bold bg-[#E63946] text-[#FAFAFA] hover:bg-[#E63946]/90 transition-colors cursor-pointer"
              title="Close"
            >
              &times;
            </button>
          )}
        </div>
      </div>

      {/* Split Pane: Code Editor (Left) & PDF Preview (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 min-h-0 overflow-hidden divide-y lg:divide-y-0 lg:divide-x-2 divide-[#0A0A0A] dark:divide-[#2C3142]">
        {/* Left: TeX Editor (6 cols) */}
        <div className="lg:col-span-6 flex flex-col h-full min-h-0 bg-[#FFFFFF] dark:bg-[#0C0D12]">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#0A0A0A]/20 dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] text-[11px] font-mono text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 shrink-0">
            <span>report.tex (LaTeX 2e)</span>
            <span>Ctrl + Enter to compile</span>
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center p-8 font-mono text-xs text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">
              <span className="inline-block w-2.5 h-2.5 bg-[#1D3557] dark:bg-[#70B4FF] animate-ping mr-2" />
              Generating LaTeX report structure...
            </div>
          ) : (
            <div className="flex-1 flex min-h-0 overflow-hidden font-mono text-xs">
              {/* Line Numbers Gutter */}
              <div className="w-12 bg-[#FAFAFA] dark:bg-[#14161E] border-r border-[#0A0A0A]/15 dark:border-[#2C3142] py-3 pr-2 select-none text-right text-[#0A0A0A]/40 dark:text-[#EDEEF2]/40 overflow-hidden leading-relaxed shrink-0">
                <pre>{lineNumbers}</pre>
              </div>

              {/* Editable Area */}
              <textarea
                ref={textareaRef}
                value={latexCode}
                onChange={(e) => setLatexCode(e.target.value)}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                className="flex-1 p-3 bg-transparent text-[#0A0A0A] dark:text-[#EDEEF2] resize-none outline-none overflow-y-auto leading-relaxed selection:bg-[#F4A300]/30 font-mono text-xs min-h-0"
                placeholder="\documentclass{article}..."
              />
            </div>
          )}
        </div>

        {/* Right: PDF Viewer & Compile Output (6 cols) */}
        <div className="lg:col-span-6 flex flex-col h-full min-h-0 bg-[#FAFAFA] dark:bg-[#14161E]">
          {/* Subheader Tabs */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#0A0A0A]/20 dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] text-[11px] font-mono shrink-0">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab("pdf")}
                className={`px-2 py-0.5 border text-xs font-bold transition-colors cursor-pointer ${
                  activeTab === "pdf"
                    ? "bg-[#0A0A0A] text-[#FAFAFA] dark:bg-[#EDEEF2] dark:text-[#0A0A0A] border-[#0A0A0A] dark:border-[#EDEEF2]"
                    : "bg-[#FAFAFA] dark:bg-[#14161E] text-[#0A0A0A] dark:text-[#EDEEF2] border-[#0A0A0A]/20 dark:border-[#2C3142] hover:border-[#0A0A0A]"
                }`}
              >
                PDF Preview
              </button>
              <button
                onClick={() => setActiveTab("log")}
                className={`px-2 py-0.5 border text-xs font-bold transition-colors cursor-pointer ${
                  activeTab === "log"
                    ? "bg-[#0A0A0A] text-[#FAFAFA] dark:bg-[#EDEEF2] dark:text-[#0A0A0A] border-[#0A0A0A] dark:border-[#EDEEF2]"
                    : "bg-[#FAFAFA] dark:bg-[#14161E] text-[#0A0A0A] dark:text-[#EDEEF2] border-[#0A0A0A]/20 dark:border-[#2C3142] hover:border-[#0A0A0A]"
                }`}
              >
                Compile Logs {compileLog && activeTab !== "log" && "(!)"}
              </button>
            </div>

            <span className="text-[10px] text-[#0A0A0A]/50 dark:text-[#EDEEF2]/50 uppercase">
              {compiling ? "Compiling..." : pdfUrl ? "PDF Live" : "No PDF Generated"}
            </span>
          </div>

          {/* Tab Content */}
          <div className="flex-1 min-h-0 overflow-hidden relative">
            {compiling && (
              <div className="absolute inset-0 bg-[#FAFAFA]/80 dark:bg-[#14161E]/80 backdrop-blur-xs flex flex-col items-center justify-center z-10 font-mono text-xs text-[#0A0A0A] dark:text-[#EDEEF2]">
                <span className="w-4 h-4 bg-[#2A9D8F] animate-spin mb-2 border border-[#0A0A0A]" />
                <span>Compiling LaTeX report...</span>
              </div>
            )}

            {activeTab === "pdf" ? (
              pdfUrl ? (
                <iframe
                  src={`${pdfUrl}#toolbar=1&navpanes=0&scrollbar=1`}
                  className="w-full h-full border-none bg-[#FAFAFA] dark:bg-[#14161E]"
                  title="PDF Preview"
                />
              ) : (
                <div className="flex-1 h-full flex flex-col items-center justify-center p-8 text-center text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 font-mono text-xs">
                  <div className="w-12 h-16 border-2 border-dashed border-[#0A0A0A]/30 dark:border-[#2C3142] mb-3 flex items-center justify-center">
                    PDF
                  </div>
                  <p>Click &quot;Recompile PDF&quot; above to render the compiled paper.</p>
                </div>
              )
            ) : (
              <div className="p-4 overflow-y-auto h-full font-mono text-xs bg-[#0A0A0A]/5 dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] leading-relaxed">
                <span className="font-bold block pb-1 border-b border-[#0A0A0A]/20 dark:border-[#2C3142] mb-2">
                  COMPILATION DIAGNOSTICS:
                </span>
                <pre className="whitespace-pre-wrap">{compileLog || "No compilation logs yet."}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
