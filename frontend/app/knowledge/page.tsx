"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AlertBanner, Button, KnowledgeFileCard } from "@/components";
import { getKnowledge, KnowledgePageSummary } from "@/lib/api";

export default function KnowledgeListPage() {
  const [pages, setPages] = useState<KnowledgePageSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchKnowledge = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getKnowledge();
      setPages(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load knowledge articles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getKnowledge();
        if (active) {
          setPages(data);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load knowledge articles");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  // Filtered by search query (title or filename or pageId)
  const filteredPages = pages.filter((p) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      p.title.toLowerCase().includes(q) ||
      p.filename.toLowerCase().includes(q) ||
      p.page_id.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-8">
      {/* Header with Back Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b-2 border-[#0A0A0A] dark:border-[#2C3142] gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 mb-1">
            <span>REPOSITORY</span>
            <span>/</span>
            <span>WRITER KNOWLEDGE BASE</span>
          </div>
          <h1 className="font-['Archivo_Black'] text-3xl uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2]">
            Synthesized Knowledge Base
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="px-3 py-1.5 border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] font-['Space_Grotesk'] font-bold text-xs uppercase hover:bg-[#0A0A0A] hover:text-[#FAFAFA] dark:hover:bg-[#EDEEF2] dark:hover:text-[#0A0A0A] transition-colors inline-flex items-center gap-1.5 shadow-[2px_2px_0px_0px_#0A0A0A] dark:shadow-none"
          >
            <span>&larr;</span> Back to Dashboard
          </Link>
          <span className="font-mono text-xs border-2 border-[#0A0A0A] dark:border-[#2C3142] px-3 py-1.5 bg-[#FAFAFA] dark:bg-[#14161E] text-[#0A0A0A] dark:text-[#EDEEF2]">
            {pages.length} PERSISTED ARTICLES
          </span>
          <Button variant="outline" size="sm" onClick={fetchKnowledge} loading={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {error && !loading && (
        <AlertBanner
          variant="error"
          title="Knowledge Retrieval Error"
          message={error}
          onClose={() => setError(null)}
        />
      )}

      {/* Search Input Filter */}
      <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] p-4 bg-[#FAFAFA] dark:bg-[#14161E]">
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <label htmlFor="search-input" className="font-['Space_Grotesk'] font-bold text-xs uppercase text-[#0A0A0A] dark:text-[#EDEEF2] shrink-0">
            Search Articles:
          </label>
          <input
            id="search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by title, keywords, or filename..."
            className="flex-1 w-full border-2 border-[#0A0A0A] dark:border-[#2C3142] p-2.5 font-['Inter'] text-sm bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] focus:outline-none focus:border-[#E63946]"
          />
          {searchQuery && (
            <Button variant="outline" size="sm" onClick={() => setSearchQuery("")}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] p-12 text-center bg-[#FAFAFA] dark:bg-[#14161E] font-mono text-sm text-[#0A0A0A] dark:text-[#EDEEF2]">
          <span className="inline-block w-3 h-3 bg-[#1D3557] dark:bg-[#70B4FF] animate-ping mr-3" />
          SCANNING KNOWLEDGE BASE DIRECTORY...
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && pages.length === 0 && (
        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] p-12 text-center bg-[#FAFAFA] dark:bg-[#14161E]">
          <span className="w-8 h-8 border-2 border-[#0A0A0A] dark:border-[#2C3142] inline-block mb-3" />
          <h3 className="font-['Space_Grotesk'] font-bold text-lg uppercase mb-1 text-[#0A0A0A] dark:text-[#EDEEF2]">
            Knowledge Base Empty
          </h3>
          <p className="font-['Inter'] text-sm text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70 max-w-md mx-auto">
            No research summaries have been synthesized yet. Launch a research
            run to populate knowledge articles.
          </p>
        </div>
      )}

      {/* No Search Matches */}
      {!loading && !error && pages.length > 0 && filteredPages.length === 0 && (
        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] p-12 text-center bg-[#FAFAFA] dark:bg-[#14161E]">
          <p className="font-mono text-sm text-[#0A0A0A]/70 dark:text-[#EDEEF2]/70">
            No articles matching query &ldquo;{searchQuery}&rdquo;.
          </p>
        </div>
      )}

      {/* Cards Grid */}
      {!loading && !error && filteredPages.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPages.map((page) => (
            <KnowledgeFileCard
              key={page.page_id}
              pageId={page.page_id}
              title={page.title}
              filename={page.filename}
              sizeBytes={page.size_bytes}
              isValidated={true}
            />
          ))}
        </div>
      )}
    </div>
  );
}
