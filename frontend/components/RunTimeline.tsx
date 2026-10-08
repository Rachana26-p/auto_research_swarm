import React from "react";
import StatusDot from "./StatusDot";

export interface TimelineNode {
  name: string;
  key: "planner" | "discovery" | "extractor" | "validator" | "writer";
  status: "pending" | "running" | "completed" | "interrupted" | "failed";
  duration_ms?: number;
  info?: string;
}

interface RunTimelineProps {
  currentNode?: string;
  nodes?: TimelineNode[];
  className?: string;
}

const DEFAULT_NODES: TimelineNode[] = [
  { name: "Planner", key: "planner", status: "pending" },
  { name: "Discovery", key: "discovery", status: "pending" },
  { name: "Extractor", key: "extractor", status: "pending" },
  { name: "Validator", key: "validator", status: "pending" },
  { name: "Writer", key: "writer", status: "pending" },
];

export const RunTimeline: React.FC<RunTimelineProps> = ({
  currentNode,
  nodes = DEFAULT_NODES,
  className = "",
}) => {
  // Compute active or fallback status based on currentNode
  const renderedNodes = nodes.map((node) => {
    let status = node.status;
    if (currentNode && currentNode.toLowerCase() === node.key) {
      status = "running";
    }
    return { ...node, status };
  });

  return (
    <div className={`w-full py-4 ${className}`}>
      {/* Horizontal Bauhaus Grid: Nodes as squares, connectors as thin rules */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-0 relative">
        {renderedNodes.map((node, index) => {
          const isFirst = index === 0;

          // Square border and fill styles per Bauhaus status mapping
          let squareStyle = "bg-[#FAFAFA] border-2 border-[#0A0A0A] text-[#0A0A0A]";
          if (node.status === "running") {
            squareStyle = "bg-[#1D3557] border-2 border-[#1D3557] text-[#FAFAFA] animate-pulse";
          } else if (node.status === "completed") {
            squareStyle = "bg-[#2A9D8F] border-2 border-[#2A9D8F] text-[#FAFAFA]";
          } else if (node.status === "interrupted") {
            squareStyle = "bg-[#F4A300] border-2 border-[#0A0A0A] text-[#0A0A0A]";
          } else if (node.status === "failed") {
            squareStyle = "bg-[#E63946] border-2 border-[#E63946] text-[#FAFAFA]";
          }

          return (
            <React.Fragment key={node.key}>
              {/* Connector line (hidden on mobile vertical stack, visible on desktop) */}
              {!isFirst && (
                <div className="hidden sm:block flex-1 h-[2px] bg-[#0A0A0A] mx-2 transition-colors" />
              )}

              {/* Node Item */}
              <div className="flex flex-col items-center text-center z-10 w-28">
                {/* Node Bauhaus Square */}
                <div
                  className={`w-12 h-12 flex flex-col items-center justify-center font-['Space_Grotesk'] font-bold text-xs uppercase transition-all shadow-none ${squareStyle}`}
                  title={`${node.name}: ${node.status}`}
                >
                  <span>0{index + 1}</span>
                </div>

                {/* Node Label */}
                <div className="mt-2 flex items-center gap-1.5">
                  <StatusDot status={node.status} size="sm" />
                  <span className="font-['Space_Grotesk'] font-bold text-xs uppercase tracking-tight text-[#0A0A0A]">
                    {node.name}
                  </span>
                </div>

                {/* Duration or Info if present */}
                {node.duration_ms !== undefined && node.duration_ms > 0 && (
                  <span className="font-mono text-[10px] text-[#0A0A0A]/60">
                    {node.duration_ms}ms
                  </span>
                )}
                {node.info && (
                  <span className="font-mono text-[10px] text-[#0A0A0A]/70 truncate max-w-[100px]">
                    {node.info}
                  </span>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default RunTimeline;
