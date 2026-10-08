"use client";

import React, { useEffect, useState, use, Suspense } from "react";
import Link from "next/link";
import { Button } from "@/components";
import { getKnowledgePage, KnowledgePageDetail } from "@/lib/api";

interface PageProps {
  params: Promise<{ id: string }>;
}

function KnowledgeDetailContent({ params }: PageProps) {
  const { id: pageId } = use(params);

  const [detail, setDetail] = useState<KnowledgePageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadPage() {
      try {
        const data = await getKnowledgePage(pageId);
        setDetail(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Article not found");
      } finally {
        setLoading(false);
      }
    }
    loadPage();
  }, [pageId]);

  if (loading) {
    return (
      <div className="border-2 border-[#0A0A0A] p-12 text-center bg-[#FAFAFA] font-mono text-sm">
        <span className="inline-block w-3 h-3 bg-[#1D3557] animate-ping mr-3" />
        LOADING KNOWLEDGE ARTICLE: {pageId}...
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="border-2 border-[#E63946] bg-[#E63946]/10 p-8 text-center space-y-4">
        <h2 className="font-['Space_Grotesk'] font-bold text-xl uppercase text-[#E63946]">
          Article Not Found
        </h2>
        <p className="font-mono text-sm text-[#0A0A0A]/80">{error}</p>
        <Link href="/knowledge">
          <Button variant="outline" size="sm">
            &larr; Return to Knowledge Base
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b-2 border-[#0A0A0A] gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-[#0A0A0A]/60 mb-1">
            <Link href="/knowledge" className="hover:underline">
              KNOWLEDGE
            </Link>
            <span>/</span>
            <span>{detail.filename}</span>
          </div>
          <h1 className="font-['Space_Grotesk'] font-bold text-2xl uppercase tracking-tight text-[#0A0A0A]">
            {detail.title}
          </h1>
        </div>

        <Link href="/knowledge">
          <Button variant="outline" size="sm">
            &larr; Back to Articles
          </Button>
        </Link>
      </div>

      {/* Metadata Bar */}
      <div className="border border-[#0A0A0A] bg-[#0A0A0A]/5 p-3 flex flex-wrap items-center justify-between gap-4 font-mono text-xs">
        <div>
          <span className="text-[#0A0A0A]/60">PAGE ID: </span>
          <span className="font-bold text-[#0A0A0A]">{detail.page_id}</span>
        </div>
        <div>
          <span className="text-[#0A0A0A]/60">FILE: </span>
          <span className="font-bold text-[#0A0A0A]">{detail.filename}</span>
        </div>
        <div className="bg-[#2A9D8F] text-[#FAFAFA] px-2 py-0.5 text-[10px] font-bold uppercase">
          VALIDATED BY SWARM
        </div>
      </div>

      {/* Markdown Content (Rendered as escaped text per security requirement, NO dangerouslySetInnerHTML) */}
      <div className="border-2 border-[#0A0A0A] bg-[#FAFAFA] p-6 sm:p-8">
        <div className="flex items-center justify-between pb-3 border-b border-[#0A0A0A]/20 mb-6">
          <span className="font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wider text-[#0A0A0A]/60">
            Rendered Escaped Markdown // Safe Inert View
          </span>
          <span className="font-mono text-xs text-[#0A0A0A]/50">
            {detail.content.length} CHARS
          </span>
        </div>

        {/* Escaped Preformatted Markdown Container */}
        <pre className="font-mono text-xs sm:text-sm text-[#0A0A0A] whitespace-pre-wrap leading-relaxed overflow-x-auto bg-[#FAFAFA] p-4 border border-[#0A0A0A]/10">
          {detail.content}
        </pre>
      </div>
    </div>
  );
}

export default function KnowledgeDetailPage(props: PageProps) {
  return (
    <Suspense
      fallback={
        <div className="border-2 border-[#0A0A0A] p-12 text-center bg-[#FAFAFA] font-mono text-sm">
          <span className="inline-block w-3 h-3 bg-[#1D3557] animate-ping mr-3" />
          LOADING KNOWLEDGE ARTICLE...
        </div>
      }
    >
      <KnowledgeDetailContent {...props} />
    </Suspense>
  );
}
