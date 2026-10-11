"use client";

import React, { useEffect, useState, use, Suspense } from "react";
import Link from "next/link";
import { Button, CopyButton } from "@/components";
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
      <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] p-12 text-center bg-[#FAFAFA] dark:bg-[#14161E] font-mono text-sm text-[#0A0A0A] dark:text-[#EDEEF2]">
        <span className="inline-block w-3 h-3 bg-[#1D3557] dark:bg-[#70B4FF] animate-ping mr-3" />
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
        <p className="font-mono text-sm text-[#0A0A0A]/80 dark:text-[#EDEEF2]/80">{error}</p>
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b-2 border-[#0A0A0A] dark:border-[#2C3142] gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 mb-1">
            <Link href="/knowledge" className="hover:underline">
              KNOWLEDGE
            </Link>
            <span>/</span>
            <span>{detail.filename}</span>
          </div>
          <h1 className="font-['Space_Grotesk'] font-bold text-2xl uppercase tracking-tight text-[#0A0A0A] dark:text-[#EDEEF2]">
            {detail.title}
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <CopyButton text={detail.content} label="Copy Article" variant="button" />
          <Link href="/knowledge">
            <Button variant="outline" size="sm">
              &larr; Back to Articles
            </Button>
          </Link>
        </div>
      </div>

      {/* Metadata Bar */}
      <div className="border border-[#0A0A0A] dark:border-[#2C3142] bg-[#0A0A0A]/5 dark:bg-[#FFFFFF]/5 p-3 flex flex-wrap items-center justify-between gap-4 font-mono text-xs text-[#0A0A0A] dark:text-[#EDEEF2]">
        <div className="flex items-center gap-2">
          <span className="text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">PAGE ID: </span>
          <span className="font-bold">{detail.page_id}</span>
          <CopyButton text={detail.page_id} label="ID" variant="pill" />
        </div>
        <div>
          <span className="text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">FILE: </span>
          <span className="font-bold">{detail.filename}</span>
        </div>
        <div className="bg-[#2A9D8F] text-[#FAFAFA] px-2 py-0.5 text-[10px] font-bold uppercase">
          VALIDATED BY SWARM
        </div>
      </div>

      {/* Markdown Content (Rendered safely) */}
      <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#14161E] p-6 sm:p-8">
        <div className="flex items-center justify-between pb-3 border-b border-[#0A0A0A]/20 dark:border-[#2C3142] mb-6">
          <span className="font-['Space_Grotesk'] font-bold text-xs uppercase tracking-wider text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60">
            Rendered Escaped Markdown // Safe Inert View
          </span>
          <span className="font-mono text-xs text-[#0A0A0A]/50 dark:text-[#EDEEF2]/50">
            {detail.content.length} CHARS
          </span>
        </div>

        {/* Escaped Preformatted Markdown Container */}
        <pre className="font-mono text-xs sm:text-sm text-[#0A0A0A] dark:text-[#EDEEF2] whitespace-pre-wrap leading-relaxed overflow-x-auto bg-[#FAFAFA] dark:bg-[#0C0D12] p-4 border border-[#0A0A0A]/10 dark:border-[#2C3142]">
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
        <div className="border-2 border-[#0A0A0A] dark:border-[#2C3142] p-12 text-center bg-[#FAFAFA] dark:bg-[#14161E] font-mono text-sm text-[#0A0A0A] dark:text-[#EDEEF2]">
          <span className="inline-block w-3 h-3 bg-[#1D3557] dark:bg-[#70B4FF] animate-ping mr-3" />
          LOADING KNOWLEDGE ARTICLE...
        </div>
      }
    >
      <KnowledgeDetailContent {...props} />
    </Suspense>
  );
}
