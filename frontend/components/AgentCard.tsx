import React from "react";
import StatusDot, { StatusType } from "./StatusDot";

interface AgentCardProps {
  name: string;
  role: string;
  status: StatusType | string;
  metrics?: { label: string; value: string | number }[];
  lastAction?: string;
  className?: string;
  children?: React.ReactNode;
}

export const AgentCard: React.FC<AgentCardProps> = ({
  name,
  role,
  status,
  metrics = [],
  lastAction,
  className = "",
  children,
}) => {
  return (
    <div
      className={`border-2 border-[#0A0A0A] bg-[#FAFAFA] p-5 flex flex-col justify-between transition-all ${className}`}
    >
      <div>
        {/* Header with Bauhaus sharp status square and font-heading */}
        <div className="flex items-center justify-between pb-3 border-b border-[#0A0A0A] mb-4">
          <div className="flex items-center gap-2">
            <StatusDot status={status} size="md" />
            <h3 className="font-['Space_Grotesk'] font-bold text-lg uppercase tracking-tight text-[#0A0A0A]">
              {name}
            </h3>
          </div>
          <span className="font-mono text-xs uppercase px-2 py-0.5 border border-[#0A0A0A]">
            {status}
          </span>
        </div>

        {/* Role description */}
        <p className="font-['Inter'] text-sm text-[#0A0A0A]/80 mb-4">{role}</p>

        {/* Metrics Grid */}
        {metrics.length > 0 && (
          <div className="grid grid-cols-2 gap-2 mb-4 font-mono text-xs bg-[#0A0A0A]/5 p-3 border border-[#0A0A0A]/20">
            {metrics.map((m, idx) => (
              <div key={idx}>
                <span className="text-[#0A0A0A]/60 block">{m.label}:</span>
                <span className="font-bold text-[#0A0A0A]">{m.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Last Action Note */}
        {lastAction && (
          <div className="font-mono text-xs text-[#0A0A0A] bg-[#FAFAFA] border-l-2 border-[#1D3557] pl-2 py-1 mb-3">
            <span className="text-[#1D3557] font-bold">LATEST: </span>
            <span>{lastAction}</span>
          </div>
        )}
      </div>

      {children && <div className="mt-4 pt-3 border-t border-[#0A0A0A]/10">{children}</div>}
    </div>
  );
};

export default AgentCard;
