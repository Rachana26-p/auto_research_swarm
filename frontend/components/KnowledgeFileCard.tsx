import React from "react";
import Link from "next/link";

interface KnowledgeFileCardProps {
  pageId: string;
  title: string;
  filename: string;
  sizeBytes?: number;
  excerpt?: string;
  isValidated?: boolean;
  className?: string;
}

export const KnowledgeFileCard: React.FC<KnowledgeFileCardProps> = ({
  pageId,
  title,
  filename,
  sizeBytes,
  excerpt,
  isValidated = true,
  className = "",
}) => {
  return (
    <div
      className={`border-2 border-[#0A0A0A] bg-[#FAFAFA] p-5 flex flex-col justify-between transition-colors hover:border-[#E63946] group ${className}`}
    >
      <div>
        {/* Top bar with validation tag and size */}
        <div className="flex items-center justify-between pb-2 border-b border-[#0A0A0A]/20 mb-3">
          {/* Monospace filename */}
          <span className="font-mono text-xs text-[#0A0A0A]/70 truncate max-w-[200px] sm:max-w-[300px]">
            {filename}
          </span>

          {/* Red/Green tag per ui-registry rule */}
          <span
            className={`font-['Space_Grotesk'] font-bold text-[10px] uppercase px-2 py-0.5 border ${
              isValidated
                ? "bg-[#2A9D8F] text-[#FAFAFA] border-[#2A9D8F]"
                : "bg-[#E63946] text-[#FAFAFA] border-[#E63946]"
            }`}
          >
            {isValidated ? "VALIDATED" : "UNVALIDATED"}
          </span>
        </div>

        {/* Title */}
        <h4 className="font-['Space_Grotesk'] font-bold text-lg text-[#0A0A0A] uppercase tracking-tight mb-2 group-hover:text-[#E63946] transition-colors">
          <Link href={`/knowledge/${encodeURIComponent(pageId)}`}>
            {title}
          </Link>
        </h4>

        {/* Excerpt if present */}
        {excerpt && (
          <p className="font-['Inter'] text-sm text-[#0A0A0A]/80 line-clamp-3 mb-4 leading-relaxed">
            {excerpt}
          </p>
        )}
      </div>

      {/* Bottom Action Footer */}
      <div className="pt-3 border-t border-[#0A0A0A]/10 flex items-center justify-between text-xs font-mono">
        {sizeBytes !== undefined && (
          <span className="text-[#0A0A0A]/60">
            {(sizeBytes / 1024).toFixed(1)} KB
          </span>
        )}
        <Link
          href={`/knowledge/${encodeURIComponent(pageId)}`}
          className="text-[#0A0A0A] font-bold uppercase underline decoration-2 hover:text-[#E63946] ml-auto"
        >
          View Markdown &rarr;
        </Link>
      </div>
    </div>
  );
};

export default KnowledgeFileCard;
